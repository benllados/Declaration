import { describe, expect, it } from "vitest";

import { CANONICAL_DECK, type CardId } from "../../src/game/cards";
import {
  resolveDeclarationTimeout,
  startDeclaration,
  submitDeclaration,
  validateDeclarationSubmission,
  type DeclarationAssignment,
  type DeclarationSubmission,
} from "../../src/game/engine/declaration";
import { resolveAsk, validateAsk, type AskAction } from "../../src/game/engine/asking";
import { createNormalPlayState, type NormalPlayGameState } from "../../src/game/engine/normal-play";
import { initializeNormalPlayGame } from "../../src/game/engine/setup";
import { getCardsInSet, getSetForCard, type SetId } from "../../src/game/sets";
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
  currentTurnOwner?: PlayerId;
  hands?: Partial<Record<keyof typeof ids, readonly CardId[]>>;
  resolvedSetIds?: readonly SetId[];
}>;

/** Creates a complete authoritative state while allowing deterministic hands. */
const createState = ({
  currentTurnOwner = ids.four,
  hands = {},
  resolvedSetIds = [],
}: StateOptions = {}): NormalPlayGameState => {
  const initialState = initializeNormalPlayGame({ players, initialTurnOwner: currentTurnOwner }, () => 0);
  const activeCards = CANONICAL_DECK
    .map((card) => card.id)
    .filter((cardId) => !resolvedSetIds.includes(getSetForCard(cardId)));
  const explicitHandKeys = Object.keys(hands) as (keyof typeof ids)[];
  const assignedCards = explicitHandKeys.flatMap((key) => hands[key] ?? []);
  const fallbackKeys = (Object.keys(ids) as (keyof typeof ids)[]).filter(
    (key) => !explicitHandKeys.includes(key),
  );

  if (fallbackKeys.length === 0) throw new Error("The test state requires a player to receive remaining cards.");
  if (new Set(assignedCards).size !== assignedCards.length) throw new Error("Test cards must be unique.");

  const remainingCards = activeCards.filter((cardId) => !assignedCards.includes(cardId));
  return createNormalPlayState({
    players: initialState.players.map((player) => {
      const key = (Object.keys(ids) as (keyof typeof ids)[]).find((candidate) => ids[candidate] === player.id)!;
      return {
        ...player,
        hand: hands[key] ?? remainingCards.filter(
          (_, index) => fallbackKeys[index % fallbackKeys.length] === key,
        ),
      };
    }),
    currentTurnOwner,
    resolvedSetIds,
    scores: { TEAM_A: resolvedSetIds.length, TEAM_B: 0 },
  });
};

const declarationReadyState = (): NormalPlayGameState => createState({
  hands: {
    one: ["2H", "3H", "2C"],
    two: ["4H", "5H"],
    three: ["6H", "7H"],
  },
});

const startLowHearts = (state = declarationReadyState(), startedAt = 1_000) =>
  startDeclaration(state, {
    declarerId: ids.two,
    selectedSetId: "LOW_HEARTS",
    startedAt,
  });

const correctSubmission = (
  state: NormalPlayGameState,
  submittedAt: number,
): DeclarationSubmission => ({
  declarerId: state.activeDeclaration!.declarerId,
  assignments: state.activeDeclaration!.ownershipSnapshot.map(({ cardId, ownerId }) => ({
    cardId,
    playerId: ownerId,
  })),
  submittedAt,
});

const handSnapshot = (state: NormalPlayGameState) =>
  state.players.map((player) => ({ id: player.id, hand: [...player.hand] }));

const activeCardIds = (state: NormalPlayGameState): readonly CardId[] =>
  state.players.flatMap((player) => player.hand);

const expectCardConservation = (state: NormalPlayGameState, expectedActiveCards: number): void => {
  const activeCards = activeCardIds(state);
  const resolvedCards = state.resolvedSetIds.flatMap((setId) => getCardsInSet(setId));
  expect(activeCards).toHaveLength(expectedActiveCards);
  expect(new Set(activeCards).size).toBe(activeCards.length);
  expect(activeCards.length + resolvedCards.length).toBe(54);
  expect(new Set([...activeCards, ...resolvedCards]).size).toBe(54);
};

describe("starting a normal declaration", () => {
  it.each(Object.values(ids))("allows valid player %s to start a declaration", (declarerId) => {
    const state = declarationReadyState();
    const resolution = startDeclaration(state, {
      declarerId,
      selectedSetId: "LOW_DIAMONDS",
      startedAt: 1,
    });

    expect(resolution.result.kind).toBe("STARTED");
    expect(resolution.state.activeDeclaration?.declarerId).toBe(declarerId);
    expect(resolution.state.currentTurnOwner).toBe(ids.four);
  });

  it("lets any valid player interrupt the current turn, locks its set, and freezes normal asking", () => {
    const state = declarationReadyState();
    const beforeHands = handSnapshot(state);
    const resolution = startLowHearts(state, 50_000);

    expect(resolution.result).toEqual({
      kind: "STARTED",
      declarerId: ids.two,
      declarerTeamId: "TEAM_A",
      selectedSetId: "LOW_HEARTS",
      deadline: 50_090,
      interruptedTurnOwner: ids.four,
    });
    expect(resolution.state.activeDeclaration).toMatchObject({
      declarerId: ids.two,
      declarerTeamId: "TEAM_A",
      selectedSetId: "LOW_HEARTS",
      startedAt: 50_000,
      deadline: 50_090,
      interruptedTurnOwner: ids.four,
    });
    expect(resolution.state.currentTurnOwner).toBe(ids.four);
    expect(resolution.state.normalAskingAllowed).toBe(false);
    expect(resolution.state.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
    expect(handSnapshot(resolution.state)).toEqual(beforeHands);
    expect(handSnapshot(state)).toEqual(beforeHands);
    expect(JSON.stringify(resolution.result)).not.toContain("2H");
  });

  it("rejects unknown declarers, invalid or resolved sets, and simultaneous declarations", () => {
    const state = declarationReadyState();

    expect(startDeclaration(state, {
      declarerId: createPlayerId("not-in-game"), selectedSetId: "LOW_HEARTS", startedAt: 1,
    }).result).toEqual({ kind: "INVALID_START", reason: "INVALID_DECLARER" });
    expect(startDeclaration(state, {
      declarerId: ids.one, selectedSetId: "UNKNOWN" as SetId, startedAt: 1,
    }).result).toEqual({ kind: "INVALID_START", reason: "INVALID_SELECTED_SET" });
    expect(startDeclaration(createState({ resolvedSetIds: ["LOW_HEARTS"] }), {
      declarerId: ids.one, selectedSetId: "LOW_HEARTS", startedAt: 1,
    }).result).toEqual({ kind: "INVALID_START", reason: "SET_ALREADY_RESOLVED" });
    const activeState = startLowHearts(state).state;
    expect(startDeclaration(activeState, {
      declarerId: ids.one, selectedSetId: "LOW_DIAMONDS", startedAt: 2,
    }).result).toEqual({ kind: "INVALID_START", reason: "DECLARATION_ALREADY_ACTIVE" });
  });
});

describe("declaration freezes normal asks", () => {
  it("blocks an otherwise legal ask without transferring a card or changing the interrupted turn", () => {
    const started = startLowHearts();
    const action: AskAction = { asker: ids.four, target: ids.one, requestedCard: "2H" };
    const beforeHands = handSnapshot(started.state);

    expect(validateAsk(started.state, action)).toEqual({
      status: "ILLEGAL",
      reason: "NORMAL_ASKING_NOT_ALLOWED",
    });
    const resolution = resolveAsk(started.state, action);
    expect(resolution.result).toEqual({
      kind: "ILLEGAL",
      asker: ids.four,
      target: ids.one,
      requestedCard: "2H",
      reason: "NORMAL_ASKING_NOT_ALLOWED",
      resultingTurnOwner: ids.four,
    });
    expect(handSnapshot(resolution.state)).toEqual(beforeHands);
    expect(resolution.state.currentTurnOwner).toBe(ids.four);
    expect(resolution.state.activeDeclaration).not.toBeNull();
  });
});

describe("declaration submission structure", () => {
  it("rejects malformed submissions without scoring or resolving the locked set", () => {
    const started = startLowHearts();
    const valid = correctSubmission(started.state, 1_001);
    const outsideSet: readonly DeclarationAssignment[] = [
      { cardId: "2D", playerId: ids.one },
      ...valid.assignments.slice(1),
    ];
    const duplicate: readonly DeclarationAssignment[] = [
      valid.assignments[0], valid.assignments[0], ...valid.assignments.slice(2),
    ];
    const cases: readonly Readonly<{
      submission: DeclarationSubmission;
      reason: string;
    }>[] = [
      { submission: { ...valid, declarerId: ids.one }, reason: "WRONG_DECLARER" },
      { submission: { ...valid, assignments: valid.assignments.slice(0, 5) }, reason: "ASSIGNMENT_COUNT_MISMATCH" },
      { submission: { ...valid, assignments: duplicate }, reason: "DUPLICATE_ASSIGNED_CARD" },
      { submission: { ...valid, assignments: outsideSet }, reason: "CARD_OUTSIDE_SELECTED_SET" },
      {
        submission: {
          ...valid,
          assignments: valid.assignments.map((assignment, index) => index === 0
            ? { ...assignment, playerId: createPlayerId("unknown") }
            : assignment),
        },
        reason: "INVALID_ASSIGNED_PLAYER",
      },
      {
        submission: {
          ...valid,
          assignments: valid.assignments.map((assignment, index) => index === 0
            ? { ...assignment, playerId: ids.four }
            : assignment),
        },
        reason: "ASSIGNED_PLAYER_IS_OPPONENT",
      },
      { submission: { ...valid, assignments: [...valid.assignments, valid.assignments[0]] }, reason: "ASSIGNMENT_COUNT_MISMATCH" },
    ];

    for (const { submission, reason } of cases) {
      const resolution = submitDeclaration(started.state, submission);
      expect(resolution.result).toEqual({ kind: "INVALID_SUBMISSION", reason });
      expect(resolution.state).toBe(started.state);
      expect(resolution.state.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
      expect(resolution.state.resolvedSetIds).toEqual([]);
    }

    expect(submitDeclaration(declarationReadyState(), valid).result).toEqual({
      kind: "INVALID_SUBMISSION",
      reason: "NO_ACTIVE_DECLARATION",
    });
  });

  it("allows a corrected complete submission while the timer remains active", () => {
    const started = startLowHearts();
    const malformed = submitDeclaration(started.state, {
      ...correctSubmission(started.state, 1_001),
      assignments: correctSubmission(started.state, 1_001).assignments.slice(0, 5),
    });
    const corrected = submitDeclaration(malformed.state, correctSubmission(malformed.state, 1_002));

    expect(malformed.result).toEqual({ kind: "INVALID_SUBMISSION", reason: "ASSIGNMENT_COUNT_MISMATCH" });
    expect(malformed.state.activeDeclaration).not.toBeNull();
    expect(corrected.result.kind).toBe("CORRECT");
  });
});

describe("correct and incorrect declaration resolution", () => {
  it("scores a correct snapshot match, removes exactly six cards, and restores the interrupted turn", () => {
    const initialState = declarationReadyState();
    const beforeHands = handSnapshot(initialState);
    const started = startLowHearts(initialState);
    const resolution = submitDeclaration(started.state, correctSubmission(started.state, 1_090));

    expect(resolution.result).toEqual({
      kind: "CORRECT",
      declarerId: ids.two,
      selectedSetId: "LOW_HEARTS",
      scoringTeamId: "TEAM_A",
      resultingTurnOwner: ids.four,
    });
    expect(resolution.state.scores).toEqual({ TEAM_A: 1, TEAM_B: 0 });
    expect(resolution.state.resolvedSetIds).toEqual(["LOW_HEARTS"]);
    expect(resolution.state.activeDeclaration).toBeNull();
    expect(resolution.state.normalAskingAllowed).toBe(true);
    expect(resolution.state.currentTurnOwner).toBe(ids.four);
    expect(getCardsInSet("LOW_HEARTS").every((cardId) => !activeCardIds(resolution.state).includes(cardId))).toBe(true);
    expect(activeCardIds(resolution.state)).toContain("2C");
    expectCardConservation(resolution.state, 48);
    expect(handSnapshot(initialState)).toEqual(beforeHands);
  });

  it("awards the opponent the whole point when only one assignment is wrong", () => {
    const started = startLowHearts();
    const exact = correctSubmission(started.state, 1_001);
    const oneWrong: DeclarationSubmission = {
      ...exact,
      assignments: exact.assignments.map((assignment, index) => index === 0
        ? { ...assignment, playerId: ids.three }
        : assignment),
    };
    const resolution = submitDeclaration(started.state, oneWrong);

    expect(resolution.result).toMatchObject({
      kind: "INCORRECT",
      scoringTeamId: "TEAM_B",
      selectedSetId: "LOW_HEARTS",
      resultingTurnOwner: ids.four,
    });
    expect(resolution.state.scores).toEqual({ TEAM_A: 0, TEAM_B: 1 });
    expect(resolution.state.resolvedSetIds).toEqual(["LOW_HEARTS"]);
    expectCardConservation(resolution.state, 48);
  });

  it("uses the ownership snapshot instead of a later authoritative hand representation", () => {
    const started = startLowHearts();
    const changedHands = started.state.players.map((player) => {
      if (player.id === ids.one) return { ...player, hand: player.hand.filter((cardId) => cardId !== "2H") };
      if (player.id === ids.two) return { ...player, hand: [...player.hand, "2H"] };
      return player;
    });
    const laterState = createNormalPlayState({
      players: changedHands,
      currentTurnOwner: started.state.currentTurnOwner,
      resolvedSetIds: started.state.resolvedSetIds,
      normalAskingAllowed: false,
      scores: started.state.scores,
      activeDeclaration: started.state.activeDeclaration,
    });
    const resolution = submitDeclaration(laterState, correctSubmission(started.state, 1_001));

    expect(resolution.result.kind).toBe("CORRECT");
    expect(resolution.state.scores).toEqual({ TEAM_A: 1, TEAM_B: 0 });
  });
});

describe("declaration timing and resolved sets", () => {
  it("accepts submissions through the exact deadline and treats a later submission as timeout", () => {
    for (const submittedAt of [100, 189, 190]) {
      const started = startLowHearts(declarationReadyState(), 100);
      expect(validateDeclarationSubmission(started.state, correctSubmission(started.state, submittedAt)))
        .toEqual({ status: "VALID" });
    }

    const started = startLowHearts(declarationReadyState(), 100);
    const resolution = submitDeclaration(started.state, correctSubmission(started.state, 190.001));
    expect(resolution.result).toMatchObject({ kind: "TIMED_OUT", scoringTeamId: "TEAM_B" });
    expect(resolution.state.scores).toEqual({ TEAM_A: 0, TEAM_B: 1 });
    expect(resolution.state.resolvedSetIds).toEqual(["LOW_HEARTS"]);
  });

  it("resolves the locked set only after its deadline has passed without a valid submission", () => {
    const started = startLowHearts(declarationReadyState(), 100);

    expect(resolveDeclarationTimeout(started.state, { resolvedAt: 190 }).result).toEqual({
      kind: "TIMEOUT_NOT_REACHED",
      deadline: 190,
    });
    const resolution = resolveDeclarationTimeout(started.state, { resolvedAt: 191 });
    expect(resolution.result).toMatchObject({
      kind: "TIMED_OUT",
      selectedSetId: "LOW_HEARTS",
      scoringTeamId: "TEAM_B",
      resultingTurnOwner: ids.four,
    });
    expect(resolution.state.scores).toEqual({ TEAM_A: 0, TEAM_B: 1 });
    expect(resolution.state.activeDeclaration).toBeNull();
    expect(resolution.state.currentTurnOwner).toBe(ids.four);
  });

  it("prevents resolved-set asks and declarations, and conserves cards across two resolutions", () => {
    const firstStarted = startLowHearts();
    const first = submitDeclaration(firstStarted.state, correctSubmission(firstStarted.state, 1_001));
    const resolvedAsk: AskAction = { asker: ids.four, target: ids.one, requestedCard: "2H" };

    expect(validateAsk(first.state, resolvedAsk)).toEqual({
      status: "ILLEGAL",
      reason: "SET_ALREADY_RESOLVED",
    });
    const repeatDeclaration = startDeclaration(first.state, {
      declarerId: ids.four, selectedSetId: "LOW_HEARTS", startedAt: 2_000,
    });
    expect(repeatDeclaration.result).toEqual({ kind: "INVALID_START", reason: "SET_ALREADY_RESOLVED" });
    expect(repeatDeclaration.state).toBe(first.state);
    expect(repeatDeclaration.state.scores).toEqual({ TEAM_A: 1, TEAM_B: 0 });

    const secondStarted = startDeclaration(first.state, {
      declarerId: ids.four, selectedSetId: "LOW_DIAMONDS", startedAt: 2_000,
    });
    const second = submitDeclaration(secondStarted.state, correctSubmission(secondStarted.state, 2_001));
    expect(second.result).toMatchObject({ kind: "CORRECT", scoringTeamId: "TEAM_B" });
    expect(second.state.resolvedSetIds).toEqual(["LOW_HEARTS", "LOW_DIAMONDS"]);
    expect(second.state.scores).toEqual({ TEAM_A: 1, TEAM_B: 1 });
    expectCardConservation(second.state, 42);
    expect(getCardsInSet("LOW_HEARTS").concat(getCardsInSet("LOW_DIAMONDS"))
      .every((cardId) => !activeCardIds(second.state).includes(cardId))).toBe(true);
  });
});
