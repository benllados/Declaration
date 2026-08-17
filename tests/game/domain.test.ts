import { describe, expect, it } from "vitest";

import {
  CANONICAL_DECK,
  CARDS_BY_ID,
  getCardById,
  isJoker,
} from "../../src/game/cards";
import {
  CARDS_PER_PLAYER_AT_INITIAL_DEAL,
  CARDS_PER_SET,
  DECLARATION_TIME_LIMIT_SECONDS,
  TEAM_SIZE,
  TOTAL_CARDS,
  TOTAL_PLAYERS,
  TOTAL_SETS,
} from "../../src/game/constants/game";
import {
  areCardsInSameSet,
  getCardsInSet,
  getSetForCard,
  SET_IDS,
} from "../../src/game/sets";
import { getCardOwner, getPlayerCardCount, getPlayerHand, playerHasCard } from "../../src/game/hands";
import { GameDomainError } from "../../src/game/errors";
import { dealInitialHands, shuffle, shuffleCanonicalDeck } from "../../src/game/engine/deal";
import { initializeGame, validateGameSetup } from "../../src/game/engine/setup";
import { createPlayerId, type PlayerSetup } from "../../src/game/types/player";

describe("Declaration constants", () => {
  it("matches the stable v1.0 game invariants", () => {
    expect({
      TOTAL_PLAYERS,
      TEAM_SIZE,
      TOTAL_CARDS,
      CARDS_PER_PLAYER_AT_INITIAL_DEAL,
      TOTAL_SETS,
      CARDS_PER_SET,
      DECLARATION_TIME_LIMIT_SECONDS,
    }).toEqual({
      TOTAL_PLAYERS: 6,
      TEAM_SIZE: 3,
      TOTAL_CARDS: 54,
      CARDS_PER_PLAYER_AT_INITIAL_DEAL: 9,
      TOTAL_SETS: 9,
      CARDS_PER_SET: 6,
      DECLARATION_TIME_LIMIT_SECONDS: 90,
    });
  });
});

describe("canonical deck", () => {
  it("contains every standard card once and both jokers", () => {
    expect(CANONICAL_DECK).toHaveLength(54);
    expect(new Set(CANONICAL_DECK.map((card) => card.id)).size).toBe(54);
    expect(CANONICAL_DECK.filter((card) => card.kind === "STANDARD")).toHaveLength(52);
    expect(CANONICAL_DECK.filter(isJoker).map((card) => card.id)).toEqual([
      "RED_JOKER",
      "BLACK_JOKER",
    ]);
  });

  it("retrieves stable card definitions by id", () => {
    expect(getCardById("QH")).toEqual({
      id: "QH",
      rank: "Q",
      suit: "HEARTS",
      kind: "STANDARD",
    });
    expect(CARDS_BY_ID.RED_JOKER).toEqual({ id: "RED_JOKER", color: "RED", kind: "JOKER" });
  });
});

describe("Declaration sets", () => {
  it("partitions every canonical card into nine six-card sets", () => {
    const memberships = SET_IDS.flatMap((setId) => getCardsInSet(setId));

    expect(SET_IDS).toHaveLength(9);
    expect(SET_IDS.every((setId) => getCardsInSet(setId).length === 6)).toBe(true);
    expect(memberships).toHaveLength(54);
    expect(new Set(memberships).size).toBe(54);
    expect(new Set(memberships)).toEqual(new Set(CANONICAL_DECK.map((card) => card.id)));
    expect(memberships.every((cardId) => getSetForCard(cardId))).toBe(true);
  });

  it.each([
    ["H", "HEARTS"],
    ["D", "DIAMONDS"],
    ["C", "CLUBS"],
    ["S", "SPADES"],
  ] as const)("defines the low and high %s sets", (suitCode, suitName) => {
    expect(getCardsInSet(`LOW_${suitName}` as (typeof SET_IDS)[number])).toEqual([
      `2${suitCode}`, `3${suitCode}`, `4${suitCode}`, `5${suitCode}`, `6${suitCode}`, `7${suitCode}`,
    ]);
    expect(getCardsInSet(`HIGH_${suitName}` as (typeof SET_IDS)[number])).toEqual([
      `9${suitCode}`, `10${suitCode}`, `J${suitCode}`, `Q${suitCode}`, `K${suitCode}`, `A${suitCode}`,
    ]);
  });

  it("groups all eights and both jokers together", () => {
    expect(getCardsInSet("EIGHTS_JOKERS")).toEqual([
      "8H", "8D", "8C", "8S", "RED_JOKER", "BLACK_JOKER",
    ]);
  });

  it("finds card memberships and compares sets", () => {
    expect(getSetForCard("3H")).toBe("LOW_HEARTS");
    expect(getSetForCard("QH")).toBe("HIGH_HEARTS");
    expect(getSetForCard("8S")).toBe("EIGHTS_JOKERS");
    expect(getSetForCard("RED_JOKER")).toBe("EIGHTS_JOKERS");
    expect(getSetForCard("BLACK_JOKER")).toBe("EIGHTS_JOKERS");
    expect(areCardsInSameSet("3H", "7H")).toBe(true);
    expect(areCardsInSameSet("8S", "RED_JOKER")).toBe(true);
    expect(areCardsInSameSet("3H", "QH")).toBe(false);
    expect(areCardsInSameSet("3H", "2S")).toBe(false);
  });
});

describe("initial game setup and dealing", () => {
  const players: readonly PlayerSetup[] = Object.freeze([
    { id: createPlayerId("player-1"), displayName: "One", teamId: "TEAM_A" },
    { id: createPlayerId("player-2"), displayName: "Two", teamId: "TEAM_A" },
    { id: createPlayerId("player-3"), displayName: "Three", teamId: "TEAM_A" },
    { id: createPlayerId("player-4"), displayName: "Four", teamId: "TEAM_B" },
    { id: createPlayerId("player-5"), displayName: "Five", teamId: "TEAM_B" },
    { id: createPlayerId("player-6"), displayName: "Six", teamId: "TEAM_B" },
  ]);

  it("creates two teams and round-robin deals every card exactly once", () => {
    const game = initializeGame({ players }, () => 0.999);
    const dealtCards = game.players.flatMap((player) => player.hand);

    expect(game.teams.map((team) => team.playerIds)).toEqual([
      [players[0].id, players[1].id, players[2].id],
      [players[3].id, players[4].id, players[5].id],
    ]);
    expect(game.scores).toEqual({ TEAM_A: 0, TEAM_B: 0 });
    expect(game.players.every((player) => player.hand.length === 9)).toBe(true);
    expect(dealtCards).toHaveLength(54);
    expect(new Set(dealtCards)).toEqual(new Set(CANONICAL_DECK.map((card) => card.id)));
    expect(game.players[0].hand).toEqual(CANONICAL_DECK.filter((_, index) => index % 6 === 0).map((card) => card.id));
  });

  it("supports deterministic, non-mutating Fisher-Yates shuffling", () => {
    const original = [1, 2, 3, 4];
    expect(shuffle(original, () => 0)).toEqual([2, 3, 4, 1]);
    expect(original).toEqual([1, 2, 3, 4]);
    expect(new Set(shuffleCanonicalDeck(() => 0))).toEqual(new Set(CANONICAL_DECK.map((card) => card.id)));
  });

  it("rejects invalid player compositions and invalid deals", () => {
    expect(() => validateGameSetup({ players: players.slice(0, 5) })).toThrow(GameDomainError);
    expect(() => validateGameSetup({ players: [...players.slice(0, 5), { ...players[5], id: players[0].id }] })).toThrow(GameDomainError);
    expect(() => validateGameSetup({ players: [...players.slice(0, 3), ...players.slice(3).map((player) => ({ ...player, teamId: "TEAM_A" as const }))] })).toThrow(GameDomainError);
    expect(() => dealInitialHands(players.map((player) => player.id), CANONICAL_DECK.slice(0, 53).map((card) => card.id))).toThrow(GameDomainError);
  });

  it("provides hand ownership helpers", () => {
    const game = initializeGame({ players }, () => 0);
    const player = game.players[0];
    const card = player.hand[0];

    expect(getPlayerHand(game.players, player.id)).toEqual(player.hand);
    expect(getPlayerCardCount(game.players, player.id)).toBe(9);
    expect(playerHasCard(game.players, player.id, card)).toBe(true);
    expect(getCardOwner(game.players, card)?.id).toBe(player.id);
  });
});
