import { CANONICAL_DECK, getCardById, type CardId, type Rank, type Suit } from "@/game/cards";

const RANK_FILE_NAMES: Readonly<Partial<Record<Rank, string>>> = Object.freeze({
  J: "jack",
  Q: "queen",
  K: "king",
  A: "ace",
});

const SUIT_FILE_NAMES: Readonly<Record<Suit, string>> = Object.freeze({
  HEARTS: "hearts",
  DIAMONDS: "diamonds",
  CLUBS: "clubs",
  SPADES: "spades",
});

const KING_FILE_NAMES: Readonly<Record<Suit, string>> = Object.freeze({
  HEARTS: "king-hearts-v2",
  DIAMONDS: "king-diamonds-v2",
  CLUBS: "king-clubs-v2",
  SPADES: "king-spades-v2",
});

const RANK_NAMES: Readonly<Record<Rank, string>> = Object.freeze({
  2: "Two",
  3: "Three",
  4: "Four",
  5: "Five",
  6: "Six",
  7: "Seven",
  8: "Eight",
  9: "Nine",
  10: "Ten",
  J: "Jack",
  Q: "Queen",
  K: "King",
  A: "Ace",
});

const TRIMMED_CARD_DIRECTORY = "/cards/trimmed";

const getAssetForCard = (cardId: CardId): string => {
  const card = getCardById(cardId);

  if (card.kind === "JOKER") {
    return card.color === "RED"
      ? `${TRIMMED_CARD_DIRECTORY}/joker-red.webp`
      : `${TRIMMED_CARD_DIRECTORY}/joker-black.webp`;
  }

  if (card.rank === "K") return `${TRIMMED_CARD_DIRECTORY}/${KING_FILE_NAMES[card.suit]}.webp`;

  const rank = RANK_FILE_NAMES[card.rank] ?? card.rank;
  return `${TRIMMED_CARD_DIRECTORY}/${rank}-${SUIT_FILE_NAMES[card.suit]}.webp`;
};

/**
 * The sole production mapping between the frozen game-domain CardId and its
 * complete custom card-face artwork.
 */
export const CARD_ASSETS: Readonly<Record<CardId, string>> = Object.freeze(
  Object.fromEntries(
    CANONICAL_DECK.map((card) => [card.id, getAssetForCard(card.id)]),
  ) as Record<CardId, string>,
);

export const getCardAsset = (cardId: CardId): string => CARD_ASSETS[cardId];

export const getCardAccessibleName = (cardId: CardId): string => {
  const card = getCardById(cardId);

  if (card.kind === "JOKER") return `${card.color === "RED" ? "Red" : "Black"} Joker`;

  return `${RANK_NAMES[card.rank]} of ${SUIT_FILE_NAMES[card.suit].replace(/^./, (letter) => letter.toUpperCase())}`;
};
