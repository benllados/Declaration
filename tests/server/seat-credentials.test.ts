import { afterEach, describe, expect, it, vi } from "vitest";

import {
  generateSeatCredential,
  generateSeatInviteToken,
  getSeatCookieName,
  getSeatCookieOptions,
  hashSeatCredential,
} from "../../src/server/game-session/seat-credentials";

describe("Build 13 seat credentials", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("generates base64url secrets and persists only 32-byte SHA-256 values", () => {
    const credential = generateSeatCredential();
    const inviteToken = generateSeatInviteToken();
    const hash = hashSeatCredential(credential);

    expect(credential).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(inviteToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(inviteToken).not.toBe(credential);
    expect(hash).toHaveLength(32);
    expect(hash.toString("utf8")).not.toContain(credential);
  });

  it("uses a per-game, HttpOnly, strict cookie scoped to the game API path", () => {
    vi.stubEnv("NODE_ENV", "production");
    const expiration = new Date("2030-01-01T00:00:00.000Z");
    const options = getSeatCookieOptions("game-13", expiration);

    expect(getSeatCookieName("game-13")).toBe("declaration-seat-game-13");
    expect(options).toEqual({
      httpOnly: true,
      sameSite: "strict",
      path: "/api/games/game-13",
      secure: true,
      expires: expiration,
      priority: "high",
    });
  });
});
