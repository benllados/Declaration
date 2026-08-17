import { describe, expect, it } from "vitest";

import { CANONICAL_DECK, type CardId } from "../../src/game/cards";
import { createNormalPlayState, type NormalPlayGameState } from "../../src/game/engine/normal-play";
import { getCardsInSet, getSetForCard, type SetId } from "../../src/game/sets";
import { createPlayerId, type PlayerId } from "../../src/game/types/player";
import {
  createAskFeedback,
  createAskWorkbenchView,
  createDeterministicLocalGame,
  createLocalAskAction,
  createPlayerGameView,
  DEFAULT_LOCAL_PLAYER_ID,
  LOCAL_PLAYERS,
  LOCAL_PLAYER_SETUPS,
  resolveLocalAsk,
} from "../../src/lib/local-game";

type ScenarioInput = Readonly<{
  currentTurnOwner?: PlayerId;
  specifiedHands: ReadonlyMap<PlayerId, readonly CardId[]>;
  resolvedSetIds?: readonly SetId[];
}>;

/** Builds valid state only for adapter integration tests; asks still use the real engine. */
const createScenario = ({
  currentTurnOwner = DEFAULT_LOCAL_PLAYER_ID,
  specifiedHands,
  resolvedSetIds = [],
}: ScenarioInput): NormalPlayGameState => {
  const activeCardIds = CANONICAL_DECK
    .map((card) => card.id)
    .filter((cardId) => !resolvedSetIds.includes(getSetForCard(cardId)));
  const specifiedCardIds = [...specifiedHands.values()].flat();
  const remainingCardIds = activeCardIds.filter((cardId) => !specifiedCardIds.includes(cardId));
  const remainingPlayers = LOCAL_PLAYER_SETUPS.filter((player) => !specifiedHands.has(player.id));

  if (new Set(specifiedCardIds).size !== specifiedCardIds.length || remainingPlayers.length === 0) {
    throw new Error("Test scenario must assign unique cards while leaving a player for the remainder.");
  }

  return createNormalPlayState({
    players: LOCAL_PLAYER_SETUPS.map((player) => ({
      ...player,
      hand: specifiedHands.get(player.id) ?? remainingCardIds.filter(
        (_, index) => remainingPlayers[index % remainingPlayers.length]?.id === player.id,
      ),
    })),
    currentTurnOwner,
    resolvedSetIds,
    scores: { TEAM_A: resolvedSetIds.length, TEAM_B: 0 },
  });
};

const successfulAskState = () => createScenario({
  specifiedHands: new Map([
    [LOCAL_PLAYERS.avery, ["3H"]],
    [LOCAL_PLAYERS.maya, ["2H"]],
  ]),
});

describe("Build 10 local gameplay integration", () => {
  it("initializes a deterministic six-player game through the real setup and dealing engine", () => {
    const first = createDeterministicLocalGame();
    const second = createDeterministicLocalGame();

    expect(first.players).toHaveLength(6);
    expect(first.players.map((player) => player.hand)).toEqual(second.players.map((player) => player.hand));
    expect(first.players.every((player) => player.hand.length === 9)).toBe(true);
    expect(first.currentTurnOwner).toBe(DEFAULT_LOCAL_PLAYER_ID);
  });

  it("creates a player-scoped view with only the local hand and public card counts", () => {
    const state = successfulAskState();
    const view = createPlayerGameView(state, DEFAULT_LOCAL_PLAYER_ID);

    expect(view.visibleHand).toEqual(["3H"]);
    expect(view.visiblePlayers).toHaveLength(5);
    expect(view.visiblePlayers.map((player) => player.cardCount)).toEqual(
      state.players.filter((player) => player.id !== DEFAULT_LOCAL_PLAYER_ID).map((player) => player.hand.length),
    );
    expect(JSON.stringify(view)).not.toContain("2H");
    expect(JSON.stringify(view)).not.toContain("ownershipSnapshot");
  });

  it("reports the authoritative turn owner and disables asking for a non-turn perspective", () => {
    const state = successfulAskState();
    const mayaView = createPlayerGameView(state, LOCAL_PLAYERS.maya);
    const averyView = createPlayerGameView(state, DEFAULT_LOCAL_PLAYER_ID);

    expect(averyView.currentTurnOwner).toMatchObject({ id: DEFAULT_LOCAL_PLAYER_ID, isLocal: true });
    expect(averyView.canAsk).toBe(true);
    expect(mayaView.currentTurnOwner).toMatchObject({ id: DEFAULT_LOCAL_PLAYER_ID, isLocal: false });
    expect(mayaView.canAsk).toBe(false);
  });

  it("opens the canonical set for a selected hand card and marks in-hand cards unavailable", () => {
    const view = createPlayerGameView(successfulAskState(), DEFAULT_LOCAL_PLAYER_ID);
    const workbench = createAskWorkbenchView(view, getSetForCard("3H"));

    expect(workbench.setId).toBe("LOW_HEARTS");
    expect(workbench.cards.map((card) => card.cardId)).toEqual(getCardsInSet("LOW_HEARTS"));
    expect(workbench.cards.find((card) => card.cardId === "3H")).toMatchObject({
      isInHand: true,
      isRequestable: false,
    });
    expect(workbench.cards.find((card) => card.cardId === "2H")).toMatchObject({
      isInHand: false,
      isRequestable: true,
    });
  });

  it("creates the exact engine AskAction from the local selection", () => {
    expect(createLocalAskAction(DEFAULT_LOCAL_PLAYER_ID, LOCAL_PLAYERS.maya, "2H")).toEqual({
      asker: DEFAULT_LOCAL_PLAYER_ID,
      target: LOCAL_PLAYERS.maya,
      requestedCard: "2H",
    });
  });

  it("uses the returned SUCCESS state to update the local hand and preserve the turn", () => {
    const state = successfulAskState();
    const resolution = resolveLocalAsk(
      state,
      createLocalAskAction(DEFAULT_LOCAL_PLAYER_ID, LOCAL_PLAYERS.maya, "2H"),
    );
    const nextView = createPlayerGameView(resolution.state, DEFAULT_LOCAL_PLAYER_ID);

    expect(resolution.result.kind).toBe("SUCCESS");
    expect(state.players.find((player) => player.id === DEFAULT_LOCAL_PLAYER_ID)?.hand).toEqual(["3H"]);
    expect(nextView.visibleHand).toEqual(["3H", "2H"]);
    expect(nextView.currentTurnOwner.id).toBe(DEFAULT_LOCAL_PLAYER_ID);
    expect(createAskFeedback(nextView, resolution.result)).toMatchObject({
      tone: "success",
      title: "Maya had it!",
      cardId: "2H",
    });
  });

  it("keeps the turn after consecutive engine-backed successful asks", () => {
    const state = createScenario({
      specifiedHands: new Map([
        [LOCAL_PLAYERS.avery, ["3H"]],
        [LOCAL_PLAYERS.maya, ["2H"]],
        [LOCAL_PLAYERS.eli, ["4H"]],
      ]),
    });
    const first = resolveLocalAsk(state, createLocalAskAction(DEFAULT_LOCAL_PLAYER_ID, LOCAL_PLAYERS.maya, "2H"));
    const second = resolveLocalAsk(first.state, createLocalAskAction(DEFAULT_LOCAL_PLAYER_ID, LOCAL_PLAYERS.eli, "4H"));

    expect(first.result.kind).toBe("SUCCESS");
    expect(second.result.kind).toBe("SUCCESS");
    expect(second.state.currentTurnOwner).toBe(DEFAULT_LOCAL_PLAYER_ID);
    expect(createPlayerGameView(second.state, DEFAULT_LOCAL_PLAYER_ID).visibleHand).toEqual(["3H", "2H", "4H"]);
  });

  it("uses the returned UNSUCCESSFUL state to hand the turn to the asked player", () => {
    const state = createScenario({
      specifiedHands: new Map([
        [LOCAL_PLAYERS.avery, ["3H"]],
        [LOCAL_PLAYERS.maya, ["4C"]],
      ]),
    });
    const resolution = resolveLocalAsk(
      state,
      createLocalAskAction(DEFAULT_LOCAL_PLAYER_ID, LOCAL_PLAYERS.maya, "2H"),
    );
    const nextView = createPlayerGameView(resolution.state, DEFAULT_LOCAL_PLAYER_ID);

    expect(resolution.result.kind).toBe("UNSUCCESSFUL");
    expect(nextView.visibleHand).toEqual(["3H"]);
    expect(nextView.currentTurnOwner.id).toBe(LOCAL_PLAYERS.maya);
    expect(nextView.canAsk).toBe(false);
    expect(createAskFeedback(nextView, resolution.result)).toMatchObject({
      tone: "quiet",
      title: "Maya doesn’t have it.",
    });
  });

  it("renders illegal results as a human-readable recovery message without leaking engine codes", () => {
    const state = successfulAskState();
    const resolution = resolveLocalAsk(
      state,
      createLocalAskAction(LOCAL_PLAYERS.jules, LOCAL_PLAYERS.maya, "2H"),
    );
    const feedback = createAskFeedback(
      createPlayerGameView(resolution.state, DEFAULT_LOCAL_PLAYER_ID),
      resolution.result,
    );

    expect(resolution.result.kind).toBe("ILLEGAL");
    expect(feedback).toMatchObject({ tone: "warning", title: "That turn has already moved on." });
    expect(JSON.stringify(feedback)).not.toContain("NOT_TURN_OWNER");
  });

  it("handles invalid actions without changing the authoritative state", () => {
    const state = successfulAskState();
    const resolution = resolveLocalAsk(
      state,
      createLocalAskAction(DEFAULT_LOCAL_PLAYER_ID, createPlayerId("not-a-player"), "2H"),
    );

    expect(resolution.result.kind).toBe("INVALID");
    expect(resolution.state).toBe(state);
    expect(createAskFeedback(createPlayerGameView(state, DEFAULT_LOCAL_PLAYER_ID), resolution.result).title)
      .toBe("That action couldn’t be completed.");
  });

  it("reflects engine scores and prevents cards in resolved sets from becoming requests", () => {
    const state = createScenario({
      specifiedHands: new Map([
        [LOCAL_PLAYERS.avery, ["8S"]],
        [LOCAL_PLAYERS.maya, ["4C"]],
      ]),
      resolvedSetIds: ["LOW_HEARTS"],
    });
    const view = createPlayerGameView(state, DEFAULT_LOCAL_PLAYER_ID);
    const resolvedWorkbench = createAskWorkbenchView(view, "LOW_HEARTS");

    expect(view.teamScore).toBe(1);
    expect(view.opponentScore).toBe(0);
    expect(resolvedWorkbench.isResolved).toBe(true);
    expect(resolvedWorkbench.cards.every((card) => card.isRequestable === false)).toBe(true);
  });

  it("restarts the deterministic local harness to its exact initial state", () => {
    const initial = createDeterministicLocalGame();
    const changed = resolveLocalAsk(
      successfulAskState(),
      createLocalAskAction(DEFAULT_LOCAL_PLAYER_ID, LOCAL_PLAYERS.maya, "2H"),
    ).state;
    const restarted = createDeterministicLocalGame();

    expect(changed).not.toEqual(initial);
    expect(restarted).toEqual(initial);
  });
});
