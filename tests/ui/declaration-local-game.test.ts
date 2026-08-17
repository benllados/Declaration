import { describe, expect, it } from "vitest";

import { CANONICAL_DECK } from "../../src/game/cards";
import { createNormalPlayState, type NormalPlayGameState } from "../../src/game/engine/normal-play";
import { getCardsInSet, getSetForCard, SET_IDS } from "../../src/game/sets";
import {
  createDeterministicLocalGame,
  createLocalGameClock,
  createPlayerGameView,
  DEFAULT_LOCAL_PLAYER_ID,
  LOCAL_PLAYERS,
  LOCAL_PLAYER_SETUPS,
  resolveLocalDeclarationTimeout,
  selectLocalBlindDeclarer,
  startLocalDeclaration,
  submitLocalDeclaration,
} from "../../src/lib/local-game";

const correctAssignments = (state: NormalPlayGameState) =>
  state.activeDeclaration!.ownershipSnapshot.map(({ cardId, ownerId }) => ({ cardId, playerId: ownerId }));

const createBlindState = (resolvedSetIds: readonly (typeof SET_IDS)[number][]): NormalPlayGameState => {
  const activeCards = CANONICAL_DECK
    .map((card) => card.id)
    .filter((cardId) => !resolvedSetIds.includes(getSetForCard(cardId)));

  return createNormalPlayState({
    players: LOCAL_PLAYER_SETUPS.map((player) => ({
      ...player,
      hand: player.teamId === "TEAM_B" && player.id === LOCAL_PLAYERS.maya ? activeCards : [],
    })),
    currentTurnOwner: DEFAULT_LOCAL_PLAYER_ID,
    resolvedSetIds,
    scores: { TEAM_A: resolvedSetIds.length, TEAM_B: 0 },
    phase: "BLIND_DECLARATION",
    blindDeclarationTeamId: "TEAM_B",
  });
};

/** The selected set belongs entirely to Avery's team, so a correct engine submission is possible. */
const createDeclarationReadyState = (): NormalPlayGameState => {
  const selectedCards = getCardsInSet("LOW_HEARTS");
  const otherCards = CANONICAL_DECK.map((card) => card.id).filter((cardId) => !selectedCards.includes(cardId));

  return createNormalPlayState({
    players: LOCAL_PLAYER_SETUPS.map((player) => ({
      ...player,
      hand: player.id === LOCAL_PLAYERS.avery
        ? [selectedCards[0]]
        : player.id === LOCAL_PLAYERS.jules
          ? selectedCards.slice(1, 3)
          : player.id === LOCAL_PLAYERS.noa
            ? selectedCards.slice(3)
            : player.id === LOCAL_PLAYERS.maya
              ? otherCards
              : [],
    })),
    currentTurnOwner: DEFAULT_LOCAL_PLAYER_ID,
    scores: { TEAM_A: 0, TEAM_B: 0 },
  });
};

describe("Build 11 Declaration local integration", () => {
  it("projects only the sanitized public Declaration summary and local hand", () => {
    const initial = createDeterministicLocalGame();
    const started = startLocalDeclaration(
      initial,
      DEFAULT_LOCAL_PLAYER_ID,
      "LOW_HEARTS",
      createLocalGameClock(() => 100),
    );
    const hiddenOpponentCard = initial.players.find((player) => player.id === LOCAL_PLAYERS.maya)!.hand[0];

    expect(started.result).toMatchObject({
      kind: "STARTED",
      declarerId: DEFAULT_LOCAL_PLAYER_ID,
      selectedSetId: "LOW_HEARTS",
      deadline: 190,
    });
    expect(started.view.activeDeclaration).toEqual({
      declarerId: DEFAULT_LOCAL_PLAYER_ID,
      declarerTeamId: "TEAM_A",
      mode: "NORMAL",
      selectedSetId: "LOW_HEARTS",
      startedAt: 100,
      deadline: 190,
    });
    expect(JSON.stringify(started.view)).not.toContain("ownershipSnapshot");
    expect(JSON.stringify(started.view)).not.toContain(hiddenOpponentCard);
    expect(JSON.stringify(started.view)).not.toContain("interruptedTurnOwner");
  });

  it("derives unresolved sets in the view after an engine-backed resolution", () => {
    const started = startLocalDeclaration(
      createDeclarationReadyState(),
      DEFAULT_LOCAL_PLAYER_ID,
      "LOW_HEARTS",
      createLocalGameClock(() => 100),
    );
    const resolved = submitLocalDeclaration(
      started.state,
      DEFAULT_LOCAL_PLAYER_ID,
      correctAssignments(started.state),
      createLocalGameClock(() => 150),
    );

    expect(resolved.result.kind).toBe("CORRECT");
    expect(resolved.view.resolvedSetIds).toContain("LOW_HEARTS");
    expect(resolved.view.unresolvedSetIds).not.toContain("LOW_HEARTS");
    expect(resolved.view.activeDeclaration).toBeNull();
  });

  it("keeps a timely malformed submission active so a corrected submission can resolve", () => {
    const started = startLocalDeclaration(
      createDeclarationReadyState(),
      DEFAULT_LOCAL_PLAYER_ID,
      "LOW_HEARTS",
      createLocalGameClock(() => 100),
    );
    const malformed = submitLocalDeclaration(
      started.state,
      DEFAULT_LOCAL_PLAYER_ID,
      correctAssignments(started.state).slice(0, 5),
      createLocalGameClock(() => 150),
    );
    const corrected = submitLocalDeclaration(
      malformed.state,
      DEFAULT_LOCAL_PLAYER_ID,
      correctAssignments(malformed.state),
      createLocalGameClock(() => 151),
    );

    expect(malformed.result).toEqual({ kind: "INVALID_SUBMISSION", reason: "ASSIGNMENT_COUNT_MISMATCH" });
    expect(malformed.state).toBe(started.state);
    expect(malformed.view.activeDeclaration).not.toBeNull();
    expect(corrected.result.kind).toBe("CORRECT");
  });

  it("lets the engine decide timeout eligibility and accepts a submission at the exact deadline", () => {
    const started = startLocalDeclaration(
      createDeclarationReadyState(),
      DEFAULT_LOCAL_PLAYER_ID,
      "LOW_HEARTS",
      createLocalGameClock(() => 100),
    );
    const tooEarly = resolveLocalDeclarationTimeout(
      started.state,
      DEFAULT_LOCAL_PLAYER_ID,
      createLocalGameClock(() => 190),
    );
    const exactDeadline = submitLocalDeclaration(
      tooEarly.state,
      DEFAULT_LOCAL_PLAYER_ID,
      correctAssignments(tooEarly.state),
      createLocalGameClock(() => 190),
    );

    expect(tooEarly.result).toEqual({ kind: "TIMEOUT_NOT_REACHED", deadline: 190 });
    expect(tooEarly.state).toBe(started.state);
    expect(exactDeadline.result.kind).toBe("CORRECT");
  });

  it("delegates an elapsed timeout to the engine without the UI changing cards or scores", () => {
    const started = startLocalDeclaration(
      createDeterministicLocalGame(),
      DEFAULT_LOCAL_PLAYER_ID,
      "LOW_HEARTS",
      createLocalGameClock(() => 100),
    );
    const timedOut = resolveLocalDeclarationTimeout(
      started.state,
      DEFAULT_LOCAL_PLAYER_ID,
      createLocalGameClock(() => 190.001),
    );

    expect(timedOut.result.kind).toBe("TIMED_OUT");
    expect(timedOut.view.resolvedSetIds).toContain("LOW_HEARTS");
    expect(timedOut.view.activeDeclaration).toBeNull();
  });

  it("delegates Blind Declarer selection and allows a zero-card teammate", () => {
    const state = createBlindState(SET_IDS.slice(0, 7));
    const selected = selectLocalBlindDeclarer(state, LOCAL_PLAYERS.maya, LOCAL_PLAYERS.eli);

    expect(state.players.find((player) => player.id === LOCAL_PLAYERS.eli)?.hand).toEqual([]);
    expect(selected.result).toEqual({
      kind: "BLIND_DECLARER_SELECTED",
      blindDeclarerId: LOCAL_PLAYERS.eli,
      blindDeclarationTeamId: "TEAM_B",
    });
    expect(selected.view.blindDeclarerId).toBe(LOCAL_PLAYERS.eli);
  });

  it("preserves the locked Blind Declarer through a non-final Blind resolution", () => {
    const selected = selectLocalBlindDeclarer(
      createBlindState(SET_IDS.slice(0, 7)),
      LOCAL_PLAYERS.maya,
      LOCAL_PLAYERS.eli,
    );
    const started = startLocalDeclaration(
      selected.state,
      LOCAL_PLAYERS.eli,
      "HIGH_SPADES",
      createLocalGameClock(() => 100),
    );
    const resolved = submitLocalDeclaration(
      started.state,
      LOCAL_PLAYERS.eli,
      correctAssignments(started.state),
      createLocalGameClock(() => 110),
    );

    expect(resolved.result.kind).toBe("CORRECT");
    expect(resolved.view.phase).toBe("BLIND_DECLARATION");
    expect(resolved.view.blindDeclarerId).toBe(LOCAL_PLAYERS.eli);
    expect(resolved.view.activeDeclaration).toBeNull();
  });

  it("projects the engine-supplied winner after the ninth set resolves", () => {
    const selected = selectLocalBlindDeclarer(
      createBlindState(SET_IDS.slice(0, 8)),
      LOCAL_PLAYERS.maya,
      LOCAL_PLAYERS.eli,
    );
    const lastSet = SET_IDS.find((setId) => !selected.view.resolvedSetIds.includes(setId))!;
    const started = startLocalDeclaration(
      selected.state,
      LOCAL_PLAYERS.eli,
      lastSet,
      createLocalGameClock(() => 100),
    );
    const resolved = submitLocalDeclaration(
      started.state,
      LOCAL_PLAYERS.eli,
      correctAssignments(started.state),
      createLocalGameClock(() => 110),
    );
    const projected = createPlayerGameView(resolved.state, LOCAL_PLAYERS.eli);

    expect(resolved.result.kind).toBe("CORRECT");
    expect(projected.phase).toBe("GAME_OVER");
    expect(projected.winnerTeamId).toBe("TEAM_A");
    expect(projected.visibleHand).toEqual([]);
  });
});
