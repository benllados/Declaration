import { resolveAsk } from "@/game/engine/asking";
import { selectBlindDeclarer } from "@/game/engine/blind-declaration";
import {
  resolveDeclarationTimeout,
  startDeclaration,
  submitDeclaration,
} from "@/game/engine/declaration";
import type { NormalPlayGameState } from "@/game/engine/normal-play";
import {
  decodePublicGameAction,
} from "@/lib/multiplayer/action-codec";
import type {
  PublicActionResponse,
  PublicGameAction,
  SafeActionOutcome,
  ScopedGameView,
} from "@/lib/multiplayer/contracts";
import { createPlayerGameView } from "@/lib/local-game/player-view";
import type { GameSessionRepository, GameSessionTransaction } from "./repository";
import type { SeatIdentity } from "./seat-identity";
import type { ServerClock } from "./server-clock";
import type { ProcessedActionReceipt, StoredGameRecord } from "./stored-record";

export type GameSessionDependencies = Readonly<{
  repository: GameSessionRepository;
  clock: ServerClock;
}>;

/** Deliberately generic: callers must not learn whether a game or seat exists. */
export class GameSessionAccessError extends Error {
  constructor() {
    super("Game session access denied.");
  }
}

const INVALID_ACTION_ID = "invalid-action";

const validationError = (actionId = INVALID_ACTION_ID, revision = 0): PublicActionResponse => ({
  status: "VALIDATION_ERROR",
  actionId,
  revision,
});

const getPlayerForSeat = (record: StoredGameRecord, identity: SeatIdentity) => {
  const player = record.state.players.find((candidate) => candidate.id === identity.playerId);
  if (!player) throw new GameSessionAccessError();
  return player;
};

const projectForSeat = (record: StoredGameRecord, identity: SeatIdentity) => {
  getPlayerForSeat(record, identity);
  return createPlayerGameView(record.state, identity.playerId);
};

const withRecordState = (
  record: StoredGameRecord,
  state: NormalPlayGameState,
  revision: number,
  processedActions = record.processedActions,
): StoredGameRecord => ({
  ...record,
  state,
  revision,
  processedActions,
});

/**
 * The frozen engine can return a new frozen object for an illegal action whose
 * observable state is unchanged. Revisions track meaningful state, not object
 * allocation.
 */
const hasAuthoritativeStateChanged = (
  previous: NormalPlayGameState,
  next: NormalPlayGameState,
): boolean => JSON.stringify(previous) !== JSON.stringify(next);

/** Resolves expiry solely by delegating to the frozen engine. */
const resolveExpiry = async (
  record: StoredGameRecord,
  transaction: GameSessionTransaction,
  clock: ServerClock,
): Promise<Readonly<{ record: StoredGameRecord; advanced: boolean }>> => {
  if (record.state.activeDeclaration === null) return { record, advanced: false };
  const resolution = resolveDeclarationTimeout(record.state, { resolvedAt: clock.now() });
  if (!hasAuthoritativeStateChanged(record.state, resolution.state)) return { record, advanced: false };
  const nextRecord = withRecordState(record, resolution.state, record.revision + 1);
  await transaction.save(nextRecord);
  return { record: nextRecord, advanced: true };
};

const toSafeStartOutcome = (result: ReturnType<typeof startDeclaration>["result"]): SafeActionOutcome =>
  result.kind === "STARTED"
    ? {
      kind: result.kind,
      declarerId: result.declarerId,
      declarerTeamId: result.declarerTeamId,
      selectedSetId: result.selectedSetId,
      deadline: result.deadline,
    }
    : result;

type EngineOperation = Readonly<{
  state: NormalPlayGameState;
  outcome: SafeActionOutcome;
}>;

const invokeEngine = (
  record: StoredGameRecord,
  identity: SeatIdentity,
  action: PublicGameAction,
  clock: ServerClock,
): EngineOperation => {
  if (action.type === "ASK") {
    const resolution = resolveAsk(record.state, {
      asker: identity.playerId,
      target: action.payload.targetPlayerId,
      requestedCard: action.payload.requestedCardId,
    });
    return { state: resolution.state, outcome: resolution.result };
  }
  if (action.type === "START_DECLARATION") {
    const resolution = startDeclaration(record.state, {
      declarerId: identity.playerId,
      selectedSetId: action.payload.selectedSetId,
      startedAt: clock.now(),
    });
    return { state: resolution.state, outcome: toSafeStartOutcome(resolution.result) };
  }
  if (action.type === "SUBMIT_DECLARATION") {
    const resolution = submitDeclaration(record.state, {
      declarerId: identity.playerId,
      assignments: action.payload.assignments,
      submittedAt: clock.now(),
    });
    return { state: resolution.state, outcome: resolution.result };
  }

  const actor = getPlayerForSeat(record, identity);
  if (actor.teamId !== record.state.blindDeclarationTeamId) {
    return {
      state: record.state,
      outcome: { kind: "ACTION_NOT_AUTHORIZED", reason: "ACTOR_NOT_ON_BLIND_DECLARATION_TEAM" },
    };
  }
  const resolution = selectBlindDeclarer(record.state, { blindDeclarerId: action.payload.blindDeclarerId });
  return { state: resolution.state, outcome: resolution.result };
};

const appendReceipt = (
  record: StoredGameRecord,
  identity: SeatIdentity,
  action: PublicGameAction,
  operation: EngineOperation,
): Readonly<{ record: StoredGameRecord; receipt: ProcessedActionReceipt }> => {
  const changed = hasAuthoritativeStateChanged(record.state, operation.state);
  const revision = changed ? record.revision + 1 : record.revision;
  const receipt: ProcessedActionReceipt = {
    seatId: identity.seatId,
    actionId: action.actionId,
    status: changed ? "APPLIED" : "REJECTED",
    outcome: operation.outcome,
    resultingRevision: revision,
  };
  return {
    record: withRecordState(record, operation.state, revision, [...record.processedActions, receipt]),
    receipt,
  };
};

/**
 * Receives trusted seat context plus untrusted JSON, runs a single atomic game
 * transition, and emits only a player-scoped response.
 */
export const processAuthoritativeAction = async (
  identity: SeatIdentity,
  publicInput: unknown,
  dependencies: GameSessionDependencies,
): Promise<PublicActionResponse> => {
  const decoded = decodePublicGameAction(publicInput);
  if (!decoded.ok) return validationError();
  const action = decoded.value;
  if (action.gameId !== identity.gameId) return validationError(action.actionId, action.expectedRevision);

  return dependencies.repository.transact(action.gameId, async (transaction) => {
    const loaded = await transaction.load();
    if (loaded === null) throw new GameSessionAccessError();
    getPlayerForSeat(loaded, identity);

    const priorReceipt = loaded.processedActions.find(
      (receipt) => receipt.seatId === identity.seatId && receipt.actionId === action.actionId,
    );
    if (priorReceipt) {
      return {
        status: "DUPLICATE",
        actionId: action.actionId,
        revision: loaded.revision,
        view: projectForSeat(loaded, identity),
        outcome: priorReceipt.outcome,
      };
    }

    // A late submission is intentionally delegated to submitDeclaration so the
    // frozen engine supplies its TIMED_OUT outcome instead of a generic conflict.
    if (action.type !== "SUBMIT_DECLARATION") {
      const expiry = await resolveExpiry(loaded, transaction, dependencies.clock);
      if (expiry.advanced) {
        return {
          status: "CONFLICT",
          actionId: action.actionId,
          revision: expiry.record.revision,
          view: projectForSeat(expiry.record, identity),
        };
      }
    }

    if (action.expectedRevision !== loaded.revision) {
      return {
        status: "CONFLICT",
        actionId: action.actionId,
        revision: loaded.revision,
        view: projectForSeat(loaded, identity),
      };
    }

    const operation = invokeEngine(loaded, identity, action, dependencies.clock);
    const saved = appendReceipt(loaded, identity, action, operation);
    await transaction.save(saved.record);
    return {
      status: saved.receipt.status,
      actionId: action.actionId,
      revision: saved.record.revision,
      view: projectForSeat(saved.record, identity),
      outcome: saved.receipt.outcome,
    };
  });
};

/**
 * Reads only the authenticated seat's projection. Expiry is resolved in the
 * same transaction before the view is returned.
 */
export const readScopedGameView = async (
  identity: SeatIdentity,
  dependencies: GameSessionDependencies,
): Promise<ScopedGameView> =>
  dependencies.repository.transact(identity.gameId, async (transaction) => {
    const loaded = await transaction.load();
    if (loaded === null) throw new GameSessionAccessError();
    getPlayerForSeat(loaded, identity);
    const expiry = await resolveExpiry(loaded, transaction, dependencies.clock);
    return {
      revision: expiry.record.revision,
      view: projectForSeat(expiry.record, identity),
    };
  });
