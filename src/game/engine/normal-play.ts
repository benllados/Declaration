import { CANONICAL_DECK, type CardId } from "../cards";
import { DECLARATION_TIME_LIMIT_SECONDS } from "../constants/game";
import { GameDomainError } from "../errors";
import { getCardsInSet, getSetForCard, SET_IDS, type SetId } from "../sets";
import { createTeams, validateTeamComposition } from "../teams";
import type { ActiveDeclaration, TeamScores } from "../types/declaration";
import type { Player, PlayerId, PlayerSetup } from "../types/player";
import { TEAM_IDS, type Team } from "../types/team";

/**
 * Authoritative state for normal play and its possible declaration interruption.
 */
export type NormalPlayGameState = Readonly<{
  players: readonly Player[];
  teams: readonly Team[];
  currentTurnOwner: PlayerId;
  resolvedSetIds: readonly SetId[];
  normalAskingAllowed: boolean;
  scores: TeamScores;
  activeDeclaration: ActiveDeclaration | null;
}>;

export type NormalPlayStateInput = Readonly<{
  players: readonly Player[];
  currentTurnOwner: PlayerId;
  resolvedSetIds?: readonly SetId[];
  normalAskingAllowed?: boolean;
  scores?: TeamScores;
  activeDeclaration?: ActiveDeclaration | null;
}>;

const isSetId = (value: unknown): value is SetId =>
  typeof value === "string" && (SET_IDS as readonly string[]).includes(value);

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

/**
 * Validates and freezes a normal-play state. Every unresolved canonical card
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
  const normalAskingAllowed = input.normalAskingAllowed ?? activeDeclaration === null;
  if (activeDeclaration !== null && normalAskingAllowed) {
    throw new GameDomainError("Normal asking must be unavailable while a declaration is active.");
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

  return Object.freeze({
    players: Object.freeze(input.players.map(copyPlayer)),
    teams: createTeams(playerSetups),
    currentTurnOwner: input.currentTurnOwner,
    resolvedSetIds: Object.freeze([...resolvedSetIds]),
    normalAskingAllowed,
    scores: Object.freeze({ TEAM_A: scores.TEAM_A, TEAM_B: scores.TEAM_B }),
    activeDeclaration: activeDeclaration === null ? null : copyActiveDeclaration(activeDeclaration),
  });
};
