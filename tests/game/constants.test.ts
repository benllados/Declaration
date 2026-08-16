import { describe, expect, it } from "vitest";

import { GAME_NAME } from "../../src/game/constants/game";

describe("game constants", () => {
  it("exposes the game name independently of the UI", () => {
    expect(GAME_NAME).toBe("DECLARATION");
  });
});
