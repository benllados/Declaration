import { afterEach, describe, expect, it, vi } from "vitest";

import { RateLimitConfigurationError } from "../../src/server/game-session/errors";
import {
  AUTHENTICATED_GAME_READ_RATE_LIMIT,
  configureRateLimitRuntimeForTests,
  createProductionRateLimiter,
  createRateLimitRuntimeForTests,
  deriveRateLimitKey,
  InMemoryRateLimiter,
  limitRequestSource,
  SOURCE_GAME_READ_RATE_LIMIT,
} from "../../src/server/security/rate-limit";
import { seatFor } from "../support/game-session-fixtures";
import { LOCAL_PLAYERS } from "../../src/lib/local-game";

const TEST_KEY_SECRET = "a".repeat(43);

afterEach(() => {
  vi.unstubAllEnvs();
  configureRateLimitRuntimeForTests(undefined);
});

describe("rate-limit boundary", () => {
  it("bounds a key inside its window and resets it after the window", () => {
    let now = 1_000;
    const limiter = new InMemoryRateLimiter(() => now);
    const policy = { limit: 2, windowMs: 1_000 };

    expect(limiter.consume("opaque", policy)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.consume("opaque", policy)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.consume("opaque", policy)).toEqual({ allowed: false, retryAfterSeconds: 1 });
    now += 1_000;
    expect(limiter.consume("opaque", policy)).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("uses injected authoritative source identity instead of spoofable forwarding headers", async () => {
    const limiter = new InMemoryRateLimiter();
    const runtime = createRateLimitRuntimeForTests(limiter, TEST_KEY_SECRET, () => "trusted-source");
    const policy = { limit: 1, windowMs: 60_000 };

    const first = await runtime.limitSource(new Request("http://localhost", { headers: { "x-forwarded-for": "first" } }), policy);
    const spoofed = await runtime.limitSource(new Request("http://localhost", { headers: { "x-forwarded-for": "second", "x-real-ip": "third" } }), policy);

    expect(first.allowed).toBe(true);
    expect(spoofed.allowed).toBe(false);
    expect(deriveRateLimitKey(TEST_KEY_SECRET, "source:1:60000", "trusted-source")).not.toContain("trusted-source");
  });

  it("allows six healthy players behind one NAT while retaining separate per-seat limits", async () => {
    const limiter = new InMemoryRateLimiter();
    const runtime = createRateLimitRuntimeForTests(limiter, TEST_KEY_SECRET, () => "one-nat");
    const seats = Object.values(LOCAL_PLAYERS).map(seatFor);
    const request = new Request("http://localhost");

    for (let poll = 0; poll < 40; poll += 1) {
      for (const seat of seats) {
        expect((await runtime.limitSource(request, SOURCE_GAME_READ_RATE_LIMIT)).allowed).toBe(true);
        expect((await runtime.limitSeat(seat, AUTHENTICATED_GAME_READ_RATE_LIMIT)).allowed).toBe(true);
      }
    }
    for (let extra = 0; extra < 120; extra += 1) {
      expect((await runtime.limitSource(request, SOURCE_GAME_READ_RATE_LIMIT)).allowed).toBe(true);
    }
    expect((await runtime.limitSource(request, SOURCE_GAME_READ_RATE_LIMIT)).allowed).toBe(false);
  });

  it("never turns an unverified cookie-like value into a trusted seat key", async () => {
    const limiter = new InMemoryRateLimiter();
    const runtime = createRateLimitRuntimeForTests(limiter, TEST_KEY_SECRET, () => "source");
    const identity = seatFor(LOCAL_PLAYERS.avery);
    const first = await runtime.limitSeat(identity, { limit: 1, windowMs: 60_000 });
    const duplicate = await runtime.limitSeat(identity, { limit: 1, windowMs: 60_000 });

    expect(first.allowed).toBe(true);
    expect(duplicate.allowed).toBe(false);
  });

  it("constructs the Upstash adapter lazily without contacting Redis", () => {
    expect(createProductionRateLimiter({
      redisUrl: "https://redis.example.invalid",
      redisToken: "not-a-real-token",
      keySecret: TEST_KEY_SECRET,
    })).toEqual(expect.objectContaining({ consume: expect.any(Function) }));
  });

  it("fails closed when production configuration or authoritative source identity is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    await expect(limitRequestSource(new Request("https://app.example"), SOURCE_GAME_READ_RATE_LIMIT))
      .rejects.toBeInstanceOf(RateLimitConfigurationError);
  });

  it("fails closed when Vercel cannot supply an authoritative client address", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "not-a-real-token");
    vi.stubEnv("DECLARATION_RATE_LIMIT_KEY_SECRET", TEST_KEY_SECRET);

    await expect(limitRequestSource(new Request("https://app.example"), SOURCE_GAME_READ_RATE_LIMIT))
      .rejects.toBeInstanceOf(RateLimitConfigurationError);
  });
});
