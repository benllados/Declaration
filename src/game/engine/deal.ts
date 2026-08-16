import { CANONICAL_DECK, type CardId } from "../cards";
import { CARDS_PER_PLAYER_AT_INITIAL_DEAL, TOTAL_CARDS, TOTAL_PLAYERS } from "../constants/game";
import { GameDomainError } from "../errors";
import type { PlayerId } from "../types/player";

export type Random = () => number;

/** Returns a new Fisher-Yates permutation and never mutates its source. */
export const shuffle = <T>(items: readonly T[], random: Random = Math.random): T[] => {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new GameDomainError("Randomness must return a number from 0 (inclusive) to 1 (exclusive).");
    const swapIndex = Math.floor(value * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
};

export const shuffleCanonicalDeck = (random: Random = Math.random): CardId[] => shuffle(CANONICAL_DECK.map((card) => card.id), random);

/** Deals in player order, round-robin: card 1 to player 1 through card 6 to player 6. */
export const dealInitialHands = (playerIds: readonly PlayerId[], shuffledDeck: readonly CardId[]): ReadonlyMap<PlayerId, readonly CardId[]> => {
  if (playerIds.length !== TOTAL_PLAYERS || new Set(playerIds).size !== TOTAL_PLAYERS) throw new GameDomainError(`Initial dealing requires exactly ${TOTAL_PLAYERS} unique players.`);
  if (shuffledDeck.length !== TOTAL_CARDS || new Set(shuffledDeck).size !== TOTAL_CARDS) throw new GameDomainError(`Initial dealing requires exactly ${TOTAL_CARDS} unique cards.`);
  const expectedCards = new Set(CANONICAL_DECK.map((card) => card.id));
  if (!shuffledDeck.every((cardId) => expectedCards.has(cardId))) throw new GameDomainError("Initial dealing requires the canonical deck.");
  const hands = new Map<PlayerId, CardId[]>(playerIds.map((playerId) => [playerId, []]));
  shuffledDeck.forEach((cardId, index) => hands.get(playerIds[index % TOTAL_PLAYERS])?.push(cardId));
  for (const hand of hands.values()) if (hand.length !== CARDS_PER_PLAYER_AT_INITIAL_DEAL) throw new GameDomainError(`Each player must receive ${CARDS_PER_PLAYER_AT_INITIAL_DEAL} cards.`);
  return new Map([...hands].map(([playerId, hand]) => [playerId, Object.freeze(hand)]));
};
