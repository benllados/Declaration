import { CARDS_BY_ID, type CardId } from "@/game/cards";
import {
  GAME_PHASES,
  createNormalPlayState,
  type GamePhase,
  type NormalPlayGameState,
} from "@/game/engine/normal-play";
import {
  ASK_ILLEGAL_REASONS,
  INVALID_ASK_REASONS,
} from "@/game/engine/asking";
import {
  INVALID_BLIND_DECLARER_SELECTION_REASONS,
} from "@/game/engine/blind-declaration";
import {
  INVALID_DECLARATION_START_REASONS,
  INVALID_DECLARATION_SUBMISSION_REASONS,
} from "@/game/engine/declaration";
import { SET_IDS, type SetId } from "@/game/sets";
import {
  DECLARATION_MODES,
  type ActiveDeclaration,
  type DeclarationCardOwnership,
  type DeclarationMode,
  type TeamScores,
} from "@/game/types/declaration";
import { createPlayerId, type Player, type PlayerId } from "@/game/types/player";
import { TEAM_IDS, isTeamId, type Team, type TeamId } from "@/game/types/team";
import type { SafeActionOutcome } from "@/lib/multiplayer/contracts";
import type { DecodeResult } from "@/lib/multiplayer/action-codec";
import { isOpaqueId } from "@/lib/multiplayer/action-codec";

export const ENGINE_VERSION = "declaration-v1" as const;
export type EngineVersion = typeof ENGINE_VERSION;

export type ProcessedActionReceipt = Readonly<{
  seatId: string;
  actionId: string;
  status: "APPLIED" | "REJECTED";
  outcome: SafeActionOutcome;
  resultingRevision: number;
}>;

/** Provider-neutral, JSON-safe record; only repositories may expose it. */
export type StoredGameRecord = Readonly<{
  gameId: string;
  engineVersion: EngineVersion;
  revision: number;
  state: NormalPlayGameState;
  processedActions: readonly ProcessedActionReceipt[];
}>;

const failure = <T = never>(reason: string): DecodeResult<T> => ({ ok: false, reason });
const success = <T>(value: T): DecodeResult<T> => ({ ok: true, value });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
};

const decodeObject = (value: unknown, keys: readonly string[], label: string): DecodeResult<Record<string, unknown>> =>
  isRecord(value) && hasExactKeys(value, keys)
    ? success(value)
    : failure(`${label} must contain exactly its documented fields.`);

const decodeSafeInteger = (value: unknown, label: string): DecodeResult<number> =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? success(value)
    : failure(`${label} must be a non-negative safe integer.`);

const decodeTimestamp = (value: unknown, label: string): DecodeResult<number> =>
  typeof value === "number" && Number.isFinite(value)
    ? success(value)
    : failure(`${label} must be a finite timestamp.`);

const decodePlayerId = (value: unknown, label: string): DecodeResult<PlayerId> =>
  isOpaqueId(value) ? success(createPlayerId(value)) : failure(`${label} must be a well-formed identifier.`);

const decodeCardId = (value: unknown, label: string): DecodeResult<CardId> =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(CARDS_BY_ID, value)
    ? success(value as CardId)
    : failure(`${label} must be a canonical card id.`);

const decodeSetId = (value: unknown, label: string): DecodeResult<SetId> =>
  typeof value === "string" && (SET_IDS as readonly string[]).includes(value)
    ? success(value as SetId)
    : failure(`${label} must be a known set id.`);

const decodeTeamId = (value: unknown, label: string): DecodeResult<TeamId> =>
  isTeamId(value) ? success(value) : failure(`${label} must be a known team id.`);

const decodeKnownString = <T extends string>(
  value: unknown,
  values: readonly T[],
  label: string,
): DecodeResult<T> =>
  typeof value === "string" && values.includes(value as T)
    ? success(value as T)
    : failure(`${label} must be a known value.`);

const decodePlayers = (value: unknown): DecodeResult<readonly Player[]> => {
  if (!Array.isArray(value) || value.length !== 6) return failure("state.players must contain exactly six players.");
  const players: Player[] = [];
  for (const [index, item] of value.entries()) {
    const object = decodeObject(item, ["id", "displayName", "teamId", "hand"], `player ${index}`);
    if (!object.ok) return object;
    const id = decodePlayerId(object.value.id, `player ${index} id`);
    const teamId = decodeTeamId(object.value.teamId, `player ${index} teamId`);
    if (!id.ok) return id;
    if (!teamId.ok) return teamId;
    if (typeof object.value.displayName !== "string" || object.value.displayName.trim().length === 0 || object.value.displayName.length > 80) {
      return failure(`player ${index} displayName must be a non-empty string up to 80 characters.`);
    }
    if (!Array.isArray(object.value.hand) || object.value.hand.length > 54) return failure(`player ${index} hand must be a card array.`);
    const hand: CardId[] = [];
    for (const [cardIndex, card] of object.value.hand.entries()) {
      const cardId = decodeCardId(card, `player ${index} hand ${cardIndex}`);
      if (!cardId.ok) return cardId;
      hand.push(cardId.value);
    }
    players.push({ id: id.value, displayName: object.value.displayName, teamId: teamId.value, hand });
  }
  if (new Set(players.map((player) => player.id)).size !== players.length) return failure("state.players must have unique ids.");
  return success(players);
};

const decodeTeams = (value: unknown): DecodeResult<readonly Team[]> => {
  if (!Array.isArray(value) || value.length !== TEAM_IDS.length) return failure("state.teams must contain both teams.");
  const teams: Team[] = [];
  for (const [index, item] of value.entries()) {
    const object = decodeObject(item, ["id", "playerIds"], `team ${index}`);
    if (!object.ok) return object;
    const id = decodeTeamId(object.value.id, `team ${index} id`);
    if (!id.ok) return id;
    if (!Array.isArray(object.value.playerIds) || object.value.playerIds.length !== 3) return failure(`team ${index} must contain three player ids.`);
    const playerIds: PlayerId[] = [];
    for (const [playerIndex, playerId] of object.value.playerIds.entries()) {
      const decodedPlayerId = decodePlayerId(playerId, `team ${index} player ${playerIndex}`);
      if (!decodedPlayerId.ok) return decodedPlayerId;
      playerIds.push(decodedPlayerId.value);
    }
    if (new Set(playerIds).size !== playerIds.length) return failure(`team ${index} player ids must be unique.`);
    teams.push({ id: id.value, playerIds });
  }
  if (new Set(teams.map((team) => team.id)).size !== teams.length) return failure("state.teams must have unique ids.");
  return success(teams);
};

const decodeScores = (value: unknown): DecodeResult<TeamScores> => {
  const object = decodeObject(value, ["TEAM_A", "TEAM_B"], "state.scores");
  if (!object.ok) return object;
  const teamA = decodeSafeInteger(object.value.TEAM_A, "state.scores.TEAM_A");
  const teamB = decodeSafeInteger(object.value.TEAM_B, "state.scores.TEAM_B");
  if (!teamA.ok) return teamA;
  if (!teamB.ok) return teamB;
  return success({ TEAM_A: teamA.value, TEAM_B: teamB.value });
};

const decodeNullablePlayerId = (value: unknown, label: string): DecodeResult<PlayerId | null> =>
  value === null ? success(null) : decodePlayerId(value, label);

const decodeNullableTeamId = (value: unknown, label: string): DecodeResult<TeamId | null> =>
  value === null ? success(null) : decodeTeamId(value, label);

const decodeActiveDeclaration = (value: unknown): DecodeResult<ActiveDeclaration | null> => {
  if (value === null) return success(null);
  const object = decodeObject(value, [
    "declarerId",
    "declarerTeamId",
    "mode",
    "selectedSetId",
    "startedAt",
    "deadline",
    "interruptedTurnOwner",
    "ownershipSnapshot",
  ], "state.activeDeclaration");
  if (!object.ok) return object;
  const declarerId = decodePlayerId(object.value.declarerId, "activeDeclaration declarerId");
  const declarerTeamId = decodeTeamId(object.value.declarerTeamId, "activeDeclaration declarerTeamId");
  const mode = decodeKnownString(object.value.mode, DECLARATION_MODES, "activeDeclaration mode") as DecodeResult<DeclarationMode>;
  const selectedSetId = decodeSetId(object.value.selectedSetId, "activeDeclaration selectedSetId");
  const startedAt = decodeTimestamp(object.value.startedAt, "activeDeclaration startedAt");
  const deadline = decodeTimestamp(object.value.deadline, "activeDeclaration deadline");
  const interruptedTurnOwner = decodePlayerId(object.value.interruptedTurnOwner, "activeDeclaration interruptedTurnOwner");
  if (!declarerId.ok) return declarerId;
  if (!declarerTeamId.ok) return declarerTeamId;
  if (!mode.ok) return mode;
  if (!selectedSetId.ok) return selectedSetId;
  if (!startedAt.ok) return startedAt;
  if (!deadline.ok) return deadline;
  if (!interruptedTurnOwner.ok) return interruptedTurnOwner;
  if (!Array.isArray(object.value.ownershipSnapshot) || object.value.ownershipSnapshot.length !== 6) {
    return failure("activeDeclaration ownershipSnapshot must contain six entries.");
  }
  const ownershipSnapshot: DeclarationCardOwnership[] = [];
  for (const [index, item] of object.value.ownershipSnapshot.entries()) {
    const snapshot = decodeObject(item, ["cardId", "ownerId"], `ownershipSnapshot ${index}`);
    if (!snapshot.ok) return snapshot;
    const cardId = decodeCardId(snapshot.value.cardId, `ownershipSnapshot ${index} cardId`);
    const ownerId = decodePlayerId(snapshot.value.ownerId, `ownershipSnapshot ${index} ownerId`);
    if (!cardId.ok) return cardId;
    if (!ownerId.ok) return ownerId;
    ownershipSnapshot.push({ cardId: cardId.value, ownerId: ownerId.value });
  }
  if (new Set(ownershipSnapshot.map((item) => item.cardId)).size !== ownershipSnapshot.length) {
    return failure("activeDeclaration ownershipSnapshot card ids must be unique.");
  }
  return success({
    declarerId: declarerId.value,
    declarerTeamId: declarerTeamId.value,
    mode: mode.value,
    selectedSetId: selectedSetId.value,
    startedAt: startedAt.value,
    deadline: deadline.value,
    interruptedTurnOwner: interruptedTurnOwner.value,
    ownershipSnapshot,
  });
};

const canonicalTeamsMatch = (decoded: readonly Team[], canonical: readonly Team[]): boolean =>
  JSON.stringify(decoded) === JSON.stringify(canonical);

/** Strictly decodes external storage data, then restores engine invariants. */
export const decodeNormalPlayGameState = (value: unknown): DecodeResult<NormalPlayGameState> => {
  const object = decodeObject(value, [
    "players",
    "teams",
    "currentTurnOwner",
    "resolvedSetIds",
    "phase",
    "normalAskingAllowed",
    "scores",
    "activeDeclaration",
    "blindDeclarationTeamId",
    "blindDeclarerId",
    "winnerTeamId",
  ], "state");
  if (!object.ok) return object;
  const players = decodePlayers(object.value.players);
  const teams = decodeTeams(object.value.teams);
  const currentTurnOwner = decodePlayerId(object.value.currentTurnOwner, "state.currentTurnOwner");
  const phase = decodeKnownString(object.value.phase, GAME_PHASES, "state.phase") as DecodeResult<GamePhase>;
  const scores = decodeScores(object.value.scores);
  const activeDeclaration = decodeActiveDeclaration(object.value.activeDeclaration);
  const blindDeclarationTeamId = decodeNullableTeamId(object.value.blindDeclarationTeamId, "state.blindDeclarationTeamId");
  const blindDeclarerId = decodeNullablePlayerId(object.value.blindDeclarerId, "state.blindDeclarerId");
  const winnerTeamId = decodeNullableTeamId(object.value.winnerTeamId, "state.winnerTeamId");
  if (!players.ok) return players;
  if (!teams.ok) return teams;
  if (!currentTurnOwner.ok) return currentTurnOwner;
  if (!phase.ok) return phase;
  if (!scores.ok) return scores;
  if (!activeDeclaration.ok) return activeDeclaration;
  if (!blindDeclarationTeamId.ok) return blindDeclarationTeamId;
  if (!blindDeclarerId.ok) return blindDeclarerId;
  if (!winnerTeamId.ok) return winnerTeamId;
  if (typeof object.value.normalAskingAllowed !== "boolean") return failure("state.normalAskingAllowed must be a boolean.");
  if (!Array.isArray(object.value.resolvedSetIds) || object.value.resolvedSetIds.length > SET_IDS.length) {
    return failure("state.resolvedSetIds must be a set-id array.");
  }
  const resolvedSetIds: SetId[] = [];
  for (const [index, setId] of object.value.resolvedSetIds.entries()) {
    const decodedSetId = decodeSetId(setId, `state.resolvedSetIds ${index}`);
    if (!decodedSetId.ok) return decodedSetId;
    resolvedSetIds.push(decodedSetId.value);
  }
  if (new Set(resolvedSetIds).size !== resolvedSetIds.length) return failure("state.resolvedSetIds must be unique.");

  try {
    const canonical = createNormalPlayState({
      players: players.value,
      currentTurnOwner: currentTurnOwner.value,
      resolvedSetIds,
      phase: phase.value,
      normalAskingAllowed: object.value.normalAskingAllowed,
      scores: scores.value,
      activeDeclaration: activeDeclaration.value,
      blindDeclarationTeamId: blindDeclarationTeamId.value,
      blindDeclarerId: blindDeclarerId.value,
      winnerTeamId: winnerTeamId.value,
    });
    return canonicalTeamsMatch(teams.value, canonical.teams)
      ? success(canonical)
      : failure("state.teams must match the canonical player composition.");
  } catch {
    return failure("state does not satisfy Declaration engine invariants.");
  }
};

const decodeReason = <T extends string>(value: unknown, reasons: readonly T[], label: string): DecodeResult<T> =>
  decodeKnownString(value, reasons, label);

const decodeAskOutcome = (object: Record<string, unknown>): DecodeResult<SafeActionOutcome> => {
  const kind = object.kind;
  if (kind === "INVALID") {
    const decoded = decodeObject(object, ["kind", "reason"], "ask INVALID outcome");
    if (!decoded.ok) return decoded;
    const reason = decodeReason(decoded.value.reason, INVALID_ASK_REASONS, "ask invalid reason");
    return reason.ok ? success({ kind, reason: reason.value }) : reason;
  }
  const keys = kind === "ILLEGAL"
    ? ["kind", "asker", "target", "requestedCard", "reason", "resultingTurnOwner"]
    : ["kind", "asker", "target", "requestedCard", "resultingTurnOwner"];
  const decoded = decodeObject(object, keys, "ask outcome");
  if (!decoded.ok || (kind !== "SUCCESS" && kind !== "UNSUCCESSFUL" && kind !== "ILLEGAL")) {
    return decoded.ok ? failure("Unknown ask outcome kind.") : decoded;
  }
  const asker = decodePlayerId(decoded.value.asker, "ask outcome asker");
  const target = decodePlayerId(decoded.value.target, "ask outcome target");
  const requestedCard = decodeCardId(decoded.value.requestedCard, "ask outcome requestedCard");
  const resultingTurnOwner = decodePlayerId(decoded.value.resultingTurnOwner, "ask outcome resultingTurnOwner");
  if (!asker.ok) return asker;
  if (!target.ok) return target;
  if (!requestedCard.ok) return requestedCard;
  if (!resultingTurnOwner.ok) return resultingTurnOwner;
  if (kind === "ILLEGAL") {
    const reason = decodeReason(decoded.value.reason, ASK_ILLEGAL_REASONS, "ask illegal reason");
    return reason.ok ? success({ kind, asker: asker.value, target: target.value, requestedCard: requestedCard.value, reason: reason.value, resultingTurnOwner: resultingTurnOwner.value }) : reason;
  }
  return success({ kind, asker: asker.value, target: target.value, requestedCard: requestedCard.value, resultingTurnOwner: resultingTurnOwner.value });
};

const decodeSafeActionOutcome = (value: unknown): DecodeResult<SafeActionOutcome> => {
  if (!isRecord(value) || typeof value.kind !== "string") return failure("receipt outcome must be a known safe outcome.");
  if (["SUCCESS", "UNSUCCESSFUL", "ILLEGAL", "INVALID"].includes(value.kind)) return decodeAskOutcome(value);
  if (value.kind === "STARTED") {
    const object = decodeObject(value, ["kind", "declarerId", "declarerTeamId", "selectedSetId", "deadline"], "declaration start outcome");
    if (!object.ok) return object;
    const declarerId = decodePlayerId(object.value.declarerId, "start outcome declarerId");
    const declarerTeamId = decodeTeamId(object.value.declarerTeamId, "start outcome declarerTeamId");
    const selectedSetId = decodeSetId(object.value.selectedSetId, "start outcome selectedSetId");
    const deadline = decodeTimestamp(object.value.deadline, "start outcome deadline");
    if (!declarerId.ok) return declarerId;
    if (!declarerTeamId.ok) return declarerTeamId;
    if (!selectedSetId.ok) return selectedSetId;
    return deadline.ok ? success({ kind: "STARTED", declarerId: declarerId.value, declarerTeamId: declarerTeamId.value, selectedSetId: selectedSetId.value, deadline: deadline.value }) : deadline;
  }
  if (value.kind === "INVALID_START") {
    const object = decodeObject(value, ["kind", "reason"], "invalid declaration start outcome");
    if (!object.ok) return object;
    const reason = decodeReason(object.value.reason, INVALID_DECLARATION_START_REASONS, "invalid start reason");
    return reason.ok ? success({ kind: "INVALID_START", reason: reason.value }) : reason;
  }
  if (["CORRECT", "INCORRECT", "TIMED_OUT"].includes(value.kind)) {
    const object = decodeObject(value, ["kind", "declarerId", "selectedSetId", "scoringTeamId", "resultingTurnOwner"], "declaration resolution outcome");
    if (!object.ok) return object;
    const declarerId = decodePlayerId(object.value.declarerId, "resolution outcome declarerId");
    const selectedSetId = decodeSetId(object.value.selectedSetId, "resolution outcome selectedSetId");
    const scoringTeamId = decodeTeamId(object.value.scoringTeamId, "resolution outcome scoringTeamId");
    const resultingTurnOwner = decodePlayerId(object.value.resultingTurnOwner, "resolution outcome resultingTurnOwner");
    if (!declarerId.ok) return declarerId;
    if (!selectedSetId.ok) return selectedSetId;
    if (!scoringTeamId.ok) return scoringTeamId;
    return resultingTurnOwner.ok
      ? success({ kind: value.kind as "CORRECT" | "INCORRECT" | "TIMED_OUT", declarerId: declarerId.value, selectedSetId: selectedSetId.value, scoringTeamId: scoringTeamId.value, resultingTurnOwner: resultingTurnOwner.value })
      : resultingTurnOwner;
  }
  if (value.kind === "INVALID_SUBMISSION") {
    const object = decodeObject(value, ["kind", "reason"], "invalid declaration submission outcome");
    if (!object.ok) return object;
    const reason = decodeReason(object.value.reason, INVALID_DECLARATION_SUBMISSION_REASONS, "invalid submission reason");
    return reason.ok ? success({ kind: "INVALID_SUBMISSION", reason: reason.value }) : reason;
  }
  if (value.kind === "BLIND_DECLARER_SELECTED") {
    const object = decodeObject(value, ["kind", "blindDeclarerId", "blindDeclarationTeamId"], "blind declarer outcome");
    if (!object.ok) return object;
    const blindDeclarerId = decodePlayerId(object.value.blindDeclarerId, "blind outcome blindDeclarerId");
    const blindDeclarationTeamId = decodeTeamId(object.value.blindDeclarationTeamId, "blind outcome blindDeclarationTeamId");
    if (!blindDeclarerId.ok) return blindDeclarerId;
    return blindDeclarationTeamId.ok
      ? success({ kind: "BLIND_DECLARER_SELECTED", blindDeclarerId: blindDeclarerId.value, blindDeclarationTeamId: blindDeclarationTeamId.value })
      : blindDeclarationTeamId;
  }
  if (value.kind === "INVALID_BLIND_DECLARER_SELECTION") {
    const object = decodeObject(value, ["kind", "reason"], "invalid blind declarer outcome");
    if (!object.ok) return object;
    const reason = decodeReason(object.value.reason, INVALID_BLIND_DECLARER_SELECTION_REASONS, "invalid blind declarer reason");
    return reason.ok ? success({ kind: "INVALID_BLIND_DECLARER_SELECTION", reason: reason.value }) : reason;
  }
  if (value.kind === "ACTION_NOT_AUTHORIZED") {
    const object = decodeObject(value, ["kind", "reason"], "authorization outcome");
    return object.ok && object.value.reason === "ACTOR_NOT_ON_BLIND_DECLARATION_TEAM"
      ? success({ kind: "ACTION_NOT_AUTHORIZED", reason: "ACTOR_NOT_ON_BLIND_DECLARATION_TEAM" })
      : failure("Unknown authorization outcome.");
  }
  return failure("receipt outcome must be a known safe outcome.");
};

const decodeProcessedActions = (value: unknown): DecodeResult<readonly ProcessedActionReceipt[]> => {
  if (!Array.isArray(value)) return failure("processedActions must be an array.");
  const receipts: ProcessedActionReceipt[] = [];
  for (const [index, item] of value.entries()) {
    const object = decodeObject(item, ["seatId", "actionId", "status", "outcome", "resultingRevision"], `processed action ${index}`);
    if (!object.ok) return object;
    if (!isOpaqueId(object.value.seatId) || !isOpaqueId(object.value.actionId)) {
      return failure(`processed action ${index} must use well-formed ids.`);
    }
    if (object.value.status !== "APPLIED" && object.value.status !== "REJECTED") return failure(`processed action ${index} has an invalid status.`);
    const outcome = decodeSafeActionOutcome(object.value.outcome);
    const resultingRevision = decodeSafeInteger(object.value.resultingRevision, `processed action ${index} resultingRevision`);
    if (!outcome.ok) return outcome;
    if (!resultingRevision.ok) return resultingRevision;
    receipts.push({
      seatId: object.value.seatId,
      actionId: object.value.actionId,
      status: object.value.status,
      outcome: outcome.value,
      resultingRevision: resultingRevision.value,
    });
  }
  if (new Set(receipts.map((receipt) => `${receipt.seatId}:${receipt.actionId}`)).size !== receipts.length) {
    return failure("processedActions must have unique seat/action pairs.");
  }
  return success(receipts);
};

/** Decodes a JSON storage value without permitting unrecognized fields or versions. */
export const decodeStoredGameRecord = (value: unknown): DecodeResult<StoredGameRecord> => {
  const object = decodeObject(value, ["gameId", "engineVersion", "revision", "state", "processedActions"], "stored game record");
  if (!object.ok) return object;
  if (!isOpaqueId(object.value.gameId)) return failure("stored gameId must be a well-formed identifier.");
  if (object.value.engineVersion !== ENGINE_VERSION) return failure("stored record uses an unknown engine version.");
  const revision = decodeSafeInteger(object.value.revision, "stored revision");
  const state = decodeNormalPlayGameState(object.value.state);
  const processedActions = decodeProcessedActions(object.value.processedActions);
  if (!revision.ok) return revision;
  if (!state.ok) return state;
  if (!processedActions.ok) return processedActions;
  if (processedActions.value.some((receipt) => receipt.resultingRevision > revision.value)) {
    return failure("processed action revisions cannot exceed the stored revision.");
  }
  return success({
    gameId: object.value.gameId,
    engineVersion: ENGINE_VERSION,
    revision: revision.value,
    state: state.value,
    processedActions: processedActions.value,
  });
};
