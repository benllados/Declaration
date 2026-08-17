import type { CardId } from "@/game/cards";

export type HandCardPosition = Readonly<{
  cardId: CardId;
  index: number;
  rotation: number;
  lift: number;
  zIndex: number;
}>;

/**
 * Gives a supplied hand a predictable, restrained physical fan. It has no
 * knowledge of card legality or game state, only presentation order.
 */
export const getHandCardPositions = (
  cardIds: readonly CardId[],
  selectedCardId?: CardId,
): readonly HandCardPosition[] => {
  const lastIndex = cardIds.length - 1;
  const center = lastIndex / 2;
  const maximumRotation = Math.min(7.5, Math.max(3.25, lastIndex));

  return cardIds.map((cardId, index) => {
    const isSelected = cardId === selectedCardId;
    const rotation = center === 0 ? 0 : ((index - center) / center) * maximumRotation;

    return Object.freeze({
      cardId,
      index,
      rotation,
      lift: isSelected ? -18 : 0,
      zIndex: isSelected ? cardIds.length + 1 : index + 1,
    });
  });
};
