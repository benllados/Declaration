"use client";

import type { CSSProperties } from "react";

import type { CardId } from "@/game/cards";

import { getHandCardPositions } from "./card-layout";
import { PlayingCard } from "./PlayingCard";

type CardHandProps = Readonly<{
  cardIds: readonly CardId[];
  selectedCardId?: CardId;
  disabledCardIds?: readonly CardId[];
  onSelectedCardChange?: (cardId: CardId) => void;
  label?: string;
  hint?: string;
}>;

export function CardHand({
  cardIds,
  selectedCardId,
  disabledCardIds = [],
  onSelectedCardChange,
  label = "Your hand",
  hint,
}: CardHandProps) {
  const positions = getHandCardPositions(cardIds, selectedCardId);
  const canSelect = typeof onSelectedCardChange === "function";

  return (
    <section className="card-hand" aria-label={label}>
      <div className="card-hand__header">
        <div>
          <h3>{label}</h3>
          <span>{cardIds.length} cards</span>
        </div>
        {hint ? <p>{hint}</p> : null}
      </div>
      <div className="card-hand__scroller">
        <div className="card-hand__fan">
          {positions.map((position) => {
            const disabled = disabledCardIds.includes(position.cardId);

            return (
              <div
                className="card-hand__item"
                key={position.cardId}
                style={{
                  "--card-rotation": `${position.rotation}deg`,
                  "--card-lift": `${position.lift}px`,
                  zIndex: position.zIndex,
                } as CSSProperties}
              >
                <PlayingCard
                  cardId={position.cardId}
                  selected={position.cardId === selectedCardId}
                  disabled={disabled}
                  onClick={canSelect && !disabled ? () => onSelectedCardChange(position.cardId) : undefined}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
