import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GameSessionAccessError } from "../../src/server/game-session/errors";
import { getSeatCookieName } from "../../src/server/game-session/seat-credentials";
import { configureRateLimitRuntimeForTests, InMemoryRateLimiter, type RateLimiter } from "../../src/server/security/rate-limit";

let redeemInvitation: ReturnType<typeof vi.fn>;

vi.mock("@/server/game-session/provisioning-runtime", () => ({
  getGameProvisioningRuntime: () => ({ provisioner: { redeemInvitation } }),
}));

import { POST } from "../../src/app/api/games/[gameId]/join/route";

const GAME_ID = "game-invite";
const INVITE_TOKEN = "a".repeat(43);
const context = { params: Promise.resolve({ gameId: GAME_ID }) };

const request = (init: RequestInit): NextRequest => new NextRequest(`http://localhost:3000/api/games/${GAME_ID}/join`, init);

beforeEach(() => {
  vi.stubEnv("DECLARATION_APP_ORIGIN", "http://localhost:3000");
  configureRateLimitRuntimeForTests(new InMemoryRateLimiter());
  redeemInvitation = vi.fn().mockResolvedValue({
    seatId: "seat-invite",
    playerId: "player-invite",
    credential: "credential-value",
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  });
});

describe("one-time invitation redemption route", () => {
  it("exchanges a POST body invite for an HttpOnly cookie without returning a credential", async () => {
    const response = await POST(request({
      method: "POST",
      headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ inviteToken: INVITE_TOKEN }),
    }), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ gameId: GAME_ID });
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.getSetCookie()[0]).toContain(`${getSeatCookieName(GAME_ID)}=credential-value`);
    expect(response.headers.getSetCookie()[0]).toContain("HttpOnly");
    expect(redeemInvitation).toHaveBeenCalledWith(GAME_ID, INVITE_TOKEN);
  });

  it("hides unavailable and already redeemed invitations behind the generic response", async () => {
    redeemInvitation.mockRejectedValue(new GameSessionAccessError());
    const unavailable = await POST(request({
      method: "POST",
      headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ inviteToken: INVITE_TOKEN }),
    }), context);
    const malformed = await POST(request({
      method: "POST",
      headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ inviteToken: "bad" }),
    }), context);

    expect(unavailable.status).toBe(404);
    expect(await unavailable.json()).toEqual(await malformed.json());
    expect(redeemInvitation).toHaveBeenCalledTimes(1);
  });

  it("requires an exact same-origin JSON POST before redeeming", async () => {
    const wrongOrigin = await POST(request({
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: JSON.stringify({ inviteToken: INVITE_TOKEN }),
    }), context);
    const wrongType = await POST(request({
      method: "POST",
      headers: { origin: "http://localhost:3000", "content-type": "text/plain" },
      body: INVITE_TOKEN,
    }), context);

    expect([wrongOrigin.status, wrongType.status]).toEqual([404, 404]);
    expect(redeemInvitation).not.toHaveBeenCalled();
  });

  it("limits malformed invitation attempts before body parsing or redemption", async () => {
    const limiter: RateLimiter = { consume: vi.fn().mockResolvedValue({ allowed: false, retryAfterSeconds: 4 }) };
    configureRateLimitRuntimeForTests(limiter);
    const limitedRequest = request({ method: "POST", headers: { "content-type": "application/json" }, body: "{" });

    const response = await POST(limitedRequest, context);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("4");
    expect(await response.json()).toEqual({ code: "RATE_LIMITED" });
    expect(limitedRequest.bodyUsed).toBe(false);
    expect(redeemInvitation).not.toHaveBeenCalled();
  });
});
