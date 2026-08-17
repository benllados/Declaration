import { CARDS_BY_ID, type CardId } from "@/game/cards";
import { SET_IDS, type SetId } from "@/game/sets";
import { createPlayerId, type PlayerId } from "@/game/types/player";
import {
  PUBLIC_ACTION_TYPES,
  type AskPayload,
  type PublicGameAction,
  type PublicActionType,
  type SelectBlindDeclarerPayload,
  type StartDeclarationPayload,
  type SubmitDeclarationPayload,
} from "./contracts";

export type DecodeResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; reason: string }>;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_ASSIGNMENTS = 6;

const failure = <T = never>(reason: string): DecodeResult<T> => ({ ok: false, reason });
const success = <T>(value: T): DecodeResult<T> => ({ ok: true, value });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isOpaqueId = (value: unknown): value is string =>
  typeof value === "string" && ID_PATTERN.test(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
};

const decodeExactObject = (
  value: unknown,
  keys: readonly string[],
  label: string,
): DecodeResult<Record<string, unknown>> => {
  if (!isRecord(value) || !hasExactKeys(value, keys)) return failure(`${label} must contain exactly its documented fields.`);
  return success(value);
};

const decodePlayerId = (value: unknown, label: string): DecodeResult<PlayerId> =>
  isOpaqueId(value) ? success(createPlayerId(value)) : failure(`${label} must be a well-formed identifier.`);

const decodeCardId = (value: unknown, label: string): DecodeResult<CardId> =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(CARDS_BY_ID, value)
    ? success(value as CardId)
    : failure(`${label} must be a canonical card id.`);

const decodeSetId = (value: unknown): DecodeResult<SetId> =>
  typeof value === "string" && (SET_IDS as readonly string[]).includes(value)
    ? success(value as SetId)
    : failure("selectedSetId must be a known set id.");

const decodeRevision = (value: unknown): DecodeResult<number> =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? success(value)
    : failure("expectedRevision must be a non-negative safe integer.");

const decodeActionType = (value: unknown): DecodeResult<PublicActionType> =>
  typeof value === "string" && (PUBLIC_ACTION_TYPES as readonly string[]).includes(value)
    ? success(value as PublicActionType)
    : failure("type must be a known public action type.");

const decodeAskPayload = (value: unknown): DecodeResult<AskPayload> => {
  const object = decodeExactObject(value, ["targetPlayerId", "requestedCardId"], "ASK payload");
  if (!object.ok) return object;
  const targetPlayerId = decodePlayerId(object.value.targetPlayerId, "targetPlayerId");
  const requestedCardId = decodeCardId(object.value.requestedCardId, "requestedCardId");
  if (!targetPlayerId.ok) return targetPlayerId;
  if (!requestedCardId.ok) return requestedCardId;
  return success({ targetPlayerId: targetPlayerId.value, requestedCardId: requestedCardId.value });
};

const decodeStartPayload = (value: unknown): DecodeResult<StartDeclarationPayload> => {
  const object = decodeExactObject(value, ["selectedSetId"], "START_DECLARATION payload");
  if (!object.ok) return object;
  const selectedSetId = decodeSetId(object.value.selectedSetId);
  return selectedSetId.ok ? success({ selectedSetId: selectedSetId.value }) : selectedSetId;
};

const decodeSubmitPayload = (value: unknown): DecodeResult<SubmitDeclarationPayload> => {
  const object = decodeExactObject(value, ["assignments"], "SUBMIT_DECLARATION payload");
  if (!object.ok) return object;
  if (!Array.isArray(object.value.assignments) || object.value.assignments.length > MAX_ASSIGNMENTS) {
    return failure("assignments must be an array with at most six entries.");
  }

  const assignments = [] as Array<{ cardId: CardId; playerId: PlayerId }>;
  for (const [index, assignment] of object.value.assignments.entries()) {
    const assignmentObject = decodeExactObject(assignment, ["cardId", "playerId"], `assignment ${index}`);
    if (!assignmentObject.ok) return assignmentObject;
    const cardId = decodeCardId(assignmentObject.value.cardId, `assignment ${index} cardId`);
    const playerId = decodePlayerId(assignmentObject.value.playerId, `assignment ${index} playerId`);
    if (!cardId.ok) return cardId;
    if (!playerId.ok) return playerId;
    assignments.push({ cardId: cardId.value, playerId: playerId.value });
  }
  return success({ assignments });
};

const decodeBlindPayload = (value: unknown): DecodeResult<SelectBlindDeclarerPayload> => {
  const object = decodeExactObject(value, ["blindDeclarerId"], "SELECT_BLIND_DECLARER payload");
  if (!object.ok) return object;
  const blindDeclarerId = decodePlayerId(object.value.blindDeclarerId, "blindDeclarerId");
  return blindDeclarerId.ok ? success({ blindDeclarerId: blindDeclarerId.value }) : blindDeclarerId;
};

/** Strictly decodes the browser-to-server envelope without evaluating game rules. */
export const decodePublicGameAction = (value: unknown): DecodeResult<PublicGameAction> => {
  const object = decodeExactObject(value, ["gameId", "actionId", "expectedRevision", "type", "payload"], "action envelope");
  if (!object.ok) return object;
  if (!isOpaqueId(object.value.gameId)) return failure("gameId must be a well-formed identifier.");
  if (!isOpaqueId(object.value.actionId)) return failure("actionId must be a well-formed identifier.");
  const expectedRevision = decodeRevision(object.value.expectedRevision);
  const type = decodeActionType(object.value.type);
  if (!expectedRevision.ok) return expectedRevision;
  if (!type.ok) return type;

  if (type.value === "ASK") {
    const payload = decodeAskPayload(object.value.payload);
    return payload.ok
      ? success({ gameId: object.value.gameId, actionId: object.value.actionId, expectedRevision: expectedRevision.value, type: type.value, payload: payload.value })
      : payload;
  }
  if (type.value === "START_DECLARATION") {
    const payload = decodeStartPayload(object.value.payload);
    return payload.ok
      ? success({ gameId: object.value.gameId, actionId: object.value.actionId, expectedRevision: expectedRevision.value, type: type.value, payload: payload.value })
      : payload;
  }
  if (type.value === "SUBMIT_DECLARATION") {
    const payload = decodeSubmitPayload(object.value.payload);
    return payload.ok
      ? success({ gameId: object.value.gameId, actionId: object.value.actionId, expectedRevision: expectedRevision.value, type: type.value, payload: payload.value })
      : payload;
  }

  const payload = decodeBlindPayload(object.value.payload);
  return payload.ok
    ? success({ gameId: object.value.gameId, actionId: object.value.actionId, expectedRevision: expectedRevision.value, type: type.value, payload: payload.value })
    : payload;
};
