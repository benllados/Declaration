import { CANONICAL_DECK, type CardId } from "../cards";
import { GameDomainError } from "../errors";
import { getSetForCard, SET_IDS, type SetId } from "../sets";
import { createTeams, validateTeamComposition } from "../teams";
import type { Player, PlayerId, PlayerSetup } from "../types/player";
import type { Team } from "../types/team";

/**
 * Authoritative state required for normal asking. Resolved sets are represented
 * only so their cards can no longer be requested; set resolution is out of scope.
 */
export type NormalPlayGameState = Readonly<{
  players: readonly Player[];
  teams: readonly Team[];
  currentTurnOwner: PlayerId;
  resolvedSetIds: readonly SetId[];
  normalAskingAllowed: boolean;
}>;

export type NormalPlayStateInput = Readonly<{
  players: readonly Player[];
  currentTurnOwner: PlayerId;
  resolvedSetIds?: readonly SetId[];
  normalAskingAllowed?: boolean;
}>;

const isSetId = (value: unknown): value is SetId =>
  typeof value === "string" && (SET_IDS as readonly string[]).includes(value);

const copyPlayer = (player: Player): Player =>
  Object.freeze({ ...player, hand: Object.freeze([...player.hand]) });

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
    normalAskingAllowed: input.normalAskingAllowed ?? true,
  });
};
