import type { CardId } from "./cards";

export const SET_IDS = [
  "LOW_HEARTS",
  "LOW_DIAMONDS",
  "LOW_CLUBS",
  "LOW_SPADES",
  "HIGH_HEARTS",
  "HIGH_DIAMONDS",
  "HIGH_CLUBS",
  "HIGH_SPADES",
  "EIGHTS_JOKERS",
] as const;
export type SetId = (typeof SET_IDS)[number];

const low = (suit: "H" | "D" | "C" | "S"): readonly CardId[] =>
  Object.freeze([`2${suit}`, `3${suit}`, `4${suit}`, `5${suit}`, `6${suit}`, `7${suit}`] as const);

const high = (suit: "H" | "D" | "C" | "S"): readonly CardId[] =>
  Object.freeze([`9${suit}`, `10${suit}`, `J${suit}`, `Q${suit}`, `K${suit}`, `A${suit}`] as const);

export const CARDS_IN_SET: Readonly<Record<SetId, readonly CardId[]>> = Object.freeze({
  LOW_HEARTS: low("H"),
  LOW_DIAMONDS: low("D"),
  LOW_CLUBS: low("C"),
  LOW_SPADES: low("S"),
  HIGH_HEARTS: high("H"),
  HIGH_DIAMONDS: high("D"),
  HIGH_CLUBS: high("C"),
  HIGH_SPADES: high("S"),
  EIGHTS_JOKERS: Object.freeze(
    ["8H", "8D", "8C", "8S", "RED_JOKER", "BLACK_JOKER"] as const,
  ),
});

const setByCard = Object.fromEntries(
  SET_IDS.flatMap((setId) => CARDS_IN_SET[setId].map((cardId) => [cardId, setId])),
) as Record<CardId, SetId>;

export const SET_BY_CARD: Readonly<Record<CardId, SetId>> = Object.freeze(setByCard);

export const getSetForCard = (cardId: CardId): SetId => SET_BY_CARD[cardId];

export const getCardsInSet = (setId: SetId): readonly CardId[] => CARDS_IN_SET[setId];

export const areCardsInSameSet = (firstCardId: CardId, secondCardId: CardId): boolean =>
  getSetForCard(firstCardId) === getSetForCard(secondCardId);
