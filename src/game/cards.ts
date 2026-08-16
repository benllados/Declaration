import {
  RANKS,
  SUITS,
  type Card,
  type CardId,
  type Rank,
  type StandardCard,
  type Suit,
} from "./types/card";

export type { Card, CardId, JokerCard, Rank, StandardCard, Suit } from "./types/card";

const SUIT_CODES: Readonly<Record<Suit, "H" | "D" | "C" | "S">> = Object.freeze({
  HEARTS: "H",
  DIAMONDS: "D",
  CLUBS: "C",
  SPADES: "S",
});

const createStandardCard = (rank: Rank, suit: Suit): StandardCard => Object.freeze({
  id: `${rank}${SUIT_CODES[suit]}`,
  rank,
  suit,
  kind: "STANDARD",
});

export const CANONICAL_DECK: readonly Card[] = Object.freeze([
  ...SUITS.flatMap((suit) => RANKS.map((rank) => createStandardCard(rank, suit))),
  Object.freeze({ id: "RED_JOKER", color: "RED", kind: "JOKER" } as const),
  Object.freeze({ id: "BLACK_JOKER", color: "BLACK", kind: "JOKER" } as const),
]);

const cardsById = Object.fromEntries(
  CANONICAL_DECK.map((card) => [card.id, card]),
) as Record<CardId, Card>;

export const CARDS_BY_ID: Readonly<Record<CardId, Card>> = Object.freeze(cardsById);

export const getCardById = (cardId: CardId): Card => CARDS_BY_ID[cardId];

export const isJoker = (card: Card): card is Extract<Card, { kind: "JOKER" }> =>
  card.kind === "JOKER";
