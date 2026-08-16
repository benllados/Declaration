export const SUITS = ["HEARTS", "DIAMONDS", "CLUBS", "SPADES"] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
] as const;
export type Rank = (typeof RANKS)[number];

type SuitCode = "H" | "D" | "C" | "S";
type StandardCardId = `${Rank}${SuitCode}`;
export type CardId = StandardCardId | "RED_JOKER" | "BLACK_JOKER";

export type StandardCard = Readonly<{
  id: StandardCardId;
  suit: Suit;
  rank: Rank;
  kind: "STANDARD";
}>;

export type JokerCard = Readonly<{
  id: "RED_JOKER" | "BLACK_JOKER";
  color: "RED" | "BLACK";
  kind: "JOKER";
}>;

export type Card = StandardCard | JokerCard;
