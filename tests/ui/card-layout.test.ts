import { describe, expect, it } from "vitest";

import { getHandCardPositions } from "../../src/components/cards/card-layout";

describe("card hand layout", () => {
  const cards = ["3H", "7H", "9C", "JC", "KC"] as const;

  it("preserves the supplied card order deterministically", () => {
    const firstPass = getHandCardPositions(cards);
    const secondPass = getHandCardPositions(cards);

    expect(firstPass).toEqual(secondPass);
    expect(firstPass.map((position) => position.cardId)).toEqual(cards);
    expect(firstPass.map((position) => position.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it("centres the fan and lifts only the selected card", () => {
    const positions = getHandCardPositions(cards, "9C");
    const selected = positions[2];

    expect(positions[0].rotation).toBeLessThan(0);
    expect(positions[2].rotation).toBe(0);
    expect(positions[4].rotation).toBeGreaterThan(0);
    expect(selected).toMatchObject({ cardId: "9C", lift: -18, zIndex: cards.length + 1 });
    expect(positions.filter((position) => position.cardId !== "9C").every((position) => position.lift === 0)).toBe(true);
  });

  it("keeps a one-card hand upright", () => {
    expect(getHandCardPositions(["RED_JOKER"])).toEqual([
      { cardId: "RED_JOKER", index: 0, rotation: 0, lift: 0, zIndex: 1 },
    ]);
  });
});
