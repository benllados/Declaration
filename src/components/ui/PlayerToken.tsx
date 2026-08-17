"use client";

/* portraitUrl deliberately accepts future user-provided image URLs. */
/* eslint-disable @next/next/no-img-element */

import type { ButtonHTMLAttributes, HTMLAttributes } from "react";

type PlayerTokenProps = Readonly<{
  name: string;
  cardCount: number;
  portraitUrl?: string;
  team?: "team" | "opponent" | "neutral";
  selected?: boolean;
  active?: boolean;
  disabled?: boolean;
  size?: "small" | "medium" | "large";
  onClick?: () => void;
  className?: string;
}>;

const getInitials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

export function PlayerToken({
  name,
  cardCount,
  portraitUrl,
  team = "neutral",
  selected = false,
  active = false,
  disabled = false,
  size = "medium",
  onClick,
  className = "",
}: PlayerTokenProps) {
  const tokenClassName = [
    "player-token",
    `player-token--${team}`,
    `player-token--${size}`,
    selected && "player-token--selected",
    active && "player-token--active",
    disabled && "player-token--disabled",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      <span className="player-token__portrait">
        {portraitUrl ? <img src={portraitUrl} alt="" /> : <span aria-hidden="true">{getInitials(name)}</span>}
      </span>
      <span className="player-token__count" aria-label={`${cardCount} cards`}>
        {cardCount}
      </span>
      <span className="player-token__name">{name}</span>
      {active ? <span className="sr-only">Current turn</span> : null}
    </>
  );

  if (onClick) {
    const buttonProps: ButtonHTMLAttributes<HTMLButtonElement> = {
      type: "button",
      className: tokenClassName,
      onClick,
      disabled,
      "aria-pressed": selected,
      "aria-label": `${name}, ${cardCount} cards${selected ? ", selected" : ""}${active ? ", current turn" : ""}${disabled ? ", unavailable" : ""}`,
    };

    return <button {...buttonProps}>{content}</button>;
  }

  const tokenProps: HTMLAttributes<HTMLDivElement> = {
    className: tokenClassName,
    "aria-label": `${name}, ${cardCount} cards${selected ? ", selected" : ""}${active ? ", current turn" : ""}${disabled ? ", unavailable" : ""}`,
  };

  return <div {...tokenProps}>{content}</div>;
}
