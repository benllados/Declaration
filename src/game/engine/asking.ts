import { CARDS_BY_ID, type CardId } from "../cards";
import { getSetForCard } from "../sets";
import type { Player, PlayerId } from "../types/player";
import { createNormalPlayState, type NormalPlayGameState } from "./normal-play";

/** The client expresses this intent; it cannot determine any outcome. */
export type AskAction = Readonly<{
  asker: PlayerId;
  target: PlayerId;
  requestedCard: CardId;
}>;

export const ASK_ILLEGAL_REASONS = [
  "NOT_TURN_OWNER",
  "TARGET_IS_SELF",
  "TARGET_IS_TEAMMATE",
  "TARGET_HAS_NO_CARDS",
  "SET_ALREADY_RESOLVED",
  "REQUESTED_CARD_ALREADY_OWNED",
  "NO_CARD_FROM_REQUESTED_SET",
  "NORMAL_ASKING_NOT_ALLOWED",
] as const;
export type AskIllegalReason = (typeof ASK_ILLEGAL_REASONS)[number];

export const INVALID_ASK_REASONS = [
  "INVALID_ASKER",
  "INVALID_TARGET",
  "INVALID_REQUESTED_CARD",
] as const;
export type InvalidAskReason = (typeof INVALID_ASK_REASONS)[number];

export type AskValidationResult =
  | Readonly<{ status: "LEGAL" }>
  | Readonly<{ status: "ILLEGAL"; reason: AskIllegalReason }>
  | Readonly<{ status: "INVALID"; reason: InvalidAskReason }>;

export type AskResult =
  | Readonly<{
    kind: "SUCCESS";
    asker: PlayerId;
    target: PlayerId;
    requestedCard: CardId;
    resultingTurnOwner: PlayerId;
  }>
  | Readonly<{
    kind: "UNSUCCESSFUL";
    asker: PlayerId;
    target: PlayerId;
    requestedCard: CardId;
    resultingTurnOwner: PlayerId;
  }>
  | Readonly<{
    kind: "ILLEGAL";
    asker: PlayerId;
    target: PlayerId;
    requestedCard: CardId;
    reason: AskIllegalReason;
    resultingTurnOwner: PlayerId;
  }>
  | Readonly<{ kind: "INVALID"; reason: InvalidAskReason }>;

/** The state remains server-only; AskResult deliberately omits all hand contents. */
export type AskResolution = Readonly<{
  state: NormalPlayGameState;
  result: AskResult;
}>;

const isCanonicalCardId = (cardId: unknown): cardId is CardId =>
  typeof cardId === "string" && Object.prototype.hasOwnProperty.call(CARDS_BY_ID, cardId);

const getPlayer = (state: NormalPlayGameState, playerId: PlayerId): Player | undefined =>
  state.players.find((player) => player.id === playerId);

/** Validates an ask without disclosing whether the target owns the requested card. */
export const validateAsk = (
  state: NormalPlayGameState,
  action: AskAction,
): AskValidationResult => {
  const asker = getPlayer(state, action.asker);
  if (!asker) return { status: "INVALID", reason: "INVALID_ASKER" };

  const target = getPlayer(state, action.target);
  if (!target) return { status: "INVALID", reason: "INVALID_TARGET" };

  if (!isCanonicalCardId(action.requestedCard)) {
    return { status: "INVALID", reason: "INVALID_REQUESTED_CARD" };
  }
  if (!state.normalAskingAllowed) {
    return { status: "ILLEGAL", reason: "NORMAL_ASKING_NOT_ALLOWED" };
  }
  if (state.currentTurnOwner !== action.asker) {
    return { status: "ILLEGAL", reason: "NOT_TURN_OWNER" };
  }
  if (action.asker === action.target) {
    return { status: "ILLEGAL", reason: "TARGET_IS_SELF" };
  }
  if (asker.teamId === target.teamId) {
    return { status: "ILLEGAL", reason: "TARGET_IS_TEAMMATE" };
  }
  if (target.hand.length === 0) {
    return { status: "ILLEGAL", reason: "TARGET_HAS_NO_CARDS" };
  }

  const requestedSetId = getSetForCard(action.requestedCard);
  if (state.resolvedSetIds.includes(requestedSetId)) {
    return { status: "ILLEGAL", reason: "SET_ALREADY_RESOLVED" };
  }
  if (asker.hand.includes(action.requestedCard)) {
    return { status: "ILLEGAL", reason: "REQUESTED_CARD_ALREADY_OWNED" };
  }
  if (!asker.hand.some((cardId) => getSetForCard(cardId) === requestedSetId)) {
    return { status: "ILLEGAL", reason: "NO_CARD_FROM_REQUESTED_SET" };
  }

  return { status: "LEGAL" };
};

const withTurnOwner = (
  state: NormalPlayGameState,
  currentTurnOwner: PlayerId,
): NormalPlayGameState =>
  createNormalPlayState({
    players: state.players,
    currentTurnOwner,
    resolvedSetIds: state.resolvedSetIds,
    normalAskingAllowed: state.normalAskingAllowed,
    scores: state.scores,
    activeDeclaration: state.activeDeclaration,
  });

const transferRequestedCard = (
  state: NormalPlayGameState,
  askerId: PlayerId,
  targetId: PlayerId,
  requestedCard: CardId,
): NormalPlayGameState =>
  createNormalPlayState({
    players: state.players.map((player) => {
      if (player.id === targetId) {
        return { ...player, hand: player.hand.filter((cardId) => cardId !== requestedCard) };
      }
      if (player.id === askerId) {
        return { ...player, hand: [...player.hand, requestedCard] };
      }
      return player;
    }),
    currentTurnOwner: askerId,
    resolvedSetIds: state.resolvedSetIds,
    normalAskingAllowed: state.normalAskingAllowed,
    scores: state.scores,
    activeDeclaration: state.activeDeclaration,
  });

/**
 * Resolves a single normal-play ask. Invalid action shapes leave state unchanged;
 * rule-illegal asks give the turn to their real target, except an active
 * declaration freezes the interrupted turn completely.
 */
export const resolveAsk = (
  state: NormalPlayGameState,
  action: AskAction,
): AskResolution => {
  const validation = validateAsk(state, action);

  if (validation.status === "INVALID") {
    return { state, result: { kind: "INVALID", reason: validation.reason } };
  }

  if (validation.status === "ILLEGAL") {
    const isBlockedByActiveDeclaration = validation.reason === "NORMAL_ASKING_NOT_ALLOWED"
      && state.activeDeclaration !== null;
    const resultingTurnOwner = isBlockedByActiveDeclaration ? state.currentTurnOwner : action.target;
    return {
      state: isBlockedByActiveDeclaration ? state : withTurnOwner(state, action.target),
      result: {
        kind: "ILLEGAL",
        asker: action.asker,
        target: action.target,
        requestedCard: action.requestedCard,
        reason: validation.reason,
        resultingTurnOwner,
      },
    };
  }

  const target = getPlayer(state, action.target)!;
  if (target.hand.includes(action.requestedCard)) {
    return {
      state: transferRequestedCard(state, action.asker, action.target, action.requestedCard),
      result: {
        kind: "SUCCESS",
        asker: action.asker,
        target: action.target,
        requestedCard: action.requestedCard,
        resultingTurnOwner: action.asker,
      },
    };
  }

  return {
    state: withTurnOwner(state, action.target),
    result: {
      kind: "UNSUCCESSFUL",
      asker: action.asker,
      target: action.target,
      requestedCard: action.requestedCard,
      resultingTurnOwner: action.target,
    },
  };
};
