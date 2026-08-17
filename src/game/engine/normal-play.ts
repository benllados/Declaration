import { CANONICAL_DECK, type CardId } from "../cards";
import { DECLARATION_TIME_LIMIT_SECONDS, TEAM_SIZE, TOTAL_SETS } from "../constants/game";
import { GameDomainError } from "../errors";
import { getCardsInSet, getSetForCard, SET_IDS, type SetId } from "../sets";
import { createTeams, validateTeamComposition } from "../teams";
import { DECLARATION_MODES, type ActiveDeclaration, type TeamScores } from "../types/declaration";
import type { Player, PlayerId, PlayerSetup } from "../types/player";
import { TEAM_IDS, type Team, type TeamId } from "../types/team";

/** The authoritative lifecycle for an initialized Declaration game. */
export const GAME_PHASES = ["PLAYING", "DECLARING", "BLIND_DECLARATION", "GAME_OVER"] as const;
export type GamePhase = (typeof GAME_PHASES)[number];

/**
 * Authoritative state for a complete initialized game and every active lifecycle phase.
 */
export type NormalPlayGameState = Readonly<{
  players: readonly Player[];
  teams: readonly Team[];
  currentTurnOwner: PlayerId;
  resolvedSetIds: readonly SetId[];
  phase: GamePhase;
  /** Derived compatibility field: true exactly during PLAYING. */
  normalAskingAllowed: boolean;
  scores: TeamScores;
  activeDeclaration: ActiveDeclaration | null;
  /** The team required to choose the one locked Blind Declarer, if any. */
  blindDeclarationTeamId: TeamId | null;
  /** The locked Blind Declarer, retained through game completion for history. */
  blindDeclarerId: PlayerId | null;
  /** Present only once the terminal score establishes the winning team. */
  winnerTeamId: TeamId | null;
}>;

/** Preferred name for the full active-game state. Retained alias keeps Builds 03–06 compatible. */
export type GameState = NormalPlayGameState;

export type NormalPlayStateInput = Readonly<{
  players: readonly Player[];
  currentTurnOwner: PlayerId;
  resolvedSetIds?: readonly SetId[];
  phase?: GamePhase;
  normalAskingAllowed?: boolean;
  scores?: TeamScores;
  activeDeclaration?: ActiveDeclaration | null;
  blindDeclarationTeamId?: TeamId | null;
  blindDeclarerId?: PlayerId | null;
  winnerTeamId?: TeamId | null;
}>;

const isSetId = (value: unknown): value is SetId =>
  typeof value === "string" && (SET_IDS as readonly string[]).includes(value);

const isGamePhase = (value: unknown): value is GamePhase =>
  typeof value === "string" && (GAME_PHASES as readonly string[]).includes(value);

const copyPlayer = (player: Player): Player =>
  Object.freeze({ ...player, hand: Object.freeze([...player.hand]) });

const copyActiveDeclaration = (activeDeclaration: ActiveDeclaration): ActiveDeclaration =>
  Object.freeze({
    ...activeDeclaration,
    ownershipSnapshot: Object.freeze(activeDeclaration.ownershipSnapshot.map((ownership) => Object.freeze({ ...ownership }))),
  });

const validateScores = (scores: TeamScores, resolvedSetCount: number): void => {
  for (const teamId of TEAM_IDS) {
    const score = scores[teamId];
    if (!Number.isSafeInteger(score) || score < 0) {
      throw new GameDomainError("Normal-play scores must be non-negative safe integers for both teams.");
    }
  }
  if (scores.TEAM_A + scores.TEAM_B !== resolvedSetCount) {
    throw new GameDomainError("Normal-play scores must award exactly one point for every resolved set.");
  }
};

const validateActiveDeclaration = (
  activeDeclaration: ActiveDeclaration,
  players: readonly Player[],
  resolvedSetIds: readonly SetId[],
): void => {
  const declarer = players.find((player) => player.id === activeDeclaration.declarerId);
  if (!declarer) throw new GameDomainError("Active declaration declarer must be a player in the game.");
  if (declarer.teamId !== activeDeclaration.declarerTeamId) {
    throw new GameDomainError("Active declaration declarer team must match the declarer's team.");
  }
  if (!(DECLARATION_MODES as readonly string[]).includes(activeDeclaration.mode)) {
    throw new GameDomainError("Active declaration must have a known declaration mode.");
  }
  if (!players.some((player) => player.id === activeDeclaration.interruptedTurnOwner)) {
    throw new GameDomainError("Active declaration interrupted turn owner must be a player in the game.");
  }
  if (!isSetId(activeDeclaration.selectedSetId) || resolvedSetIds.includes(activeDeclaration.selectedSetId)) {
    throw new GameDomainError("Active declaration must select an unresolved known set.");
  }
  if (
    !Number.isFinite(activeDeclaration.startedAt)
    || !Number.isFinite(activeDeclaration.deadline)
    || activeDeclaration.deadline !== activeDeclaration.startedAt + DECLARATION_TIME_LIMIT_SECONDS
    || activeDeclaration.deadline - activeDeclaration.startedAt !== DECLARATION_TIME_LIMIT_SECONDS
  ) {
    throw new GameDomainError("Active declaration must use an exact authoritative 90-second deadline.");
  }

  const expectedCards = getCardsInSet(activeDeclaration.selectedSetId);
  const snapshot = activeDeclaration.ownershipSnapshot;
  const playerIds = new Set(players.map((player) => player.id));
  if (
    !Array.isArray(snapshot)
    || snapshot.length !== expectedCards.length
    || new Set(snapshot.map((ownership) => ownership.cardId)).size !== snapshot.length
    || !snapshot.every((ownership) => expectedCards.includes(ownership.cardId) && playerIds.has(ownership.ownerId))
  ) {
    throw new GameDomainError("Active declaration ownership snapshot must cover its selected set exactly once.");
  }
};

/** Returns true only when all three members of a team hold no active cards. */
export const teamHasZeroActiveCards = (
  players: readonly Player[],
  teamId: TeamId,
): boolean => {
  const teamPlayers = players.filter((player) => player.teamId === teamId);
  return teamPlayers.length === TEAM_SIZE && teamPlayers.every((player) => player.hand.length === 0);
};

/** Alias that reads naturally at transition call sites. */
export const hasTeamReachedZeroActiveCards = teamHasZeroActiveCards;

/**
 * Returns the sole team with no active cards. When both teams are empty (only
 * possible after all sets resolve), neither team can trigger Blind Declaration.
 */
export const getTeamWithZeroActiveCards = (players: readonly Player[]): TeamId | null => {
  const zeroCardTeams = TEAM_IDS.filter((teamId) => teamHasZeroActiveCards(players, teamId));
  return zeroCardTeams.length === 1 ? zeroCardTeams[0] : null;
};

export const getZeroActiveCardTeamId = getTeamWithZeroActiveCards;

/** Returns the other rules-defined team id. */
export const getOpposingTeamId = (teamId: TeamId): TeamId =>
  teamId === "TEAM_A" ? "TEAM_B" : "TEAM_A";

/** Retrieves the terminal winner without exposing any scoring policy to callers. */
export const getWinnerTeamId = (state: NormalPlayGameState): TeamId | null => state.winnerTeamId;
export const getWinningTeamId = getWinnerTeamId;

/**
 * Validates and freezes an active-game state. Every unresolved canonical card
 * must be held once; cards in resolved sets must be absent from active hands.
 */
export const createNormalPlayState = (input: NormalPlayStateInput): NormalPlayGameState => {
  if (!input || !Array.isArray(input.players)) {
    throw new GameDomainError("Normal-play state must include a players array.");
  }
  if (!input.players.every((player) => Array.isArray(player.hand))) {
    throw new GameDomainError("Each normal-play player must have a hand array.");
  }

  const playerSetups: readonly PlayerSetup[] = input.players.map((player) => ({
    id: player.id,
    displayName: player.displayName,
    teamId: player.teamId,
  }));
  validateTeamComposition(playerSetups);

  if (!input.players.some((player) => player.id === input.currentTurnOwner)) {
    throw new GameDomainError("Normal-play turn owner must be one of the six players.");
  }

  const resolvedSetIds = input.resolvedSetIds ?? [];
  if (!Array.isArray(resolvedSetIds) || !resolvedSetIds.every(isSetId)) {
    throw new GameDomainError("Normal-play resolved sets must use known set ids.");
  }
  if (new Set(resolvedSetIds).size !== resolvedSetIds.length) {
    throw new GameDomainError("Normal-play resolved sets must be unique.");
  }
  if (input.normalAskingAllowed !== undefined && typeof input.normalAskingAllowed !== "boolean") {
    throw new GameDomainError("Normal-play asking availability must be a boolean.");
  }

  const scores = input.scores ?? { TEAM_A: 0, TEAM_B: 0 };
  validateScores(scores, resolvedSetIds.length);

  const activeDeclaration = input.activeDeclaration ?? null;
  if (activeDeclaration !== null) {
    validateActiveDeclaration(activeDeclaration, input.players, resolvedSetIds);
  }
  const inferredPhase = activeDeclaration !== null
    ? activeDeclaration.mode === "BLIND" ? "BLIND_DECLARATION" : "DECLARING"
    : resolvedSetIds.length === TOTAL_SETS
      ? "GAME_OVER"
      : input.blindDeclarationTeamId !== undefined && input.blindDeclarationTeamId !== null
        ? "BLIND_DECLARATION"
        : "PLAYING";
  const phase = input.phase ?? inferredPhase;
  if (!isGamePhase(phase)) throw new GameDomainError("Normal-play phase must be a known lifecycle phase.");

  const blindDeclarationTeamId = input.blindDeclarationTeamId ?? null;
  const blindDeclarerId = input.blindDeclarerId ?? null;
  const requestedWinnerTeamId = input.winnerTeamId ?? null;
  const normalAskingAllowed = phase === "PLAYING";

  if (input.normalAskingAllowed !== undefined && input.normalAskingAllowed !== normalAskingAllowed) {
    throw new GameDomainError("Normal-play asking availability must match the authoritative game phase.");
  }

  if (phase === "PLAYING") {
    if (activeDeclaration !== null || blindDeclarationTeamId !== null || blindDeclarerId !== null || requestedWinnerTeamId !== null) {
      throw new GameDomainError("Playing state cannot retain declaration, Blind Declaration, or winner state.");
    }
    if (getTeamWithZeroActiveCards(input.players) !== null) {
      throw new GameDomainError("Playing state must enter Blind Declaration when a team has zero active cards.");
    }
  }
  if (phase === "DECLARING") {
    if (requestedWinnerTeamId !== null) {
      throw new GameDomainError("Declaring state cannot retain a winner.");
    }
    if (activeDeclaration === null || activeDeclaration.mode !== "NORMAL") {
      throw new GameDomainError("Declaring state requires an active normal declaration.");
    }
  }
  if (phase === "BLIND_DECLARATION") {
    if (
      blindDeclarationTeamId === null
      || requestedWinnerTeamId !== null
      || (activeDeclaration !== null && activeDeclaration.mode !== "BLIND")
    ) {
      throw new GameDomainError("Blind Declaration requires its eligible team, no winner, and only a Blind active declaration.");
    }
    const zeroCardTeamId = getTeamWithZeroActiveCards(input.players);
    if (zeroCardTeamId === null || blindDeclarationTeamId !== getOpposingTeamId(zeroCardTeamId)) {
      throw new GameDomainError("Blind Declaration team must oppose the sole team with zero active cards.");
    }
    if (activeDeclaration !== null && (
      blindDeclarerId === null || activeDeclaration.declarerId !== blindDeclarerId
    )) {
      throw new GameDomainError("An active Blind Declaration requires its selected Blind Declarer.");
    }
  } else if (blindDeclarationTeamId !== null || blindDeclarerId !== null) {
    if (phase !== "GAME_OVER") {
      throw new GameDomainError("Blind Declaration state is only valid during Blind Declaration lifecycle.");
    }
  }
  if (blindDeclarationTeamId !== null && !TEAM_IDS.includes(blindDeclarationTeamId)) {
    throw new GameDomainError("Blind Declaration team must be a known team.");
  }
  if (blindDeclarerId !== null) {
    const blindDeclarer = input.players.find((player) => player.id === blindDeclarerId);
    if (!blindDeclarer || blindDeclarer.teamId !== blindDeclarationTeamId) {
      throw new GameDomainError("Blind Declarer must be a player on the Blind Declaration team.");
    }
  }

  if (resolvedSetIds.length === TOTAL_SETS && phase !== "GAME_OVER") {
    throw new GameDomainError("All resolved sets require the terminal game-over phase.");
  }

  const activeCards = input.players.flatMap((player) => player.hand);
  const expectedActiveCards = CANONICAL_DECK
    .map((card) => card.id)
    .filter((cardId) => !resolvedSetIds.includes(getSetForCard(cardId)));
  const expectedCardIds = new Set<CardId>(expectedActiveCards);

  if (
    activeCards.length !== expectedActiveCards.length
    || new Set(activeCards).size !== activeCards.length
    || activeCards.some((cardId) => !expectedCardIds.has(cardId))
    || activeCards.some((cardId) => resolvedSetIds.includes(getSetForCard(cardId)))
  ) {
    throw new GameDomainError("Normal-play hands must contain every active canonical card exactly once.");
  }

  let winnerTeamId: TeamId | null = null;
  if (phase === "GAME_OVER") {
    if (activeDeclaration !== null || resolvedSetIds.length !== TOTAL_SETS || activeCards.length !== 0) {
      throw new GameDomainError("Game over requires all sets resolved, no active cards, and no active declaration.");
    }
    winnerTeamId = scores.TEAM_A > scores.TEAM_B ? "TEAM_A" : "TEAM_B";
    if (requestedWinnerTeamId !== null && requestedWinnerTeamId !== winnerTeamId) {
      throw new GameDomainError("Game-over winner must match the final score.");
    }
    if (blindDeclarationTeamId !== null && blindDeclarerId === null) {
      throw new GameDomainError("Completed Blind Declaration games retain their selected Blind Declarer.");
    }
  } else if (requestedWinnerTeamId !== null) {
    throw new GameDomainError("Only a game-over state may retain a winner.");
  }

  return Object.freeze({
    players: Object.freeze(input.players.map(copyPlayer)),
    teams: createTeams(playerSetups),
    currentTurnOwner: input.currentTurnOwner,
    resolvedSetIds: Object.freeze([...resolvedSetIds]),
    phase,
    normalAskingAllowed,
    scores: Object.freeze({ TEAM_A: scores.TEAM_A, TEAM_B: scores.TEAM_B }),
    activeDeclaration: activeDeclaration === null ? null : copyActiveDeclaration(activeDeclaration),
    blindDeclarationTeamId,
    blindDeclarerId,
    winnerTeamId,
  });
};
