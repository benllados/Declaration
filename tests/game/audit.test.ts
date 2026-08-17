import { describe, expect, it } from "vitest";

import { CANONICAL_DECK, type CardId } from "../../src/game/cards";
import { GameDomainError } from "../../src/game/errors";
import { selectBlindDeclarer } from "../../src/game/engine/blind-declaration";
import {
  resolveDeclarationTimeout,
  startDeclaration,
  submitDeclaration,
  type DeclarationSubmission,
} from "../../src/game/engine/declaration";
import { resolveAsk, type AskAction } from "../../src/game/engine/asking";
import { createNormalPlayState, type GamePhase, type NormalPlayGameState } from "../../src/game/engine/normal-play";
import { getCardsInSet, getSetForCard, SET_IDS, type SetId } from "../../src/game/sets";
import { createPlayerId, type PlayerId, type PlayerSetup } from "../../src/game/types/player";

import { expectGameInvariants } from "./helpers";

const ids = {
  one: createPlayerId("audit-player-1"),
  two: createPlayerId("audit-player-2"),
  three: createPlayerId("audit-player-3"),
  four: createPlayerId("audit-player-4"),
  five: createPlayerId("audit-player-5"),
  six: createPlayerId("audit-player-6"),
} as const;

const players: readonly PlayerSetup[] = Object.freeze([
  { id: ids.one, displayName: "One", teamId: "TEAM_A" },
  { id: ids.two, displayName: "Two", teamId: "TEAM_A" },
  { id: ids.three, displayName: "Three", teamId: "TEAM_A" },
  { id: ids.four, displayName: "Four", teamId: "TEAM_B" },
  { id: ids.five, displayName: "Five", teamId: "TEAM_B" },
  { id: ids.six, displayName: "Six", teamId: "TEAM_B" },
]);

type PlayerKey = keyof typeof ids;
type StateOptions = Readonly<{
  currentTurnOwner?: PlayerId;
  hands?: Partial<Record<PlayerKey, readonly CardId[]>>;
  resolvedSetIds?: readonly SetId[];
  scores?: Readonly<{ TEAM_A: number; TEAM_B: number }>;
  phase?: GamePhase;
  blindDeclarationTeamId?: "TEAM_A" | "TEAM_B" | null;
  blindDeclarerId?: PlayerId | null;
}>;

const cardIds = CANONICAL_DECK.map((card) => card.id);

/** Builds a card-conserving test state and distributes unspecified cards across both teams. */
const createState = ({
  currentTurnOwner = ids.one,
  hands = {},
  resolvedSetIds = [],
  scores = { TEAM_A: resolvedSetIds.length, TEAM_B: 0 },
  phase,
  blindDeclarationTeamId,
  blindDeclarerId,
}: StateOptions = {}): NormalPlayGameState => {
  const explicitKeys = Object.keys(hands) as PlayerKey[];
  const fallbackKeys = (Object.keys(ids) as PlayerKey[]).filter((key) => !explicitKeys.includes(key));
  if (fallbackKeys.length === 0) throw new Error("At least one test player must receive unspecified cards.");

  const explicitCards = explicitKeys.flatMap((key) => hands[key] ?? []);
  if (new Set(explicitCards).size !== explicitCards.length) throw new Error("Test cards must be unique.");
  const remainingCards = cardIds
    .filter((cardId) => !resolvedSetIds.includes(getSetForCard(cardId)))
    .filter((cardId) => !explicitCards.includes(cardId));

  return createNormalPlayState({
    players: players.map((player) => {
      const key = (Object.keys(ids) as PlayerKey[]).find((candidate) => ids[candidate] === player.id)!;
      return {
        ...player,
        hand: hands[key] ?? remainingCards.filter(
          (_, index) => fallbackKeys[index % fallbackKeys.length] === key,
        ),
      };
    }),
    currentTurnOwner,
    resolvedSetIds,
    scores,
    phase,
    blindDeclarationTeamId,
    blindDeclarerId,
  });
};

const correctSubmission = (state: NormalPlayGameState, submittedAt: number): DeclarationSubmission => ({
  declarerId: state.activeDeclaration!.declarerId,
  assignments: state.activeDeclaration!.ownershipSnapshot.map(({ cardId, ownerId }) => ({ cardId, playerId: ownerId })),
  submittedAt,
});

const submissionAssigningEveryCardTo = (
  state: NormalPlayGameState,
  playerId: PlayerId,
  submittedAt: number,
): DeclarationSubmission => ({
  declarerId: state.activeDeclaration!.declarerId,
  assignments: state.activeDeclaration!.ownershipSnapshot.map(({ cardId }) => ({ cardId, playerId })),
  submittedAt,
});

const selectAuditBlindDeclarer = (state: NormalPlayGameState): NormalPlayGameState => {
  const selected = selectBlindDeclarer(state, ids.one);
  expect(selected.result).toEqual({
    kind: "BLIND_DECLARER_SELECTED",
    blindDeclarationTeamId: "TEAM_A",
    blindDeclarerId: ids.one,
  });
  expectGameInvariants(selected.state);
  return selected.state;
};

const resolveRemainingBlindSets = (
  initialState: NormalPlayGameState,
  outcomes: readonly ("CORRECT" | "INCORRECT" | "TIMED_OUT")[],
): NormalPlayGameState => {
  let state = initialState;
  const unresolvedSetIds = SET_IDS.filter((setId) => !state.resolvedSetIds.includes(setId));
  expect(outcomes).toHaveLength(unresolvedSetIds.length);

  for (const [index, setId] of unresolvedSetIds.entries()) {
    const started = startDeclaration(state, {
      declarerId: ids.one,
      selectedSetId: setId,
      startedAt: 1_000 + index * 100,
    });
    expect(started.result.kind).toBe("STARTED");
    expect(started.state.activeDeclaration?.mode).toBe("BLIND");

    state = outcomes[index] === "CORRECT"
      ? submitDeclaration(started.state, correctSubmission(started.state, 1_001 + index * 100)).state
      : outcomes[index] === "INCORRECT"
        ? submitDeclaration(started.state, submissionAssigningEveryCardTo(started.state, ids.two, 1_001 + index * 100)).state
        : resolveDeclarationTimeout(started.state, { resolvedAt: 1_091 + index * 100 }).state;
    expectGameInvariants(state);
  }
  return state;
};

describe("Build 08 state-transition audit", () => {
  it("immediately enters Blind Declaration when a successful ask empties a team", () => {
    const state = createState({
      hands: {
        one: cardIds.filter((cardId) => cardId !== "2H"),
        two: [],
        three: [],
        four: ["2H"],
        five: [],
      },
    });
    const before = JSON.stringify(state);

    const resolution = resolveAsk(state, {
      asker: ids.one,
      target: ids.four,
      requestedCard: "2H",
    });

    expect(resolution.result).toMatchObject({ kind: "SUCCESS", resultingTurnOwner: ids.one });
    expect(resolution.state.phase).toBe("BLIND_DECLARATION");
    expect(resolution.state.blindDeclarationTeamId).toBe("TEAM_A");
    expect(resolution.state.blindDeclarerId).toBeNull();
    expect(resolution.state.activeDeclaration).toBeNull();
    expect(JSON.stringify(state)).toBe(before);
    expectGameInvariants(resolution.state);
  });

  it("rejects impossible lifecycle states instead of silently constructing them", () => {
    const allCardsOnTeamA = players.map((player, index) => ({
      ...player,
      hand: index === 0 ? cardIds : [],
    }));

    expect(() => createNormalPlayState({
      players: allCardsOnTeamA,
      currentTurnOwner: ids.one,
      phase: "PLAYING",
    })).toThrow(GameDomainError);

    const validState = createState();
    expect(() => createNormalPlayState({
      players: validState.players,
      currentTurnOwner: ids.one,
      phase: "DECLARING",
    })).toThrow(GameDomainError);
    expect(() => createNormalPlayState({
      players: validState.players,
      currentTurnOwner: ids.one,
      normalAskingAllowed: false,
    })).toThrow(GameDomainError);
  });

  it("handles malformed runtime action shapes without mutation or unexpected throws", () => {
    const state = createState({ hands: { one: ["3H"], four: ["2H"] } });
    const stateBefore = JSON.stringify(state);
    const malformedAsk = resolveAsk(state, null as unknown as AskAction);
    const unknownCardAsk = resolveAsk(state, {
      asker: ids.one,
      target: ids.four,
      requestedCard: "NOT_A_CARD" as CardId,
    });
    const malformedStart = startDeclaration(state, null as unknown as Parameters<typeof startDeclaration>[1]);

    expect(malformedAsk).toEqual({ state, result: { kind: "INVALID", reason: "INVALID_ASK_ACTION" } });
    expect(unknownCardAsk).toEqual({ state, result: { kind: "INVALID", reason: "INVALID_REQUESTED_CARD" } });
    expect(malformedStart).toEqual({
      state,
      result: { kind: "INVALID_START", reason: "INVALID_DECLARATION_ACTION" },
    });
    expect(JSON.stringify(state)).toBe(stateBefore);

    const declaring = startDeclaration(state, {
      declarerId: ids.one,
      selectedSetId: "LOW_HEARTS",
      startedAt: 10,
    }).state;
    const declaringBefore = JSON.stringify(declaring);
    expect(submitDeclaration(declaring, null as unknown as DeclarationSubmission)).toEqual({
      state: declaring,
      result: { kind: "INVALID_SUBMISSION", reason: "INVALID_SUBMISSION" },
    });
    expect(resolveDeclarationTimeout(declaring, null as unknown as Parameters<typeof resolveDeclarationTimeout>[1]))
      .toEqual({ state: declaring, result: { kind: "INVALID_TIMEOUT", reason: "INVALID_TIMEOUT_TIMESTAMP" } });
    expect(JSON.stringify(declaring)).toBe(declaringBefore);

    const blind = createState({
      phase: "BLIND_DECLARATION",
      hands: { one: [], two: [], three: [], four: cardIds },
      blindDeclarationTeamId: "TEAM_B",
    });
    expect(selectBlindDeclarer(blind, null as unknown as PlayerId)).toEqual({
      state: blind,
      result: { kind: "INVALID_BLIND_DECLARER_SELECTION", reason: "INVALID_BLIND_DECLARER" },
    });
  });

  it("enforces timer boundaries, rejects imprecise extreme starts, and makes timeout resolution idempotent", () => {
    const state = createState();
    expect(startDeclaration(state, {
      declarerId: ids.one,
      selectedSetId: "LOW_HEARTS",
      startedAt: Number.MAX_VALUE,
    }).result).toEqual({ kind: "INVALID_START", reason: "INVALID_STARTED_AT" });

    const started = startDeclaration(state, {
      declarerId: ids.one,
      selectedSetId: "LOW_HEARTS",
      startedAt: 100,
    });
    expect(resolveDeclarationTimeout(started.state, { resolvedAt: 189 }).result)
      .toEqual({ kind: "TIMEOUT_NOT_REACHED", deadline: 190 });
    expect(resolveDeclarationTimeout(started.state, { resolvedAt: 190 }).result)
      .toEqual({ kind: "TIMEOUT_NOT_REACHED", deadline: 190 });

    const timedOut = resolveDeclarationTimeout(started.state, { resolvedAt: 191 });
    expect(timedOut.result.kind).toBe("TIMED_OUT");
    expectGameInvariants(timedOut.state);
    expect(resolveDeclarationTimeout(timedOut.state, { resolvedAt: 192 })).toEqual({
      state: timedOut.state,
      result: { kind: "INVALID_TIMEOUT", reason: "NO_ACTIVE_DECLARATION" },
    });
    expect(submitDeclaration(timedOut.state, correctSubmission(started.state, 190))).toEqual({
      state: timedOut.state,
      result: { kind: "INVALID_SUBMISSION", reason: "NO_ACTIVE_DECLARATION" },
    });
  });
});

describe("Build 08 deterministic full-game scenarios", () => {
  it("Scenario A: runs normal asks, multiple declarations, and a complete game", () => {
    const lowDiamonds = getCardsInSet("LOW_DIAMONDS");
    let state = createState({
      hands: {
        one: cardIds.filter((cardId) => cardId !== "2H" && !lowDiamonds.includes(cardId)),
        two: [],
        three: [],
        four: ["2H", ...lowDiamonds],
        five: [],
      },
    });
    expectGameInvariants(state);

    state = resolveAsk(state, { asker: ids.one, target: ids.four, requestedCard: "2H" }).state;
    expect(state.phase).toBe("PLAYING");
    expectGameInvariants(state);

    const started = startDeclaration(state, {
      declarerId: ids.one,
      selectedSetId: "LOW_DIAMONDS",
      startedAt: 10,
    });
    state = submitDeclaration(started.state, submissionAssigningEveryCardTo(started.state, ids.one, 11)).state;
    expect(state.phase).toBe("BLIND_DECLARATION");
    expect(state.scores).toEqual({ TEAM_A: 0, TEAM_B: 1 });
    expectGameInvariants(state);

    state = resolveRemainingBlindSets(selectAuditBlindDeclarer(state), Array(8).fill("CORRECT"));
    expect(state.phase).toBe("GAME_OVER");
    expect(state.scores).toEqual({ TEAM_A: 8, TEAM_B: 1 });
    expectGameInvariants(state);
  });

  it("Scenario B: transitions from normal play to Blind Declaration and resolves every remaining set", () => {
    const lowHearts = getCardsInSet("LOW_HEARTS");
    let state = createState({
      hands: {
        one: cardIds.filter((cardId) => !lowHearts.includes(cardId)),
        two: [],
        three: [],
        four: lowHearts,
        five: [],
      },
    });
    const started = startDeclaration(state, {
      declarerId: ids.one,
      selectedSetId: "LOW_HEARTS",
      startedAt: 10,
    });
    state = submitDeclaration(started.state, submissionAssigningEveryCardTo(started.state, ids.one, 11)).state;
    expect(state.phase).toBe("BLIND_DECLARATION");
    expect(state.blindDeclarationTeamId).toBe("TEAM_A");
    expectGameInvariants(state);

    state = resolveRemainingBlindSets(selectAuditBlindDeclarer(state), Array(8).fill("CORRECT"));
    expect(state.phase).toBe("GAME_OVER");
    expect(state.resolvedSetIds).toHaveLength(9);
    expect(state.scores).toEqual({ TEAM_A: 8, TEAM_B: 1 });
    expectGameInvariants(state);
  });

  it("Scenario C: mixes correct, incorrect, and timed-out declarations in a valid nine-point game", () => {
    const lowHearts = getCardsInSet("LOW_HEARTS");
    let state = createState({
      hands: {
        one: cardIds.filter((cardId) => !lowHearts.includes(cardId)),
        two: [],
        three: [],
        four: lowHearts,
        five: [],
      },
    });
    const started = startDeclaration(state, {
      declarerId: ids.one,
      selectedSetId: "LOW_HEARTS",
      startedAt: 10,
    });
    state = submitDeclaration(started.state, submissionAssigningEveryCardTo(started.state, ids.one, 11)).state;
    state = resolveRemainingBlindSets(selectAuditBlindDeclarer(state), [
      "CORRECT", "INCORRECT", "TIMED_OUT", "CORRECT",
      "INCORRECT", "TIMED_OUT", "CORRECT", "TIMED_OUT",
    ]);

    expect(state.phase).toBe("GAME_OVER");
    expect(state.scores).toEqual({ TEAM_A: 3, TEAM_B: 6 });
    expect(state.winnerTeamId).toBe("TEAM_B");
    expect(state.players.flatMap((player) => player.hand)).toEqual([]);
    expectGameInvariants(state);
  });
});
