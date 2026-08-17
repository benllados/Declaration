import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CANONICAL_DECK } from "../../src/game/cards";
import { getCardAccessibleName, getCardAsset } from "../../src/components/cards/card-assets";

describe("production card assets", () => {
  it("maps every canonical CardId to one unique production asset", () => {
    const assets = CANONICAL_DECK.map((card) => getCardAsset(card.id));

    expect(CANONICAL_DECK).toHaveLength(54);
    expect(new Set(assets)).toHaveLength(54);
    expect(assets.every((asset) => asset.startsWith("/cards/trimmed/") && asset.endsWith(".webp"))).toBe(true);
  });

  it("maps standard ranks and suits using their exact production filename", () => {
    expect(getCardAsset("2H")).toBe("/cards/trimmed/2-hearts.webp");
    expect(getCardAsset("7D")).toBe("/cards/trimmed/7-diamonds.webp");
    expect(getCardAsset("10C")).toBe("/cards/trimmed/10-clubs.webp");
    expect(getCardAsset("JS")).toBe("/cards/trimmed/jack-spades.webp");
    expect(getCardAsset("QH")).toBe("/cards/trimmed/queen-hearts.webp");
    expect(getCardAsset("KC")).toBe("/cards/trimmed/king-clubs.webp");
    expect(getCardAsset("AS")).toBe("/cards/trimmed/ace-spades.webp");
  });

  it("maps and names both Jokers accessibly", () => {
    expect(getCardAsset("RED_JOKER")).toBe("/cards/trimmed/joker-red.webp");
    expect(getCardAsset("BLACK_JOKER")).toBe("/cards/trimmed/joker-black.webp");
    expect(getCardAccessibleName("RED_JOKER")).toBe("Red Joker");
    expect(getCardAccessibleName("BLACK_JOKER")).toBe("Black Joker");
  });

  it("gives every production card face an accessible domain-derived name", () => {
    const names = CANONICAL_DECK.map((card) => getCardAccessibleName(card.id));

    expect(names).toHaveLength(54);
    expect(new Set(names)).toHaveLength(54);
    expect(getCardAccessibleName("7H")).toBe("Seven of Hearts");
    expect(getCardAccessibleName("10C")).toBe("Ten of Clubs");
  });

  it("only references generated full-bleed faces present in public/cards", () => {
    const publicCardFiles = new Set(readdirSync(join(process.cwd(), "public/cards/trimmed")));

    expect([...publicCardFiles].filter((fileName) => fileName.endsWith(".webp"))).toHaveLength(54);

    for (const card of CANONICAL_DECK) {
      expect(publicCardFiles.has(getCardAsset(card.id).replace("/cards/trimmed/", ""))).toBe(true);
    }
  });
});
