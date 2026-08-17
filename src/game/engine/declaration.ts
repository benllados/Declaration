import { CARDS_BY_ID, type CardId } from "../cards";
import { DECLARATION_TIME_LIMIT_SECONDS, TOTAL_SETS } from "../constants/game";
import { getCardOwner } from "../hands";
import { getCardsInSet, SET_IDS, type SetId } from "../sets";
import type {
  ActiveDeclaration,
  AuthoritativeTimestamp,
  DeclarationCardOwnership,
  DeclarationMode,
} from "../types/declaration";
import type { PlayerId } from "../types/player";
import type { TeamId } from "../types/team";
import {
  createNormalPlayState,
  getOpposingTeamId,
  getTeamWithZeroActiveCards,
  type GamePhase,
  type NormalPlayGameState,
} from "./normal-play";

/** An official declaration locks its set before normal play is frozen. */
export type StartDeclarationAction = Readonly<{
  declarerId: PlayerId;
  selectedSetId: SetId;
  startedAt: AuthoritativeTimestamp;
}>;

/** A submission only assigns the set already locked in activeDeclaration. */
export type DeclarationAssignment = Readonly<{
  cardId: CardId;
  playerId: PlayerId;
}>;

export type DeclarationSubmission = Readonly<{
  declarerId: PlayerId;
  assignments: readonly DeclarationAssignment[];
  submittedAt: AuthoritativeTimestamp;
}>;

export const INVALID_DECLARATION_START_REASONS = [
  "INVALID_DECLARER",
  "INVALID_SELECTED_SET",
  "SET_ALREADY_RESOLVED",
  "INVALID_STARTED_AT",
  "DECLARATION_ALREADY_ACTIVE",
  "NORMAL_PLAY_NOT_AVAILABLE",
  "BLIND_DECLARER_NOT_SELECTED",
  "NOT_BLIND_DECLARER",
  "GAME_OVER",
] as const;
export type InvalidDeclarationStartReason = (typeof INVALID_DECLARATION_START_REASONS)[number];

export const INVALID_DECLARATION_SUBMISSION_REASONS = [
  "NO_ACTIVE_DECLARATION",
  "WRONG_DECLARER",
  "INVALID_SUBMISSION_TIMESTAMP",
  "INVALID_ASSIGNMENTS",
  "ASSIGNMENT_COUNT_MISMATCH",
  "INVALID_ASSIGNED_CARD",
  "DUPLICATE_ASSIGNED_CARD",
  "CARD_OUTSIDE_SELECTED_SET",
  "INVALID_ASSIGNED_PLAYER",
  "ASSIGNED_PLAYER_IS_OPPONENT",
] as const;
export type InvalidDeclarationSubmissionReason =
  (typeof INVALID_DECLARATION_SUBMISSION_REASONS)[number];

export type DeclarationStartResult =
  | Readonly<{
    kind: "STARTED";
    declarerId: PlayerId;
    declarerTeamId: TeamId;
    selectedSetId: SetId;
    deadline: AuthoritativeTimestamp;
    interruptedTurnOwner: PlayerId;
  }>
  | Readonly<{ kind: "INVALID_START"; reason: InvalidDeclarationStartReason }>;

export type DeclarationResolutionResult =
  | Readonly<{
    kind: "CORRECT";
    declarerId: PlayerId;
    selectedSetId: SetId;
    scoringTeamId: TeamId;
    resultingTurnOwner: PlayerId;
  }>
  | Readonly<{
    kind: "INCORRECT";
    declarerId: PlayerId;
    selectedSetId: SetId;
    scoringTeamId: TeamId;
    resultingTurnOwner: PlayerId;
  }>
  | Readonly<{
    kind: "TIMED_OUT";
    declarerId: PlayerId;
    selectedSetId: SetId;
    scoringTeamId: TeamId;
    resultingTurnOwner: PlayerId;
  }>
  | Readonly<{ kind: "INVALID_SUBMISSION"; reason: InvalidDeclarationSubmissionReason }>;

export type DeclarationSubmissionValidationResult =
  | Readonly<{ status: "VALID" }>
  | Readonly<{ status: "INVALID"; reason: InvalidDeclarationSubmissionReason }>
  | Readonly<{ status: "TIMED_OUT"; deadline: AuthoritativeTimestamp }>;

export type DeclarationStartResolution = Readonly<{
  state: NormalPlayGameState;
  result: DeclarationStartResult;
}>;

export type DeclarationSubmissionResolution = Readonly<{
  state: NormalPlayGameState;
  result: DeclarationResolutionResult;
}>;

export type DeclarationTimeoutAction = Readonly<{ resolvedAt: AuthoritativeTimestamp }>;
export type DeclarationTimeoutResult =
  | Extract<DeclarationResolutionResult, { kind: "TIMED_OUT" }>
  | Readonly<{ kind: "INVALID_TIMEOUT"; reason: "NO_ACTIVE_DECLARATION" | "INVALID_TIMEOUT_TIMESTAMP" }>
  | Readonly<{ kind: "TIMEOUT_NOT_REACHED"; deadline: AuthoritativeTimestamp }>;
export type DeclarationTimeoutResolution = Readonly<{
  state: NormalPlayGameState;
  result: DeclarationTimeoutResult;
}>;

const isSetId = (value: unknown): value is SetId =>
  typeof value === "string" && (SET_IDS as readonly string[]).includes(value);

const isCanonicalCardId = (value: unknown): value is CardId =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(CARDS_BY_ID, value);

const isFiniteTimestamp = (value: unknown): value is AuthoritativeTimestamp =>
  typeof value === "number" && Number.isFinite(value);

const withDeclarationState = (
  state: NormalPlayGameState,
  input: Readonly<{
    activeDeclaration: ActiveDeclaration | null;
    resolvedSetIds?: readonly SetId[];
    scores?: NormalPlayGameState["scores"];
    phase: GamePhase;
    currentTurnOwner?: PlayerId;
    players?: NormalPlayGameState["players"];
    blindDeclarationTeamId?: TeamId | null;
    blindDeclarerId?: PlayerId | null;
    winnerTeamId?: TeamId | null;
  }>,
): NormalPlayGameState =>
  createNormalPlayState({
    players: input.players ?? state.players,
    currentTurnOwner: input.currentTurnOwner ?? state.currentTurnOwner,
    resolvedSetIds: input.resolvedSetIds ?? state.resolvedSetIds,
    phase: input.phase,
    scores: input.scores ?? state.scores,
    activeDeclaration: input.activeDeclaration,
    blindDeclarationTeamId: input.blindDeclarationTeamId ?? state.blindDeclarationTeamId,
    blindDeclarerId: input.blindDeclarerId ?? state.blindDeclarerId,
    winnerTeamId: input.winnerTeamId ?? state.winnerTeamId,
  });

const getOwnershipSnapshot = (
  state: NormalPlayGameState,
  selectedSetId: SetId,
): readonly DeclarationCardOwnership[] =>
  Object.freeze(getCardsInSet(selectedSetId).map((cardId) => Object.freeze({
    cardId,
    ownerId: getCardOwner(state.players, cardId)!.id,
  })));

/**
 * Starts the official declaration after the declarer has locked an unresolved
 * set. UI set browsing alone is not an action in the authoritative engine.
 */
export const startDeclaration = (
  state: NormalPlayGameState,
  action: StartDeclarationAction,
): DeclarationStartResolution => {
  if (state.activeDeclaration !== null) {
    return { state, result: { kind: "INVALID_START", reason: "DECLARATION_ALREADY_ACTIVE" } };
  }
  if (state.phase === "GAME_OVER") {
    return { state, result: { kind: "INVALID_START", reason: "GAME_OVER" } };
  }
  if (state.phase === "DECLARING") {
    return { state, result: { kind: "INVALID_START", reason: "NORMAL_PLAY_NOT_AVAILABLE" } };
  }
  const declarer = state.players.find((player) => player.id === action.declarerId);
  if (!declarer) return { state, result: { kind: "INVALID_START", reason: "INVALID_DECLARER" } };
  let mode: DeclarationMode = "NORMAL";
  if (state.phase === "BLIND_DECLARATION") {
    if (state.blindDeclarerId === null) {
      return { state, result: { kind: "INVALID_START", reason: "BLIND_DECLARER_NOT_SELECTED" } };
    }
    if (action.declarerId !== state.blindDeclarerId) {
      return { state, result: { kind: "INVALID_START", reason: "NOT_BLIND_DECLARER" } };
    }
    mode = "BLIND";
  }
  if (!isSetId(action.selectedSetId)) {
    return { state, result: { kind: "INVALID_START", reason: "INVALID_SELECTED_SET" } };
  }
  if (state.resolvedSetIds.includes(action.selectedSetId)) {
    return { state, result: { kind: "INVALID_START", reason: "SET_ALREADY_RESOLVED" } };
  }
  if (!isFiniteTimestamp(action.startedAt)) {
    return { state, result: { kind: "INVALID_START", reason: "INVALID_STARTED_AT" } };
  }

  const deadline = action.startedAt + DECLARATION_TIME_LIMIT_SECONDS;
  const activeDeclaration: ActiveDeclaration = Object.freeze({
    declarerId: action.declarerId,
    declarerTeamId: declarer.teamId,
    mode,
    selectedSetId: action.selectedSetId,
    startedAt: action.startedAt,
    deadline,
    interruptedTurnOwner: state.currentTurnOwner,
    ownershipSnapshot: getOwnershipSnapshot(state, action.selectedSetId),
  });
  const nextState = withDeclarationState(state, {
    activeDeclaration,
    phase: mode === "BLIND" ? "BLIND_DECLARATION" : "DECLARING",
  });

  return {
    state: nextState,
    result: {
      kind: "STARTED",
      declarerId: action.declarerId,
      declarerTeamId: declarer.teamId,
      selectedSetId: action.selectedSetId,
      deadline,
      interruptedTurnOwner: state.currentTurnOwner,
    },
  };
};

const isDeclarationAssignment = (value: unknown): value is DeclarationAssignment =>
  typeof value === "object"
  && value !== null
  && "cardId" in value
  && "playerId" in value;

/**
 * Checks a complete assignment without revealing its correctness. A timestamp
 * exactly equal to the deadline is valid; only a later timestamp times out.
 */
export const validateDeclarationSubmission = (
  state: NormalPlayGameState,
  submission: DeclarationSubmission,
): DeclarationSubmissionValidationResult => {
  const activeDeclaration = state.activeDeclaration;
  if (activeDeclaration === null) return { status: "INVALID", reason: "NO_ACTIVE_DECLARATION" };
  if (!isFiniteTimestamp(submission.submittedAt)) {
    return { status: "INVALID", reason: "INVALID_SUBMISSION_TIMESTAMP" };
  }
  if (submission.submittedAt > activeDeclaration.deadline) {
    return { status: "TIMED_OUT", deadline: activeDeclaration.deadline };
  }
  if (submission.declarerId !== activeDeclaration.declarerId) {
    return { status: "INVALID", reason: "WRONG_DECLARER" };
  }
  if (!Array.isArray(submission.assignments) || !submission.assignments.every(isDeclarationAssignment)) {
    return { status: "INVALID", reason: "INVALID_ASSIGNMENTS" };
  }

  const requiredCards = getCardsInSet(activeDeclaration.selectedSetId);
  if (submission.assignments.length !== requiredCards.length) {
    return { status: "INVALID", reason: "ASSIGNMENT_COUNT_MISMATCH" };
  }
  if (!submission.assignments.every((assignment) => isCanonicalCardId(assignment.cardId))) {
    return { status: "INVALID", reason: "INVALID_ASSIGNED_CARD" };
  }
  if (new Set(submission.assignments.map((assignment) => assignment.cardId)).size !== submission.assignments.length) {
    return { status: "INVALID", reason: "DUPLICATE_ASSIGNED_CARD" };
  }
  if (!submission.assignments.every((assignment) => requiredCards.includes(assignment.cardId))) {
    return { status: "INVALID", reason: "CARD_OUTSIDE_SELECTED_SET" };
  }

  const playersById = new Map(state.players.map((player) => [player.id, player]));
  for (const assignment of submission.assignments) {
    const assignee = playersById.get(assignment.playerId);
    if (!assignee) return { status: "INVALID", reason: "INVALID_ASSIGNED_PLAYER" };
    if (assignee.teamId !== activeDeclaration.declarerTeamId) {
      return { status: "INVALID", reason: "ASSIGNED_PLAYER_IS_OPPONENT" };
    }
  }

  return { status: "VALID" };
};

const resolveActiveDeclaration = (
  state: NormalPlayGameState,
  outcome: "CORRECT" | "INCORRECT" | "TIMED_OUT",
): DeclarationSubmissionResolution => {
  const activeDeclaration = state.activeDeclaration!;
  const scoringTeamId = outcome === "CORRECT"
    ? activeDeclaration.declarerTeamId
    : getOpposingTeamId(activeDeclaration.declarerTeamId);
  const scores = {
    ...state.scores,
    [scoringTeamId]: state.scores[scoringTeamId] + 1,
  };
  const selectedCards = new Set(getCardsInSet(activeDeclaration.selectedSetId));
  const players = state.players.map((player) => ({
    ...player,
    hand: player.hand.filter((cardId) => !selectedCards.has(cardId)),
  }));
  const resolvedSetIds = [...state.resolvedSetIds, activeDeclaration.selectedSetId];
  const phase: GamePhase = resolvedSetIds.length === TOTAL_SETS
    ? "GAME_OVER"
    : activeDeclaration.mode === "BLIND"
      ? "BLIND_DECLARATION"
      : getTeamWithZeroActiveCards(players) === null ? "PLAYING" : "BLIND_DECLARATION";
  const zeroCardTeamId = getTeamWithZeroActiveCards(players);
  const blindDeclarationTeamId = phase === "BLIND_DECLARATION" && activeDeclaration.mode === "NORMAL"
    ? getOpposingTeamId(zeroCardTeamId!)
    : state.blindDeclarationTeamId;
  const nextState = withDeclarationState(state, {
    players,
    currentTurnOwner: activeDeclaration.interruptedTurnOwner,
    resolvedSetIds,
    scores,
    activeDeclaration: null,
    phase,
    blindDeclarationTeamId,
    blindDeclarerId: state.blindDeclarerId,
  });

  return {
    state: nextState,
    result: {
      kind: outcome,
      declarerId: activeDeclaration.declarerId,
      selectedSetId: activeDeclaration.selectedSetId,
      scoringTeamId,
      resultingTurnOwner: activeDeclaration.interruptedTurnOwner,
    },
  };
};

/** Resolves a complete timely submission against the start-time ownership snapshot. */
export const submitDeclaration = (
  state: NormalPlayGameState,
  submission: DeclarationSubmission,
): DeclarationSubmissionResolution => {
  const validation = validateDeclarationSubmission(state, submission);
  if (validation.status === "TIMED_OUT") return resolveActiveDeclaration(state, "TIMED_OUT");
  if (validation.status === "INVALID") {
    return { state, result: { kind: "INVALID_SUBMISSION", reason: validation.reason } };
  }

  const activeDeclaration = state.activeDeclaration!;
  const submittedOwners = new Map(submission.assignments.map((assignment) => [assignment.cardId, assignment.playerId]));
  const isCorrect = activeDeclaration.ownershipSnapshot.every(
    (ownership) => submittedOwners.get(ownership.cardId) === ownership.ownerId,
  );
  return resolveActiveDeclaration(state, isCorrect ? "CORRECT" : "INCORRECT");
};

/**
 * Resolves an expired declaration without a submission. At the exact deadline
 * it remains active because a complete submission at that instant is timely.
 */
export const resolveDeclarationTimeout = (
  state: NormalPlayGameState,
  action: DeclarationTimeoutAction,
): DeclarationTimeoutResolution => {
  const activeDeclaration = state.activeDeclaration;
  if (activeDeclaration === null) {
    return { state, result: { kind: "INVALID_TIMEOUT", reason: "NO_ACTIVE_DECLARATION" } };
  }
  if (!isFiniteTimestamp(action.resolvedAt)) {
    return { state, result: { kind: "INVALID_TIMEOUT", reason: "INVALID_TIMEOUT_TIMESTAMP" } };
  }
  if (action.resolvedAt <= activeDeclaration.deadline) {
    return { state, result: { kind: "TIMEOUT_NOT_REACHED", deadline: activeDeclaration.deadline } };
  }
  const resolution = resolveActiveDeclaration(state, "TIMED_OUT");
  return {
    state: resolution.state,
    result: resolution.result as Extract<DeclarationResolutionResult, { kind: "TIMED_OUT" }>,
  };
};
