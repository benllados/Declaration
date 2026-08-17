import type { AskResult } from "@/game/engine/asking";
import type {
  BlindDeclarerSelectionResult,
} from "@/game/engine/blind-declaration";
import type {
  DeclarationResolutionResult,
  DeclarationStartResult,
} from "@/game/engine/declaration";
import type { CardId } from "@/game/cards";
import type { SetId } from "@/game/sets";
import type { PlayerId } from "@/game/types/player";
import type { PlayerGameView } from "@/lib/local-game/player-view";

/** Public action types accepted by a future browser transport. */
export const PUBLIC_ACTION_TYPES = [
  "ASK",
  "START_DECLARATION",
  "SUBMIT_DECLARATION",
  "SELECT_BLIND_DECLARER",
] as const;

export type PublicActionType = (typeof PUBLIC_ACTION_TYPES)[number];

export type AskPayload = Readonly<{
  targetPlayerId: PlayerId;
  requestedCardId: CardId;
}>;

export type StartDeclarationPayload = Readonly<{
  selectedSetId: SetId;
}>;

export type DeclarationAssignmentPayload = Readonly<{
  cardId: CardId;
  playerId: PlayerId;
}>;

export type SubmitDeclarationPayload = Readonly<{
  assignments: readonly DeclarationAssignmentPayload[];
}>;

export type SelectBlindDeclarerPayload = Readonly<{
  blindDeclarerId: PlayerId;
}>;

export type PublicGameAction =
  | Readonly<{
    gameId: string;
    actionId: string;
    expectedRevision: number;
    type: "ASK";
    payload: AskPayload;
  }>
  | Readonly<{
    gameId: string;
    actionId: string;
    expectedRevision: number;
    type: "START_DECLARATION";
    payload: StartDeclarationPayload;
  }>
  | Readonly<{
    gameId: string;
    actionId: string;
    expectedRevision: number;
    type: "SUBMIT_DECLARATION";
    payload: SubmitDeclarationPayload;
  }>
  | Readonly<{
    gameId: string;
    actionId: string;
    expectedRevision: number;
    type: "SELECT_BLIND_DECLARER";
    payload: SelectBlindDeclarerPayload;
  }>;

/** The start outcome omits an implementation detail that presentation does not need. */
export type SafeDeclarationStartOutcome =
  | Omit<Extract<DeclarationStartResult, { kind: "STARTED" }>, "interruptedTurnOwner">
  | Extract<DeclarationStartResult, { kind: "INVALID_START" }>;

/** Service authorization failure, intentionally free of hidden game detail. */
export type SafeAuthorizationOutcome = Readonly<{
  kind: "ACTION_NOT_AUTHORIZED";
  reason: "ACTOR_NOT_ON_BLIND_DECLARATION_TEAM";
}>;

/**
 * Engine results are deliberately state-free. This union adds only the one
 * application-level authorization outcome required by the frozen engine.
 */
export type SafeActionOutcome =
  | AskResult
  | SafeDeclarationStartOutcome
  | DeclarationResolutionResult
  | BlindDeclarerSelectionResult
  | SafeAuthorizationOutcome;

export const ACTION_RESPONSE_STATUSES = [
  "APPLIED",
  "REJECTED",
  "CONFLICT",
  "DUPLICATE",
  "VALIDATION_ERROR",
] as const;

export type ActionResponseStatus = (typeof ACTION_RESPONSE_STATUSES)[number];

/** A player-scoped response that never contains authoritative game state. */
export type PublicActionResponse = Readonly<{
  status: ActionResponseStatus;
  actionId: string;
  revision: number;
  view?: PlayerGameView;
  outcome?: SafeActionOutcome;
}>;

/** The sole public shape returned by a scoped read. */
export type ScopedGameView = Readonly<{
  revision: number;
  view: PlayerGameView;
}>;
