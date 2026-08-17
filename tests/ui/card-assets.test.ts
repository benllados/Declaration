import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CANONICAL_DECK, type Card, type Rank, type Suit } from "../../src/game/cards";
import { getCardsInSet, type SetId } from "../../src/game/sets";
import { CARD_ASSETS, getCardAccessibleName, getCardAsset } from "../../src/components/cards/card-assets";
import {
  PRODUCTION_CARD_FINGERPRINT_FILES,
  PRODUCTION_CARD_FINGERPRINTS,
} from "../support/production-card-fingerprints";

const CARD_DIRECTORY = join(process.cwd(), "public/cards");
const TRIMMED_CARD_DIRECTORY = join(CARD_DIRECTORY, "trimmed");

const RANK_FILE_NAMES: Readonly<Partial<Record<Rank, string>>> = {
  J: "jack",
  Q: "queen",
  K: "king",
  A: "ace",
};

const SUIT_FILE_NAMES: Readonly<Record<Suit, string>> = {
  HEARTS: "hearts",
  DIAMONDS: "diamonds",
  CLUBS: "clubs",
  SPADES: "spades",
};

type ProductionAssetManifestEntry = {
  id: string;
  rank: string;
  suit: string | null;
  asset: string;
};

const getAssetFileName = (card: Card): string => getCardAsset(card.id).replace("/cards/trimmed/", "");

const getExpectedManifestEntry = (card: Card): ProductionAssetManifestEntry => {
  if (card.kind === "JOKER") {
    const color = card.color === "RED" ? "red" : "black";
    return {
      id: `joker-${color}`,
      rank: "joker",
      suit: null,
      asset: `/cards/joker-${color}.webp`,
    };
  }

  const rank = RANK_FILE_NAMES[card.rank] ?? card.rank;
  const suit = SUIT_FILE_NAMES[card.suit];
  return {
    id: `${rank}-${suit}`,
    rank,
    suit,
    asset: `/cards/${PRODUCTION_CARD_FINGERPRINT_FILES[card.id]}`,
  };
};

const readWebpFiles = (directory: string): Set<string> =>
  new Set(readdirSync(directory).filter((fileName) => fileName.endsWith(".webp")));

const getFileFingerprint = (directory: string, fileName: string): string =>
  createHash("sha256").update(readFileSync(join(directory, fileName))).digest("hex");

describe("production card assets", () => {
  it("keeps the centralized mapping exhaustive and one-to-one for every canonical CardId", () => {
    const assets = CANONICAL_DECK.map((card) => getCardAsset(card.id));
    const cardIds = CANONICAL_DECK.map((card) => card.id);

    expect(CANONICAL_DECK).toHaveLength(54);
    expect(Object.keys(CARD_ASSETS).sort()).toEqual([...cardIds].sort());
    expect(new Set(assets)).toHaveLength(54);
    expect(assets.every((asset) => asset.startsWith("/cards/trimmed/") && asset.endsWith(".webp"))).toBe(true);
  });

  it("maps standard ranks and suits using their exact production filename", () => {
    expect(getCardAsset("2H")).toBe("/cards/trimmed/2-hearts.webp");
    expect(getCardAsset("7D")).toBe("/cards/trimmed/7-diamonds.webp");
    expect(getCardAsset("10C")).toBe("/cards/trimmed/10-clubs.webp");
    expect(getCardAsset("JS")).toBe("/cards/trimmed/jack-spades.webp");
    expect(getCardAsset("QH")).toBe("/cards/trimmed/queen-hearts.webp");
    expect(getCardAsset("KC")).toBe("/cards/trimmed/king-clubs-v2.webp");
    expect(getCardAsset("AS")).toBe("/cards/trimmed/ace-spades.webp");
  });

  it("maps each King CardId to its matching standardized King-and-suit artwork", () => {
    expect(getCardAsset("KH")).toBe("/cards/trimmed/king-hearts-v2.webp");
    expect(getCardAsset("KD")).toBe("/cards/trimmed/king-diamonds-v2.webp");
    expect(getCardAsset("KC")).toBe("/cards/trimmed/king-clubs-v2.webp");
    expect(getCardAsset("KS")).toBe("/cards/trimmed/king-spades-v2.webp");
  });

  it("maps each canonical high set King through the centralized mapping to its versioned rendered URL", () => {
    const highSetKingExpectations: readonly [SetId, Card["id"], string][] = [
      ["HIGH_HEARTS", "KH", "/cards/trimmed/king-hearts-v2.webp"],
      ["HIGH_DIAMONDS", "KD", "/cards/trimmed/king-diamonds-v2.webp"],
      ["HIGH_CLUBS", "KC", "/cards/trimmed/king-clubs-v2.webp"],
      ["HIGH_SPADES", "KS", "/cards/trimmed/king-spades-v2.webp"],
    ];

    for (const [setId, kingCardId, renderedAssetPath] of highSetKingExpectations) {
      expect(getCardsInSet(setId)).toContain(kingCardId);
      expect(getCardAsset(kingCardId)).toBe(renderedAssetPath);
    }
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

  it("has a present, unique full-production face and standardized derivative for all 54 canonical cards", () => {
    const fullProductionFiles = readWebpFiles(CARD_DIRECTORY);
    const standardizedDerivativeFiles = readWebpFiles(TRIMMED_CARD_DIRECTORY);
    const mappedFileNames = CANONICAL_DECK.map(getAssetFileName);

    expect(fullProductionFiles).toHaveLength(54);
    expect(standardizedDerivativeFiles).toHaveLength(54);
    expect(new Set(mappedFileNames)).toHaveLength(54);

    for (const card of CANONICAL_DECK) {
      const fileName = getAssetFileName(card);

      expect(fullProductionFiles.has(fileName)).toBe(true);
      expect(standardizedDerivativeFiles.has(fileName)).toBe(true);
    }

    expect(new Set(mappedFileNames.map((fileName) => getFileFingerprint(CARD_DIRECTORY, fileName)))).toHaveLength(54);
    expect(new Set(mappedFileNames.map((fileName) => getFileFingerprint(TRIMMED_CARD_DIRECTORY, fileName)))).toHaveLength(54);
  });

  it("matches each centralized CardId mapping to its approved full-face and derivative bytes", () => {
    expect(Object.keys(PRODUCTION_CARD_FINGERPRINTS).sort()).toEqual(
      CANONICAL_DECK.map((card) => card.id).sort(),
    );
    expect(Object.keys(PRODUCTION_CARD_FINGERPRINT_FILES).sort()).toEqual(
      CANONICAL_DECK.map((card) => card.id).sort(),
    );

    for (const card of CANONICAL_DECK) {
      const [expectedFullFace, expectedTrimmedDerivative] = PRODUCTION_CARD_FINGERPRINTS[card.id];
      const fileName = getAssetFileName(card);

      expect(fileName).toBe(PRODUCTION_CARD_FINGERPRINT_FILES[card.id]);
      expect(getFileFingerprint(CARD_DIRECTORY, fileName)).toBe(expectedFullFace);
      expect(getFileFingerprint(TRIMMED_CARD_DIRECTORY, fileName)).toBe(expectedTrimmedDerivative);
    }
  });

  it("keeps standardized filename tokens and manifest metadata aligned with every CardId", () => {
    const manifest = JSON.parse(
      readFileSync(join(CARD_DIRECTORY, "manifest.json"), "utf8"),
    ) as ProductionAssetManifestEntry[];
    const manifestByAsset = new Map(manifest.map((entry) => [entry.asset, entry]));

    expect(manifest).toHaveLength(54);
    expect(new Set(manifest.map((entry) => entry.asset))).toHaveLength(54);

    for (const card of CANONICAL_DECK) {
      const expected = getExpectedManifestEntry(card);

      expect(getAssetFileName(card)).toBe(expected.asset.replace("/cards/", ""));
      expect(manifestByAsset.get(expected.asset)).toEqual(expected);
    }
  });

  it("keeps the two Joker production faces distinct", () => {
    const redJoker = getAssetFileName(CANONICAL_DECK.find((card) => card.id === "RED_JOKER")!);
    const blackJoker = getAssetFileName(CANONICAL_DECK.find((card) => card.id === "BLACK_JOKER")!);

    expect(redJoker).toBe("joker-red.webp");
    expect(blackJoker).toBe("joker-black.webp");
    expect(getFileFingerprint(CARD_DIRECTORY, redJoker)).not.toBe(getFileFingerprint(CARD_DIRECTORY, blackJoker));
    expect(getFileFingerprint(TRIMMED_CARD_DIRECTORY, redJoker)).not.toBe(
      getFileFingerprint(TRIMMED_CARD_DIRECTORY, blackJoker),
    );
  });
});
