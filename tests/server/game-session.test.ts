import { describe, expect, it } from "vitest";

import { resolveAsk } from "../../src/game/engine/asking";
import { selectBlindDeclarer } from "../../src/game/engine/blind-declaration";
import { submitDeclaration } from "../../src/game/engine/declaration";
import { decodePublicGameAction } from "../../src/lib/multiplayer/action-codec";
import {
  processAuthoritativeAction,
  readScopedGameView,
} from "../../src/server/game-session/service";
import { decodeStoredGameRecord } from "../../src/server/game-session/stored-record";
import {
  GAME_ID,
  TestServerClock,
  correctAssignments,
  createActiveDeclarationState,
  createBlindState,
  createDeclarationReadyState,
  createGameOverState,
  createRecord,
  findLegalAsk,
  seatFor,
} from "../support/game-session-fixtures";
import { TestGameSessionRepository } from "../support/game-session-repository";
import { LOCAL_PLAYERS, createDeterministicLocalGame } from "../../src/lib/local-game";

const service = (repository: TestGameSessionRepository, clock: TestServerClock) => ({ repository, clock });

const askAction = (actionId: string, expectedRevision: number, state = createDeterministicLocalGame()) => ({
  gameId: GAME_ID,
  actionId,
  expectedRevision,
  type: "ASK" as const,
  payload: findLegalAsk(state),
});

const declarationStartAction = (actionId: string, expectedRevision: number) => ({
  gameId: GAME_ID,
  actionId,
  expectedRevision,
  type: "START_DECLARATION" as const,
  payload: { selectedSetId: "LOW_HEARTS" as const },
});

const declarationSubmitAction = (
  actionId: string,
  expectedRevision: number,
  assignments: readonly { cardId: string; playerId: string }[],
) => ({
  gameId: GAME_ID,
  actionId,
  expectedRevision,
  type: "SUBMIT_DECLARATION" as const,
  payload: { assignments },
});

const blindSelectionAction = (actionId: string, expectedRevision: number, blindDeclarerId = LOCAL_PLAYERS.maya) => ({
  gameId: GAME_ID,
  actionId,
  expectedRevision,
  type: "SELECT_BLIND_DECLARER" as const,
  payload: { blindDeclarerId },
});

const forbiddenPublicKeys = [
  "ownershipSnapshot",
  "processedActions",
  "\"state\"",
  "\"players\"",
  "\"teams\"",
  "interruptedTurnOwner",
  "\"seatId\"",
  "\"hand\"",
];

const expectSafeSerializedResult = (result: unknown): void => {
  const serialized = JSON.stringify(result);
  for (const key of forbiddenPublicKeys) expect(serialized).not.toContain(key);
};

describe("Build 12 strict public action boundary", () => {
  it("decodes only exact structural public action shapes", () => {
    const valid = askAction("action-ask-1", 0);
    expect(decodePublicGameAction(valid)).toMatchObject({ ok: true });

    for (const invalid of [
      { ...valid, actingPlayerId: LOCAL_PLAYERS.avery },
      { ...valid, startedAt: 100 },
      { ...valid, expectedRevision: -1 },
      { ...valid, expectedRevision: 1.5 },
      { ...valid, actionId: "has spaces" },
      { ...valid, type: "TIMEOUT" },
      { ...valid, payload: { ...valid.payload, submittedAt: 100 } },
      { ...valid, payload: { targetPlayerId: valid.payload.targetPlayerId } },
    ]) {
      expect(decodePublicGameAction(invalid).ok).toBe(false);
    }
  });

  it("rejects a mismatched authenticated game identity without loading state", async () => {
    const repository = new TestGameSessionRepository([createRecord()]);
    const clock = new TestServerClock(100);
    const response = await processAuthoritativeAction(
      seatFor(LOCAL_PLAYERS.avery),
      { ...declarationStartAction("action-mismatch", 0), gameId: "another-game" },
      service(repository, clock),
    );

    expect(response).toEqual({ status: "VALIDATION_ERROR", actionId: "action-mismatch", revision: 0 });
    expect(repository.savedRecordReferences).toHaveLength(0);
  });

  it("injects startedAt from the server clock and returns no authoritative state", async () => {
    const repository = new TestGameSessionRepository([createRecord()]);
    const clock = new TestServerClock(1_234.5);
    const response = await processAuthoritativeAction(
      seatFor(LOCAL_PLAYERS.avery),
      declarationStartAction("action-start", 0),
      service(repository, clock),
    );

    expect(response.status).toBe("APPLIED");
    expect(response.revision).toBe(1);
    expect(response.outcome).toEqual(expect.objectContaining({ kind: "STARTED", deadline: 1_324.5 }));
    expect(response.view?.activeDeclaration).toEqual(expect.objectContaining({ startedAt: 1_234.5, deadline: 1_324.5 }));
    expect(repository.snapshot(GAME_ID).state.activeDeclaration?.startedAt).toBe(1_234.5);
    const serialized = JSON.stringify(response);
    for (const key of forbiddenPublicKeys) expect(serialized).not.toContain(key);
  });
});

describe("Build 12 player-scoped reads and privacy", () => {
  it("returns six distinct views that contain only the authenticated player's hand", async () => {
    const state = createDeterministicLocalGame();
    const repository = new TestGameSessionRepository([createRecord(state)]);
    const clock = new TestServerClock(10);
    const seats = Object.values(LOCAL_PLAYERS).map(seatFor);
    const views = await Promise.all(seats.map((seat) => readScopedGameView(seat, service(repository, clock))));

    expect(new Set(views.map((result) => result.view.localPlayer.id))).toHaveLength(6);
    for (const [index, result] of views.entries()) {
      const localPlayer = state.players.find((player) => player.id === seats[index].playerId)!;
      expect(result.view.localPlayer.id).toBe(seats[index].playerId);
      expect(result.view.visibleHand).toEqual(localPlayer.hand);
      expect(result.view.visiblePlayers.every((player) => !("hand" in player))).toBe(true);
      const serialized = JSON.stringify(result);
      for (const otherPlayer of state.players.filter((player) => player.id !== localPlayer.id)) {
        for (const cardId of otherPlayer.hand) expect(serialized).not.toContain(JSON.stringify(cardId));
      }
      for (const key of forbiddenPublicKeys) expect(serialized).not.toContain(key);
    }
  });

  it("binds projection to SeatIdentity and rejects a Blind selection from outside the eligible team", async () => {
    const repository = new TestGameSessionRepository([createRecord(createBlindState())]);
    const clock = new TestServerClock(100);
    const response = await processAuthoritativeAction(
      seatFor(LOCAL_PLAYERS.avery),
      blindSelectionAction("action-outside-team", 0),
      service(repository, clock),
    );

    expect(response).toEqual(expect.objectContaining({
      status: "REJECTED",
      revision: 0,
      outcome: { kind: "ACTION_NOT_AUTHORIZED", reason: "ACTOR_NOT_ON_BLIND_DECLARATION_TEAM" },
      view: expect.objectContaining({ localPlayer: expect.objectContaining({ id: LOCAL_PLAYERS.avery }) }),
    }));
    expect(repository.snapshot(GAME_ID).state.blindDeclarerId).toBeNull();
  });
});

describe("Build 12 authority, expiry, revision, and idempotency", () => {
  it("keeps exact-deadline submissions timely and injects submittedAt", async () => {
    const state = createActiveDeclarationState(100);
    const repository = new TestGameSessionRepository([createRecord(state)]);
    const clock = new TestServerClock(190);
    const response = await processAuthoritativeAction(
      seatFor(LOCAL_PLAYERS.avery),
      declarationSubmitAction("action-submit-deadline", 0, correctAssignments(state)),
      service(repository, clock),
    );

    expect(response).toEqual(expect.objectContaining({ status: "APPLIED", revision: 1, outcome: expect.objectContaining({ kind: "CORRECT" }) }));
    expect(repository.snapshot(GAME_ID).state.activeDeclaration).toBeNull();
  });

  it("uses the engine's late-submission timeout result instead of a client timeout action", async () => {
    const state = createActiveDeclarationState(100);
    const repository = new TestGameSessionRepository([createRecord(state)]);
    const clock = new TestServerClock(190.001);
    const response = await processAuthoritativeAction(
      seatFor(LOCAL_PLAYERS.avery),
      declarationSubmitAction("action-submit-late", 0, correctAssignments(state)),
      service(repository, clock),
    );

    expect(response).toEqual(expect.objectContaining({ status: "APPLIED", revision: 1, outcome: expect.objectContaining({ kind: "TIMED_OUT" }) }));
    expect(repository.snapshot(GAME_ID).state.resolvedSetIds).toContain("LOW_HEARTS");
  });

  it("resolves an expired Declaration once for concurrent scoped reads and uses resolvedAt from the clock", async () => {
    const repository = new TestGameSessionRepository([createRecord(createActiveDeclarationState(100))]);
    const clock = new TestServerClock(190.001);
    const [avery, maya] = await Promise.all([
      readScopedGameView(seatFor(LOCAL_PLAYERS.avery), service(repository, clock)),
      readScopedGameView(seatFor(LOCAL_PLAYERS.maya), service(repository, clock)),
    ]);

    expect(avery.revision).toBe(1);
    expect(maya.revision).toBe(1);
    expect(avery.view.activeDeclaration).toBeNull();
    expect(repository.snapshot(GAME_ID).state.scores).toEqual({ TEAM_A: 0, TEAM_B: 1 });
    expect(repository.savedRecordReferences).toHaveLength(1);
  });

  it("resolves expiry before an unrelated action and returns a scoped conflict", async () => {
    const state = createActiveDeclarationState(100);
    const repository = new TestGameSessionRepository([createRecord(state)]);
    const clock = new TestServerClock(190.001);
    const response = await processAuthoritativeAction(
      seatFor(LOCAL_PLAYERS.avery),
      askAction("action-after-expiry", 0, state),
      service(repository, clock),
    );

    expect(response).toEqual(expect.objectContaining({ status: "CONFLICT", revision: 1 }));
    expect(response.view?.activeDeclaration).toBeNull();
    expect(repository.snapshot(GAME_ID).processedActions).toHaveLength(0);
  });

  it("does not advance revision for a non-mutating engine rejection", async () => {
    const state = createActiveDeclarationState(100);
    const repository = new TestGameSessionRepository([createRecord(state)]);
    const clock = new TestServerClock(150);
    const response = await processAuthoritativeAction(
      seatFor(LOCAL_PLAYERS.maya),
      askAction("action-rejected", 0, state),
      service(repository, clock),
    );

    expect(response).toEqual(expect.objectContaining({ status: "REJECTED", revision: 0, outcome: expect.objectContaining({ kind: "ILLEGAL" }) }));
    expect(repository.snapshot(GAME_ID).processedActions).toHaveLength(1);
  });

  it("returns a safe duplicate response and scopes action ids by seat", async () => {
    const initial = createDeterministicLocalGame();
    const repository = new TestGameSessionRepository([createRecord(initial)]);
    const clock = new TestServerClock(10);
    const first = await processAuthoritativeAction(
      seatFor(LOCAL_PLAYERS.avery),
      askAction("same-action", 0, initial),
      service(repository, clock),
    );
    const duplicate = await processAuthoritativeAction(
      seatFor(LOCAL_PLAYERS.avery),
      askAction("same-action", 0, initial),
      service(repository, clock),
    );

    expect(first.status).toBe("APPLIED");
    expect(duplicate).toEqual(expect.objectContaining({ status: "DUPLICATE", revision: 1, outcome: first.outcome }));
    expect(repository.snapshot(GAME_ID).processedActions).toHaveLength(1);

    const declaringRepository = new TestGameSessionRepository([createRecord(createActiveDeclarationState(100))]);
    const avery = await processAuthoritativeAction(
      seatFor(LOCAL_PLAYERS.avery),
      askAction("shared-action", 0, createActiveDeclarationState(100)),
      service(declaringRepository, new TestServerClock(150)),
    );
    const maya = await processAuthoritativeAction(
      seatFor(LOCAL_PLAYERS.maya),
      askAction("shared-action", 0, createActiveDeclarationState(100)),
      service(declaringRepository, new TestServerClock(150)),
    );
    expect(avery.status).toBe("REJECTED");
    expect(maya.status).toBe("REJECTED");
    expect(declaringRepository.snapshot(GAME_ID).processedActions).toHaveLength(2);
  });

  it("keeps duplicate delivery read-only after a Declaration deadline, then resolves expiry on a distinct scoped read", async () => {
    const repository = new TestGameSessionRepository([createRecord()]);
    const clock = new TestServerClock(100);
    const action = declarationStartAction("action-duplicate-after-deadline", 0);
    const first = await processAuthoritativeAction(
      seatFor(LOCAL_PLAYERS.avery),
      action,
      service(repository, clock),
    );
    const beforeDuplicate = repository.snapshot(GAME_ID);
    const saveCountBeforeDuplicate = repository.savedRecordReferences.length;
    expect(beforeDuplicate.state.activeDeclaration).not.toBeNull();

    clock.set(190.001);
    const duplicate = await processAuthoritativeAction(
      seatFor(LOCAL_PLAYERS.avery),
      action,
      service(repository, clock),
    );
    const afterDuplicate = repository.snapshot(GAME_ID);

    expect(duplicate).toEqual(expect.objectContaining({
      status: "DUPLICATE",
      actionId: action.actionId,
      revision: beforeDuplicate.revision,
      outcome: first.outcome,
    }));
    expect(duplicate.view?.activeDeclaration).toEqual(first.view?.activeDeclaration);
    expect(afterDuplicate).toEqual(beforeDuplicate);
    expect(repository.savedRecordReferences).toHaveLength(saveCountBeforeDuplicate);

    const read = await readScopedGameView(seatFor(LOCAL_PLAYERS.avery), service(repository, clock));
    expect(read.revision).toBe(beforeDuplicate.revision + 1);
    expect(read.view.activeDeclaration).toBeNull();
    expect(repository.snapshot(GAME_ID).state.resolvedSetIds).toContain("LOW_HEARTS");
    expect(repository.savedRecordReferences).toHaveLength(saveCountBeforeDuplicate + 1);
  });

  it("serializes concurrent duplicate delivery into one transition and one duplicate", async () => {
    const initial = createDeterministicLocalGame();
    const repository = new TestGameSessionRepository([createRecord(initial)]);
    const clock = new TestServerClock(10);
    const action = askAction("action-concurrent-duplicate", 0, initial);
    const [first, second] = await Promise.all([
      processAuthoritativeAction(seatFor(LOCAL_PLAYERS.avery), action, service(repository, clock)),
      processAuthoritativeAction(seatFor(LOCAL_PLAYERS.avery), action, service(repository, clock)),
    ]);

    expect([first.status, second.status].sort()).toEqual(["APPLIED", "DUPLICATE"]);
    expect(repository.snapshot(GAME_ID).revision).toBe(1);
    expect(repository.snapshot(GAME_ID).processedActions).toHaveLength(1);
    expect(repository.savedRecordReferences).toHaveLength(1);
  });

  it("returns the original outcome with the current state projection for a duplicate action", async () => {
    const initial = createDeterministicLocalGame();
    const repository = new TestGameSessionRepository([createRecord(initial)]);
    const clock = new TestServerClock(10);
    const originalAction = askAction("action-current-duplicate", 0, initial);
    const original = await processAuthoritativeAction(
      seatFor(LOCAL_PLAYERS.avery),
      originalAction,
      service(repository, clock),
    );
    const later = await processAuthoritativeAction(
      seatFor(LOCAL_PLAYERS.avery),
      declarationStartAction("action-current-state", 1),
      service(repository, clock),
    );
    const beforeDuplicate = repository.snapshot(GAME_ID);
    const savesBeforeDuplicate = repository.savedRecordReferences.length;

    expect(later.status).toBe("APPLIED");
    const duplicate = await processAuthoritativeAction(
      seatFor(LOCAL_PLAYERS.avery),
      originalAction,
      service(repository, clock),
    );

    expect(duplicate).toEqual(expect.objectContaining({
      status: "DUPLICATE",
      revision: beforeDuplicate.revision,
      outcome: original.outcome,
      view: expect.objectContaining({ activeDeclaration: expect.any(Object) }),
    }));
    expect(repository.snapshot(GAME_ID)).toEqual(beforeDuplicate);
    expect(repository.savedRecordReferences).toHaveLength(savesBeforeDuplicate);
  });

  it("recovers a per-game repository lock after a rejected callback without committing pending state", async () => {
    const repository = new TestGameSessionRepository([createRecord()]);
    await expect(repository.transact(GAME_ID, async (transaction) => {
      const loaded = await transaction.load();
      await transaction.save({ ...loaded!, revision: 1 });
      throw new Error("deliberate rollback");
    })).rejects.toThrow("deliberate rollback");

    expect(repository.snapshot(GAME_ID).revision).toBe(0);
    await expect(repository.transact(GAME_ID, async (transaction) => (await transaction.load())!.revision))
      .resolves.toBe(0);
  });

  it("authorizes and persists a successful Blind Declarer selection through the frozen engine", async () => {
    const state = createBlindState();
    const expected = selectBlindDeclarer(state, { blindDeclarerId: LOCAL_PLAYERS.eli });
    const repository = new TestGameSessionRepository([createRecord(state)]);
    const response = await processAuthoritativeAction(
      seatFor(LOCAL_PLAYERS.maya),
      blindSelectionAction("action-blind-success", 0, LOCAL_PLAYERS.eli),
      service(repository, new TestServerClock(100)),
    );

    expect(response).toEqual(expect.objectContaining({
      status: "APPLIED",
      revision: 1,
      outcome: expected.result,
      view: expect.objectContaining({ localPlayer: expect.objectContaining({ id: LOCAL_PLAYERS.maya }) }),
    }));
    expect(repository.savedStateReferences).toEqual([expected.state]);
    expect(repository.snapshot(GAME_ID).state).toEqual(expected.state);
    expectSafeSerializedResult(response);
  });

  it("delegates duplicate Declaration assignments to the frozen engine without mutating state or revision", async () => {
    const state = createActiveDeclarationState(100);
    const assignments = correctAssignments(state);
    const duplicateAssignments = [assignments[0], assignments[0], ...assignments.slice(2)];
    const repository = new TestGameSessionRepository([createRecord(state)]);
    const response = await processAuthoritativeAction(
      seatFor(LOCAL_PLAYERS.avery),
      declarationSubmitAction("action-duplicate-assignment", 0, duplicateAssignments),
      service(repository, new TestServerClock(150)),
    );

    expect(response).toEqual(expect.objectContaining({
      status: "REJECTED",
      revision: 0,
      outcome: { kind: "INVALID_SUBMISSION", reason: "DUPLICATE_ASSIGNED_CARD" },
    }));
    expect(repository.snapshot(GAME_ID).state).toEqual(state);
    expect(repository.snapshot(GAME_ID).processedActions).toHaveLength(1);
  });

  it("serializes concurrent same-revision actions so only one commits and stale state cannot overwrite it", async () => {
    const initial = createDeterministicLocalGame();
    const repository = new TestGameSessionRepository([createRecord(initial)]);
    const clock = new TestServerClock(10);
    const [first, second] = await Promise.all([
      processAuthoritativeAction(seatFor(LOCAL_PLAYERS.avery), askAction("action-concurrent-a", 0, initial), service(repository, clock)),
      processAuthoritativeAction(seatFor(LOCAL_PLAYERS.avery), askAction("action-concurrent-b", 0, initial), service(repository, clock)),
    ]);

    expect([first.status, second.status].sort()).toEqual(["APPLIED", "CONFLICT"]);
    expect(repository.snapshot(GAME_ID).revision).toBe(1);
    expect(repository.snapshot(GAME_ID).processedActions).toHaveLength(1);
  });

  it("persists exactly the frozen engine's returned state rather than manually applying game changes", async () => {
    const initial = createDeterministicLocalGame();
    const expected = resolveAsk(initial, {
      asker: LOCAL_PLAYERS.avery,
      target: findLegalAsk(initial).targetPlayerId,
      requestedCard: findLegalAsk(initial).requestedCardId,
    });
    const repository = new TestGameSessionRepository([createRecord(initial)]);
    const response = await processAuthoritativeAction(
      seatFor(LOCAL_PLAYERS.avery),
      askAction("action-engine-state", 0, initial),
      service(repository, new TestServerClock(10)),
    );

    expect(response.status).toBe("APPLIED");
    expect(repository.savedStateReferences[0]).toEqual(expected.state);
    expect(repository.snapshot(GAME_ID).state).toEqual(expected.state);
  });
});

describe("Build 12 serialized response privacy", () => {
  it("keeps every public response status free of authoritative records and hidden ownership", async () => {
    const initial = createDeterministicLocalGame();
    const repository = new TestGameSessionRepository([createRecord(initial)]);
    const clock = new TestServerClock(100);
    const start = declarationStartAction("action-privacy-start", 0);
    const applied = await processAuthoritativeAction(seatFor(LOCAL_PLAYERS.avery), start, service(repository, clock));
    const duplicate = await processAuthoritativeAction(seatFor(LOCAL_PLAYERS.avery), start, service(repository, clock));
    const conflict = await processAuthoritativeAction(
      seatFor(LOCAL_PLAYERS.avery),
      askAction("action-privacy-conflict", 0, initial),
      service(repository, clock),
    );
    const validation = await processAuthoritativeAction(
      seatFor(LOCAL_PLAYERS.avery),
      { ...start, actingPlayerId: LOCAL_PLAYERS.avery },
      service(repository, clock),
    );
    const rejectedRepository = new TestGameSessionRepository([createRecord(createActiveDeclarationState(100))]);
    const rejected = await processAuthoritativeAction(
      seatFor(LOCAL_PLAYERS.maya),
      askAction("action-privacy-rejected", 0, createActiveDeclarationState(100)),
      service(rejectedRepository, new TestServerClock(150)),
    );
    const scopedRead = await readScopedGameView(seatFor(LOCAL_PLAYERS.avery), service(repository, clock));

    expect([applied.status, rejected.status, conflict.status, duplicate.status, validation.status])
      .toEqual(["APPLIED", "REJECTED", "CONFLICT", "DUPLICATE", "VALIDATION_ERROR"]);
    for (const result of [applied, rejected, conflict, duplicate, validation, scopedRead]) {
      expectSafeSerializedResult(result);
    }
  });
});

describe("Build 12 persisted record codec", () => {
  it("round-trips every lifecycle phase and preserves representative engine behavior", () => {
    const playing = createDeterministicLocalGame();
    const declaring = createActiveDeclarationState(100);
    const blind = createBlindState();
    const gameOver = createGameOverState();
    const cases = [playing, declaring, blind, gameOver];

    for (const state of cases) {
      const decoded = decodeStoredGameRecord(JSON.parse(JSON.stringify(createRecord(state))));
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) continue;
      expect(decoded.value.state).toEqual(state);
    }

    const roundTrippedPlaying = decodeStoredGameRecord(JSON.parse(JSON.stringify(createRecord(playing))));
    const roundTrippedDeclaring = decodeStoredGameRecord(JSON.parse(JSON.stringify(createRecord(declaring))));
    const roundTrippedBlind = decodeStoredGameRecord(JSON.parse(JSON.stringify(createRecord(blind))));
    const roundTrippedGameOver = decodeStoredGameRecord(JSON.parse(JSON.stringify(createRecord(gameOver))));
    if (!roundTrippedPlaying.ok || !roundTrippedDeclaring.ok || !roundTrippedBlind.ok || !roundTrippedGameOver.ok) throw new Error("Fixtures must decode.");

    const legalAsk = findLegalAsk(playing);
    expect(resolveAsk(roundTrippedPlaying.value.state, { asker: LOCAL_PLAYERS.avery, target: legalAsk.targetPlayerId, requestedCard: legalAsk.requestedCardId }))
      .toEqual(resolveAsk(playing, { asker: LOCAL_PLAYERS.avery, target: legalAsk.targetPlayerId, requestedCard: legalAsk.requestedCardId }));
    expect(submitDeclaration(roundTrippedDeclaring.value.state, { declarerId: LOCAL_PLAYERS.avery, assignments: correctAssignments(declaring), submittedAt: 150 }))
      .toEqual(submitDeclaration(declaring, { declarerId: LOCAL_PLAYERS.avery, assignments: correctAssignments(declaring), submittedAt: 150 }));
    expect(selectBlindDeclarer(roundTrippedBlind.value.state, { blindDeclarerId: LOCAL_PLAYERS.maya }))
      .toEqual(selectBlindDeclarer(blind, { blindDeclarerId: LOCAL_PLAYERS.maya }));
    expect(resolveAsk(roundTrippedGameOver.value.state, { asker: LOCAL_PLAYERS.avery, target: LOCAL_PLAYERS.maya, requestedCard: "2H" }))
      .toEqual(resolveAsk(gameOver, { asker: LOCAL_PLAYERS.avery, target: LOCAL_PLAYERS.maya, requestedCard: "2H" }));
  });

  it("rejects malformed persisted data, unknown versions, private receipt fields, and invalid primitive values", () => {
    const baseline = JSON.parse(JSON.stringify(createRecord()));
    expect(decodeStoredGameRecord({ ...baseline, engineVersion: "declaration-v2" }).ok).toBe(false);
    expect(decodeStoredGameRecord({ ...baseline, revision: -1 }).ok).toBe(false);
    expect(decodeStoredGameRecord({ ...baseline, extra: true }).ok).toBe(false);
    expect(decodeStoredGameRecord({
      ...baseline,
      processedActions: [{
        seatId: "seat-avery",
        actionId: "action-receipt",
        status: "APPLIED",
        outcome: { kind: "STARTED", declarerId: LOCAL_PLAYERS.avery, declarerTeamId: "TEAM_A", selectedSetId: "LOW_HEARTS", deadline: 190, ownershipSnapshot: [] },
        resultingRevision: 0,
      }],
    }).ok).toBe(false);
  });
});
