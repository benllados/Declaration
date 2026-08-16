import { describe, expect, it } from "vitest";

import { CANONICAL_DECK, type CardId } from "../../src/game/cards";
import {
  resolveAsk,
  validateAsk,
  type AskAction,
  type AskIllegalReason,
} from "../../src/game/engine/asking";
import { createNormalPlayState, type NormalPlayGameState } from "../../src/game/engine/normal-play";
import { initializeNormalPlayGame } from "../../src/game/engine/setup";
import { getCardOwner } from "../../src/game/hands";
import { getSetForCard, type SetId } from "../../src/game/sets";
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
  normalAskingAllowed?: boolean;
}>;

/**
 * Creates a valid complete authoritative state. Explicit hands receive their
 * listed cards and every remaining active card goes to one unspecified player.
 */
const createState = ({
  currentTurnOwner = ids.one,
  hands = {},
  resolvedSetIds = [],
  normalAskingAllowed = true,
}: StateOptions = {}): NormalPlayGameState => {
  const initialState = initializeNormalPlayGame({ players, initialTurnOwner: currentTurnOwner }, () => 0);
  const activeCards = CANONICAL_DECK
    .map((card) => card.id)
    .filter((cardId) => !resolvedSetIds.includes(getSetForCard(cardId)));
  const explicitHandKeys = Object.keys(hands) as (keyof typeof ids)[];
  const assignedCards = explicitHandKeys.flatMap((key) => hands[key] ?? []);
  const fallbackKey = (Object.keys(ids) as (keyof typeof ids)[]).find(
    (key) => !explicitHandKeys.includes(key),
  );

  if (!fallbackKey) throw new Error("The test state requires one player to receive remaining cards.");
  if (new Set(assignedCards).size !== assignedCards.length) throw new Error("Test cards must be unique.");

  const remainingCards = activeCards.filter((cardId) => !assignedCards.includes(cardId));
  return createNormalPlayState({
    players: initialState.players.map((player) => {
      const key = (Object.keys(ids) as (keyof typeof ids)[]).find((candidate) => ids[candidate] === player.id)!;
      return {
        ...player,
        hand: hands[key] ?? (key === fallbackKey ? remainingCards : []),
      };
    }),
    currentTurnOwner,
    resolvedSetIds,
    normalAskingAllowed,
  });
};

const ask = (asker: PlayerId, target: PlayerId, requestedCard: CardId): AskAction => ({
  asker,
  target,
  requestedCard,
});

const handSnapshot = (state: NormalPlayGameState) =>
  state.players.map((player) => ({ id: player.id, hand: [...player.hand] }));

const activeCardIds = (state: NormalPlayGameState): readonly CardId[] =>
  state.players.flatMap((player) => player.hand);

const expectConservedCards = (state: NormalPlayGameState, expectedCount = 54): void => {
  const cards = activeCardIds(state);
  expect(cards).toHaveLength(expectedCount);
  expect(new Set(cards).size).toBe(cards.length);
};

describe("normal-play setup", () => {
  it("requires the caller to select a real initial turn owner", () => {
    const game = initializeNormalPlayGame({ players, initialTurnOwner: ids.four }, () => 0);
    expect(game.currentTurnOwner).toBe(ids.four);
    expect(game.resolvedSetIds).toEqual([]);
    expect(game.normalAskingAllowed).toBe(true);

    expect(() => initializeNormalPlayGame({
      players,
      initialTurnOwner: createPlayerId("not-in-game"),
    })).toThrow("turn owner");
  });
});

describe("ask legality", () => {
  it("permits the current turn owner to make an otherwise valid ask", () => {
    const state = createState({
      hands: { one: ["3H"], four: ["2H"] },
    });

    expect(validateAsk(state, ask(ids.one, ids.four, "2H"))).toEqual({ status: "LEGAL" });
  });

  it("rejects an ask from a non-turn player", () => {
    const state = createState({
      currentTurnOwner: ids.two,
      hands: { one: ["3H"], four: ["2H"] },
    });

    expect(validateAsk(state, ask(ids.one, ids.four, "2H"))).toEqual({
      status: "ILLEGAL",
      reason: "NOT_TURN_OWNER",
    });
  });

  it("rejects teammate and self targets separately", () => {
    const state = createState({ hands: { one: ["3H"], two: ["2H"] } });

    expect(validateAsk(state, ask(ids.one, ids.two, "2H"))).toEqual({
      status: "ILLEGAL",
      reason: "TARGET_IS_TEAMMATE",
    });
    expect(validateAsk(state, ask(ids.one, ids.one, "2H"))).toEqual({
      status: "ILLEGAL",
      reason: "TARGET_IS_SELF",
    });
  });

  it("rejects an opponent with no cards", () => {
    const state = createState({ hands: { one: ["3H"], four: [] } });

    expect(validateAsk(state, ask(ids.one, ids.four, "2H"))).toEqual({
      status: "ILLEGAL",
      reason: "TARGET_HAS_NO_CARDS",
    });
  });

  it("rejects asking for a card already in the asker's hand", () => {
    const state = createState({ hands: { one: ["3H", "2H"], four: ["4C"] } });

    expect(validateAsk(state, ask(ids.one, ids.four, "2H"))).toEqual({
      status: "ILLEGAL",
      reason: "REQUESTED_CARD_ALREADY_OWNED",
    });
  });

  it("rejects a card from a set the asker does not possess", () => {
    const state = createState({ hands: { one: ["3H"], four: ["QC"] } });

    expect(validateAsk(state, ask(ids.one, ids.four, "QC"))).toEqual({
      status: "ILLEGAL",
      reason: "NO_CARD_FROM_REQUESTED_SET",
    });
  });

  it("does not let a low card establish possession of its suit's high set", () => {
    const state = createState({ hands: { one: ["3H"], four: ["QH"] } });

    expect(validateAsk(state, ask(ids.one, ids.four, "QH"))).toEqual({
      status: "ILLEGAL",
      reason: "NO_CARD_FROM_REQUESTED_SET",
    });
  });

  it("does not let a high card establish possession of its suit's low set", () => {
    const state = createState({ hands: { one: ["QH"], four: ["3H"] } });

    expect(validateAsk(state, ask(ids.one, ids.four, "3H"))).toEqual({
      status: "ILLEGAL",
      reason: "NO_CARD_FROM_REQUESTED_SET",
    });
  });

  it("allows a missing card from a set the asker does possess", () => {
    const state = createState({ hands: { one: ["3H"], four: ["4C"] } });

    expect(validateAsk(state, ask(ids.one, ids.four, "2H"))).toEqual({ status: "LEGAL" });
  });

  it("recognizes each joker as possession of EIGHTS_JOKERS", () => {
    const redJokerState = createState({ hands: { one: ["RED_JOKER"], four: ["8H"] } });
    const blackJokerState = createState({ hands: { one: ["BLACK_JOKER"], four: ["8H"] } });

    expect(validateAsk(redJokerState, ask(ids.one, ids.four, "8H"))).toEqual({ status: "LEGAL" });
    expect(validateAsk(blackJokerState, ask(ids.one, ids.four, "8H"))).toEqual({ status: "LEGAL" });
  });

  it("lets a suited eight request either joker and other suited eights", () => {
    const state = createState({ hands: { one: ["8S"], four: ["8H"] } });

    expect(validateAsk(state, ask(ids.one, ids.four, "RED_JOKER"))).toEqual({ status: "LEGAL" });
    expect(validateAsk(state, ask(ids.one, ids.four, "BLACK_JOKER"))).toEqual({ status: "LEGAL" });
    expect(validateAsk(state, ask(ids.one, ids.four, "8H"))).toEqual({ status: "LEGAL" });
  });

  it("rejects cards from resolved sets", () => {
    const state = createState({
      hands: { one: ["8S"], four: ["4C"] },
      resolvedSetIds: ["LOW_HEARTS"],
    });

    expect(validateAsk(state, ask(ids.one, ids.four, "2H"))).toEqual({
      status: "ILLEGAL",
      reason: "SET_ALREADY_RESOLVED",
    });
  });

  it("rejects asking when normal asking is not available", () => {
    const state = createState({
      hands: { one: ["3H"], four: ["2H"] },
      normalAskingAllowed: false,
    });

    expect(validateAsk(state, ask(ids.one, ids.four, "2H"))).toEqual({
      status: "ILLEGAL",
      reason: "NORMAL_ASKING_NOT_ALLOWED",
    });
  });
});

describe("successful asks", () => {
  it("transfers exactly the requested card, preserves turn ownership, and does not mutate input", () => {
    const state = createState({ hands: { one: ["3H"], four: ["2H", "4C"] } });
    const beforeHands = handSnapshot(state);
    const resolution = resolveAsk(state, ask(ids.one, ids.four, "2H"));

    expect(resolution.result).toEqual({
      kind: "SUCCESS",
      asker: ids.one,
      target: ids.four,
      requestedCard: "2H",
      resultingTurnOwner: ids.one,
    });
    expect(resolution.state.currentTurnOwner).toBe(ids.one);
    expect(resolution.state.players.find((player) => player.id === ids.one)?.hand).toEqual(["3H", "2H"]);
    expect(resolution.state.players.find((player) => player.id === ids.four)?.hand).toEqual(["4C"]);
    expect(resolution.state.players.filter((player) => ![ids.one, ids.four].includes(player.id)))
      .toEqual(state.players.filter((player) => ![ids.one, ids.four].includes(player.id)));
    expect(getCardOwner(resolution.state.players, "2H")?.id).toBe(ids.one);
    expect(handSnapshot(state)).toEqual(beforeHands);
    expectConservedCards(resolution.state);
  });
});

describe("unsuccessful asks", () => {
  it("changes no hands, gives the target the turn, and keeps hidden cards out of the result", () => {
    const state = createState({ hands: { one: ["3H"], four: ["4C"] } });
    const beforeHands = handSnapshot(state);
    const resolution = resolveAsk(state, ask(ids.one, ids.four, "2H"));

    expect(resolution.result).toEqual({
      kind: "UNSUCCESSFUL",
      asker: ids.one,
      target: ids.four,
      requestedCard: "2H",
      resultingTurnOwner: ids.four,
    });
    expect(handSnapshot(resolution.state)).toEqual(beforeHands);
    expect(resolution.state.currentTurnOwner).toBe(ids.four);
    expect(handSnapshot(state)).toEqual(beforeHands);
    expect(JSON.stringify(resolution.result)).not.toContain("4C");
    expectConservedCards(resolution.state);
  });
});

describe("illegal-ask penalties", () => {
  const cases: readonly Readonly<{
    name: string;
    state: NormalPlayGameState;
    action: AskAction;
    reason: AskIllegalReason;
  }>[] = [
    {
      name: "non-turn asker",
      state: createState({
        currentTurnOwner: ids.two,
        hands: { one: ["3H"], four: ["2H"] },
      }),
      action: ask(ids.one, ids.four, "2H"),
      reason: "NOT_TURN_OWNER",
    },
    {
      name: "teammate target",
      state: createState({ hands: { one: ["3H"], two: ["2H"] } }),
      action: ask(ids.one, ids.two, "2H"),
      reason: "TARGET_IS_TEAMMATE",
    },
    {
      name: "self target",
      state: createState({ hands: { one: ["3H"] } }),
      action: ask(ids.one, ids.one, "2H"),
      reason: "TARGET_IS_SELF",
    },
    {
      name: "empty target",
      state: createState({ hands: { one: ["3H"], four: [] } }),
      action: ask(ids.one, ids.four, "2H"),
      reason: "TARGET_HAS_NO_CARDS",
    },
    {
      name: "already-owned requested card",
      state: createState({ hands: { one: ["3H", "2H"], four: ["4C"] } }),
      action: ask(ids.one, ids.four, "2H"),
      reason: "REQUESTED_CARD_ALREADY_OWNED",
    },
    {
      name: "no card from requested set",
      state: createState({ hands: { one: ["3H"], four: ["QH"] } }),
      action: ask(ids.one, ids.four, "QH"),
      reason: "NO_CARD_FROM_REQUESTED_SET",
    },
    {
      name: "resolved set",
      state: createState({
        hands: { one: ["8S"], four: ["4C"] },
        resolvedSetIds: ["LOW_HEARTS"],
      }),
      action: ask(ids.one, ids.four, "2H"),
      reason: "SET_ALREADY_RESOLVED",
    },
  ];

  it.each(cases)("transfers no cards and gives the target the turn for $name", ({ state, action, reason }) => {
    const beforeHands = handSnapshot(state);
    const resolution = resolveAsk(state, action);

    expect(resolution.result.kind).toBe("ILLEGAL");
    if (resolution.result.kind === "ILLEGAL") {
      expect(resolution.result.reason).toBe(reason);
      expect(resolution.result.resultingTurnOwner).toBe(action.target);
    }
    expect(handSnapshot(resolution.state)).toEqual(beforeHands);
    expect(resolution.state.currentTurnOwner).toBe(action.target);
    expect(handSnapshot(state)).toEqual(beforeHands);
    expectConservedCards(resolution.state, state.resolvedSetIds.length === 0 ? 54 : 48);
  });

  it("rejects structurally invalid player ids without changing state or turn ownership", () => {
    const state = createState({ hands: { one: ["3H"], four: ["2H"] } });
    const beforeHands = handSnapshot(state);

    for (const action of [
      ask(createPlayerId("missing-asker"), ids.four, "2H"),
      ask(ids.one, createPlayerId("missing-target"), "2H"),
    ]) {
      const resolution = resolveAsk(state, action);
      expect(resolution.result.kind).toBe("INVALID");
      expect(resolution.state).toBe(state);
      expect(resolution.state.currentTurnOwner).toBe(ids.one);
      expect(handSnapshot(resolution.state)).toEqual(beforeHands);
    }
  });
});

describe("normal-play turn sequences", () => {
  it("allows consecutive successful asks without a fixed limit", () => {
    const state = createState({
      hands: { one: ["3H"], four: ["2H"], five: ["4H"] },
    });
    const first = resolveAsk(state, ask(ids.one, ids.four, "2H"));
    const second = resolveAsk(first.state, ask(ids.one, ids.five, "4H"));

    expect(first.result.kind).toBe("SUCCESS");
    expect(first.state.currentTurnOwner).toBe(ids.one);
    expect(validateAsk(first.state, ask(ids.one, ids.five, "4H"))).toEqual({ status: "LEGAL" });
    expect(second.result.kind).toBe("SUCCESS");
    expect(second.state.currentTurnOwner).toBe(ids.one);
    expect(getCardOwner(second.state.players, "4H")?.id).toBe(ids.one);
    expectConservedCards(second.state);
  });

  it("hands off turn ownership after a legal failure so the target can ask", () => {
    const state = createState({
      hands: { one: ["3H"], two: ["5C"], four: ["4C"] },
    });
    const failedAsk = resolveAsk(state, ask(ids.one, ids.four, "2H"));
    const followUp = resolveAsk(failedAsk.state, ask(ids.four, ids.two, "5C"));

    expect(failedAsk.result.kind).toBe("UNSUCCESSFUL");
    expect(failedAsk.state.currentTurnOwner).toBe(ids.four);
    expect(validateAsk(failedAsk.state, ask(ids.four, ids.two, "5C"))).toEqual({ status: "LEGAL" });
    expect(followUp.result.kind).toBe("SUCCESS");
    expect(followUp.state.currentTurnOwner).toBe(ids.four);
    expect(getCardOwner(followUp.state.players, "5C")?.id).toBe(ids.four);
    expectConservedCards(followUp.state);
  });

  it("conserves cards across successful and unsuccessful actions", () => {
    let state = createState({
      hands: { one: ["3H"], two: ["5C"], four: ["2H"], five: ["4C"] },
    });

    const sequence: readonly Readonly<{
      action: AskAction;
      expectedTurnOwner: PlayerId;
      requestedCard: CardId;
      expectedCardOwner: PlayerId;
    }>[] = [
      {
        action: ask(ids.one, ids.four, "2H"),
        expectedTurnOwner: ids.one,
        requestedCard: "2H",
        expectedCardOwner: ids.one,
      },
      {
        action: ask(ids.one, ids.five, "4H"),
        expectedTurnOwner: ids.five,
        requestedCard: "4H",
        expectedCardOwner: ids.three,
      },
      {
        action: ask(ids.five, ids.two, "5C"),
        expectedTurnOwner: ids.five,
        requestedCard: "5C",
        expectedCardOwner: ids.five,
      },
    ];

    for (const step of sequence) {
      state = resolveAsk(state, step.action).state;
      expect(state.currentTurnOwner).toBe(step.expectedTurnOwner);
      expect(getCardOwner(state.players, step.requestedCard)?.id).toBe(step.expectedCardOwner);
      expectConservedCards(state);
    }
  });
});
