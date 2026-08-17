import { expect } from "vitest";

import { CANONICAL_DECK } from "../../src/game/cards";
import { getCardsInSet } from "../../src/game/sets";
import type { NormalPlayGameState } from "../../src/game/engine/normal-play";

/** Asserts the complete card and score conservation rules for any valid state. */
export const expectGameInvariants = (state: NormalPlayGameState): void => {
  const resolvedCards = state.resolvedSetIds.flatMap((setId) => getCardsInSet(setId));
  const activeCards = state.players.flatMap((player) => player.hand);

  for (const { id: cardId } of CANONICAL_DECK) {
    const activeOwnerCount = state.players.filter((player) => player.hand.includes(cardId)).length;
    const resolvedMembershipCount = resolvedCards.filter((resolvedCardId) => resolvedCardId === cardId).length;
    expect(activeOwnerCount + resolvedMembershipCount).toBe(1);
  }

  expect(activeCards.length + resolvedCards.length).toBe(CANONICAL_DECK.length);
  expect(new Set(activeCards).size).toBe(activeCards.length);
  expect(new Set(resolvedCards).size).toBe(resolvedCards.length);
  expect(state.scores.TEAM_A + state.scores.TEAM_B).toBe(state.resolvedSetIds.length);
};
