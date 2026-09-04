import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type { GameProvisioningInput, ProvisionedSeat } from "../../src/server/game-session/provisioning";
import { configureRateLimitRuntimeForTests, InMemoryRateLimiter, type RateLimiter } from "../../src/server/security/rate-limit";

let createGame: ReturnType<typeof vi.fn>;

vi.mock("@/server/game-session/provisioning-runtime", () => ({
  getGameProvisioningRuntime: () => ({ provisioner: { createGame } }),
}));

import { POST } from "../../src/app/api/games/route";

const names = ["Avery", "Jules", "Noa", "Maya", "Eli", "Sage"];
const request = (init: RequestInit): NextRequest => new NextRequest("http://localhost:3000/api/games", init);

beforeEach(() => {
  vi.stubEnv("DECLARATION_APP_ORIGIN", "http://localhost:3000");
  configureRateLimitRuntimeForTests(new InMemoryRateLimiter());
  createGame = vi.fn(async (input: GameProvisioningInput): Promise<Readonly<{ gameId: string; seats: readonly ProvisionedSeat[] }>> => ({
    gameId: input.gameId,
    seats: input.seats.map((seat, index) => ({
      ...seat,
      inviteToken: `${String(index).padStart(2, "0")}${"x".repeat(41)}`,
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    })),
  }));
});

describe("public game creation route", () => {
  it("creates a game only from same-origin JSON and returns invitation paths without credentials", async () => {
    const response = await POST(request({
      method: "POST",
      headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ playerNames: names }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.gameId).toMatch(/^game-/);
    expect(payload.invitations).toHaveLength(6);
    expect(payload.invitations[0]).toMatchObject({ displayName: "Avery", joinPath: expect.stringMatching(/^\/join\/game-[^#]+#[A-Za-z0-9_-]{43}$/) });
    expect(JSON.stringify(payload)).not.toContain("credential");
    expect(createGame).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid, oversized, and cross-origin requests before provisioning", async () => {
    const malformed = await POST(request({
      method: "POST",
      headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ playerNames: names.slice(0, 5) }),
    }));
    const oversized = await POST(request({
      method: "POST",
      headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(8 * 1024) }),
    }));
    const crossOrigin = await POST(request({
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: JSON.stringify({ playerNames: names }),
    }));

    expect([malformed.status, oversized.status, crossOrigin.status]).toEqual([400, 413, 403]);
    expect(createGame).not.toHaveBeenCalled();
  });

  it("limits creation before parsing a body or provisioning and returns a safe Retry-After", async () => {
    const limiter: RateLimiter = { consume: vi.fn().mockResolvedValue({ allowed: false, retryAfterSeconds: 7 }) };
    configureRateLimitRuntimeForTests(limiter);
    const limitedRequest = request({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    const response = await POST(limitedRequest);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("7");
    expect(await response.json()).toEqual({ code: "RATE_LIMITED" });
    expect(limitedRequest.bodyUsed).toBe(false);
    expect(createGame).not.toHaveBeenCalled();
  });

  it("turns a limiter adapter failure into a generic 503 before provisioning", async () => {
    const limiter: RateLimiter = { consume: vi.fn().mockRejectedValue(new Error("redis endpoint failed")) };
    configureRateLimitRuntimeForTests(limiter);

    const response = await POST(request({ method: "POST", headers: { "content-type": "application/json" }, body: "{" }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "GAME_SESSION_TEMPORARILY_UNAVAILABLE" });
    expect(createGame).not.toHaveBeenCalled();
  });
});
