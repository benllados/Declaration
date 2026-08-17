import { describe, expect, it } from "vitest";

import { CANONICAL_DECK, type CardId } from "../../src/game/cards";
import { selectBlindDeclarer } from "../../src/game/engine/blind-declaration";
import {
  resolveDeclarationTimeout,
  startDeclaration,
  submitDeclaration,
  type DeclarationSubmission,
} from "../../src/game/engine/declaration";
import { resolveAsk, validateAsk, type AskAction } from "../../src/game/engine/asking";
import {
  createNormalPlayState,
  getTeamWithZeroActiveCards,
  getWinnerTeamId,
  teamHasZeroActiveCards,
  type GamePhase,
  type NormalPlayGameState,
} from "../../src/game/engine/normal-play";
import { getCardsInSet, getSetForCard, SET_IDS, type SetId } from "../../src/game/sets";
import { createPlayerId, type PlayerId, type PlayerSetup } from "../../src/game/types/player";

const ids = {
  one: createPlayerId("player-1"),
  two: createPlayerId("player-2"),
  three: createPlayerId("player-3"),
  four: createPlayerId("player-4"),
  five: createPlayerId("player-5"),
  six: createPlayerId("player-6"),
} as const;

const players: readonly PlayerSetup[] = Object.freeze([
  { id: ids.one, displayName: "One", teamId: "TEAM_A" },
  { id: ids.two, displayName: "Two", teamId: "TEAM_A" },
  { id: ids.three, displayName: "Three", teamId: "TEAM_A" },
  { id: ids.four, displayName: "Four", teamId: "TEAM_B" },
  { id: ids.five, displayName: "Five", teamId: "TEAM_B" },
  { id: ids.six, displayName: "Six", teamId: "TEAM_B" },
]);

type StateOptions = Readonly<{
  phase?: GamePhase;
  resolvedSetIds?: readonly SetId[];
  scores?: Readonly<{ TEAM_A: number; TEAM_B: number }>;
  hands?: Partial<Record<keyof typeof ids, readonly CardId[]>>;
  blindDeclarationTeamId?: "TEAM_A" | "TEAM_B" | null;
  blindDeclarerId?: PlayerId | null;
}>;

const allCardsForUnresolvedSets = (resolvedSetIds: readonly SetId[]): readonly CardId[] =>
  CANONICAL_DECK.map((card) => card.id).filter((cardId) => !resolvedSetIds.includes(getSetForCard(cardId)));

const createState = ({
  phase = "PLAYING",
  resolvedSetIds = [],
  scores = { TEAM_A: resolvedSetIds.length, TEAM_B: 0 },
  hands = {},
  blindDeclarationTeamId = null,
  blindDeclarerId = null,
}: StateOptions = {}): NormalPlayGameState => {
  const explicitKeys = Object.keys(hands) as (keyof typeof ids)[];
  const explicitCards = explicitKeys.flatMap((key) => hands[key] ?? []);
  const fallbackKeys = (Object.keys(ids) as (keyof typeof ids)[]).filter((key) => !explicitKeys.includes(key));
  if (fallbackKeys.length === 0) throw new Error("A player must receive cards not explicitly assigned by this test.");

  const remainingCards = allCardsForUnresolvedSets(resolvedSetIds)
    .filter((cardId) => !explicitCards.includes(cardId));
  return createNormalPlayState({
    players: players.map((player) => {
      const key = (Object.keys(ids) as (keyof typeof ids)[]).find((candidate) => ids[candidate] === player.id)!;
      return {
        ...player,
        hand: hands[key] ?? remainingCards.filter(
          (_, index) => fallbackKeys[index % fallbackKeys.length] === key,
        ),
      };
    }),
    currentTurnOwner: ids.one,
    resolvedSetIds,
    phase,
    scores,
    blindDeclarationTeamId,
    blindDeclarerId,
  });
};

const correctSubmission = (state: NormalPlayGameState, submittedAt: number): DeclarationSubmission => ({
  declarerId: state.activeDeclaration!.declarerId,
  assignments: state.activeDeclaration!.ownershipSnapshot.map(({ cardId, ownerId }) => ({ cardId, playerId: ownerId })),
  submittedAt,
});

const incorrectSubmission = (state: NormalPlayGameState, submittedAt: number): DeclarationSubmission => {
  const correct = correctSubmission(state, submittedAt);
  const owner = state.players.find((player) => player.id === correct.assignments[0].playerId)!;
  const incorrectTeammateId = owner.teamId === "TEAM_A" ? ids.two : ids.five;
  return {
    ...correct,
    assignments: correct.assignments.map((assignment, index) => index === 0
      ? { ...assignment, playerId: incorrectTeammateId }
      : assignment),
  };
};

const expectConservation = (state: NormalPlayGameState): void => {
  const activeCards = state.players.flatMap((player) => player.hand);
  const resolvedCards = state.resolvedSetIds.flatMap((setId) => getCardsInSet(setId));
  expect(state.scores.TEAM_A + state.scores.TEAM_B).toBe(state.resolvedSetIds.length);
  expect(activeCards.length + resolvedCards.length).toBe(54);
  expect(new Set([...activeCards, ...resolvedCards]).size).toBe(54);
};

const blindState = (resolvedSetIds: readonly SetId[] = SET_IDS.slice(0, 7)): NormalPlayGameState =>
  createState({
    phase: "BLIND_DECLARATION",
    resolvedSetIds,
    hands: { one: [], two: [], three: [], four: allCardsForUnresolvedSets(resolvedSetIds) },
    blindDeclarationTeamId: "TEAM_B",
  });

describe("zero-card team detection and lifecycle transitions", () => {
  it("requires all three teammates to have zero active cards", () => {
    const oneAndTwoEmpty = createState({ hands: { one: [], two: [], three: ["2H"], four: ["2D"] } });
    expect(teamHasZeroActiveCards(oneAndTwoEmpty.players, "TEAM_A")).toBe(false);
    expect(getTeamWithZeroActiveCards(oneAndTwoEmpty.players)).toBeNull();

    const allTeamAEmpty = createState({
      phase: "BLIND_DECLARATION",
      hands: { one: [], two: [], three: [], four: ["2H"] },
      blindDeclarationTeamId: "TEAM_B",
    });
    expect(teamHasZeroActiveCards(allTeamAEmpty.players, "TEAM_A")).toBe(true);
    expect(getTeamWithZeroActiveCards(allTeamAEmpty.players)).toBe("TEAM_A");
  });

  it("enters Blind Declaration after a normal declaration leaves a team empty", () => {
    const lowHearts = getCardsInSet("LOW_HEARTS");
    const state = createState({
      hands: {
        one: lowHearts,
        four: allCardsForUnresolvedSets([]).filter((cardId) => !lowHearts.includes(cardId)),
      },
    });
    const started = startDeclaration(state, { declarerId: ids.one, selectedSetId: "LOW_HEARTS", startedAt: 10 });
    const resolved = submitDeclaration(started.state, correctSubmission(started.state, 11));

    expect(resolved.state.phase).toBe("BLIND_DECLARATION");
    expect(resolved.state.blindDeclarationTeamId).toBe("TEAM_B");
    expect(resolved.state.blindDeclarerId).toBeNull();
    expect(validateAsk(resolved.state, { asker: ids.one, target: ids.four, requestedCard: "2D" })).toEqual({
      status: "ILLEGAL",
      reason: "NORMAL_ASKING_NOT_ALLOWED",
    });
    expectConservation(resolved.state);
  });

  it("ends the game instead of entering Blind Declaration when the final set resolves", () => {
    const resolvedSetIds = SET_IDS.filter((setId) => setId !== "LOW_HEARTS");
    const state = createState({
      phase: "BLIND_DECLARATION",
      resolvedSetIds,
      scores: { TEAM_A: 8, TEAM_B: 0 },
      hands: { one: getCardsInSet("LOW_HEARTS"), four: [] },
      blindDeclarationTeamId: "TEAM_A",
      blindDeclarerId: ids.one,
    });
    const started = startDeclaration(state, { declarerId: ids.one, selectedSetId: "LOW_HEARTS", startedAt: 10 });
    const resolved = submitDeclaration(started.state, correctSubmission(started.state, 11));

    expect(resolved.state.phase).toBe("GAME_OVER");
    expect(resolved.state.blindDeclarationTeamId).toBe("TEAM_A");
    expect(resolved.state.blindDeclarerId).toBe(ids.one);
    expect(resolved.state.winnerTeamId).toBe("TEAM_A");
  });
});

describe("Blind Declarer selection and authorization", () => {
  it("selects an eligible player, including a zero-card teammate, and locks the choice", () => {
    const state = blindState();
    const selected = selectBlindDeclarer(state, { playerId: ids.five });

    expect(selected.result).toEqual({
      kind: "BLIND_DECLARER_SELECTED",
      blindDeclarerId: ids.five,
      blindDeclarationTeamId: "TEAM_B",
    });
    expect(selected.state.blindDeclarerId).toBe(ids.five);
    expect(selectBlindDeclarer(selected.state, { blindDeclarerId: ids.four }).result).toEqual({
      kind: "INVALID_BLIND_DECLARER_SELECTION",
      reason: "BLIND_DECLARER_ALREADY_SELECTED",
    });
  });

  it("rejects selection before Blind Mode, opponents, and unknown players", () => {
    expect(selectBlindDeclarer(createState(), ids.one).result).toEqual({
      kind: "INVALID_BLIND_DECLARER_SELECTION",
      reason: "BLIND_DECLARATION_NOT_ACTIVE",
    });
    expect(selectBlindDeclarer(blindState(), ids.one).result).toEqual({
      kind: "INVALID_BLIND_DECLARER_SELECTION",
      reason: "PLAYER_NOT_ON_BLIND_DECLARATION_TEAM",
    });
    expect(selectBlindDeclarer(blindState(), createPlayerId("unknown")).result).toEqual({
      kind: "INVALID_BLIND_DECLARER_SELECTION",
      reason: "INVALID_BLIND_DECLARER",
    });
  });

  it("allows only the selected Blind Declarer to start a remaining declaration", () => {
    const selected = selectBlindDeclarer(blindState(), ids.five).state;
    expect(startDeclaration(selected, { declarerId: ids.four, selectedSetId: "HIGH_SPADES", startedAt: 1 }).result)
      .toEqual({ kind: "INVALID_START", reason: "NOT_BLIND_DECLARER" });
    expect(startDeclaration(selected, { declarerId: ids.one, selectedSetId: "HIGH_SPADES", startedAt: 1 }).result)
      .toEqual({ kind: "INVALID_START", reason: "NOT_BLIND_DECLARER" });
    const started = startDeclaration(selected, { declarerId: ids.five, selectedSetId: "HIGH_SPADES", startedAt: 1 });
    expect(started.result.kind).toBe("STARTED");
    expect(started.state.phase).toBe("BLIND_DECLARATION");
  });

  it("blocks every declaration until the Blind Declarer is explicitly selected", () => {
    expect(startDeclaration(blindState(), {
      declarerId: ids.four,
      selectedSetId: "HIGH_SPADES",
      startedAt: 1,
    }).result).toEqual({ kind: "INVALID_START", reason: "BLIND_DECLARER_NOT_SELECTED" });
  });
});

describe("Blind Declaration resolution", () => {
  it("keeps the same selected player and Blind Mode after correct, incorrect, and timed-out sets", () => {
    let state = selectBlindDeclarer(blindState(SET_IDS.slice(0, 5)), ids.five).state;
    const first = startDeclaration(state, { declarerId: ids.five, selectedSetId: "HIGH_DIAMONDS", startedAt: 10 });
    state = submitDeclaration(first.state, correctSubmission(first.state, 20)).state;
    expect(state.phase).toBe("BLIND_DECLARATION");
    expect(state.blindDeclarerId).toBe(ids.five);
    expect(state.scores).toEqual({ TEAM_A: 5, TEAM_B: 1 });

    const second = startDeclaration(state, { declarerId: ids.five, selectedSetId: "HIGH_CLUBS", startedAt: 30 });
    state = submitDeclaration(second.state, incorrectSubmission(second.state, 40)).state;
    expect(state.phase).toBe("BLIND_DECLARATION");
    expect(state.blindDeclarerId).toBe(ids.five);
    expect(state.scores).toEqual({ TEAM_A: 6, TEAM_B: 1 });

    const third = startDeclaration(state, { declarerId: ids.five, selectedSetId: "HIGH_SPADES", startedAt: 50 });
    state = resolveDeclarationTimeout(third.state, { resolvedAt: 141 }).state;
    expect(state.phase).toBe("BLIND_DECLARATION");
    expect(state.blindDeclarerId).toBe(ids.five);
    expect(state.scores).toEqual({ TEAM_A: 7, TEAM_B: 1 });
    expectConservation(state);
  });
});

describe("complete game lifecycle", () => {
  const resolveCompleteGame = (): NormalPlayGameState => {
    let state = createState({
      hands: {
        one: CANONICAL_DECK.map((card) => card.id).filter((cardId) => !getCardsInSet("LOW_HEARTS").includes(cardId)),
        four: getCardsInSet("LOW_HEARTS"),
      },
    });
    const first = startDeclaration(state, { declarerId: ids.one, selectedSetId: "LOW_HEARTS", startedAt: 0 });
    state = submitDeclaration(first.state, {
      declarerId: ids.one,
      assignments: getCardsInSet("LOW_HEARTS").map((cardId) => ({ cardId, playerId: ids.one })),
      submittedAt: 1,
    }).state;
    state = selectBlindDeclarer(state, ids.one).state;

    const remainingSetIds = SET_IDS.filter((setId) => setId !== "LOW_HEARTS");
    for (const [index, setId] of remainingSetIds.entries()) {
      const started = startDeclaration(state, { declarerId: ids.one, selectedSetId: setId, startedAt: 100 + index * 100 });
      state = (index < 4
        ? submitDeclaration(started.state, correctSubmission(started.state, 101 + index * 100))
        : submitDeclaration(started.state, incorrectSubmission(started.state, 101 + index * 100)))
        .state;
      expectConservation(state);
    }
    return state;
  };

  it("resolves all nine sets into a terminal 4-5 game with a deterministic winner", () => {
    const state = resolveCompleteGame();
    expect(state.phase).toBe("GAME_OVER");
    expect(state.resolvedSetIds).toHaveLength(9);
    expect(state.scores).toEqual({ TEAM_A: 4, TEAM_B: 5 });
    expect(getWinnerTeamId(state)).toBe("TEAM_B");
    expect(state.winnerTeamId).toBe("TEAM_B");
    expect(state.activeDeclaration).toBeNull();
    expect(state.players.flatMap((player) => player.hand)).toEqual([]);
    expectConservation(state);
  });

  it("makes GAME_OVER terminal for asks, selection, declarations, submissions, and timeouts", () => {
    const state = resolveCompleteGame();
    const ask: AskAction = { asker: ids.one, target: ids.four, requestedCard: "2H" };
    const before = JSON.stringify(state);

    expect(resolveAsk(state, ask).state).toBe(state);
    expect(startDeclaration(state, { declarerId: ids.one, selectedSetId: "LOW_HEARTS", startedAt: 1 }).state).toBe(state);
    expect(selectBlindDeclarer(state, ids.one).state).toBe(state);
    expect(submitDeclaration(state, { declarerId: ids.one, assignments: [], submittedAt: 1 }).state).toBe(state);
    expect(resolveDeclarationTimeout(state, { resolvedAt: 1 }).state).toBe(state);
    expect(JSON.stringify(state)).toBe(before);
    expect(state.phase).toBe("GAME_OVER");
  });
});
