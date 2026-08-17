"use client";

import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import Image from "next/image";

import type { CardId } from "@/game/cards";

import { getCardAccessibleName, getCardAsset } from "./card-assets";

type PlayingCardProps = Readonly<{
  cardId: CardId;
  size?: "compact" | "normal";
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}>;

export function PlayingCard({
  cardId,
  size = "normal",
  selected = false,
  disabled = false,
  onClick,
  className = "",
}: PlayingCardProps) {
  const accessibleName = getCardAccessibleName(cardId);
  const sharedClassName = [
    "playing-card",
    `playing-card--${size}`,
    selected && "playing-card--selected",
    disabled && "playing-card--disabled",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const image = (
    <Image
      src={getCardAsset(cardId)}
      alt={accessibleName}
      width={800}
      height={1200}
      sizes="(max-width: 42rem) 25vw, 120px"
      draggable={false}
    />
  );

  if (onClick) {
    const buttonProps: ButtonHTMLAttributes<HTMLButtonElement> = {
      type: "button",
      className: sharedClassName,
      onClick,
      disabled,
      "aria-pressed": selected,
      "aria-label": `${accessibleName}${selected ? ", selected" : ""}`,
    };

    return <button {...buttonProps}>{image}</button>;
  }

  const cardProps: HTMLAttributes<HTMLDivElement> = {
    className: sharedClassName,
    role: "img",
    "aria-label": `${accessibleName}${selected ? ", selected" : ""}${disabled ? ", unavailable" : ""}`,
  };

  return <div {...cardProps}>{image}</div>;
}
