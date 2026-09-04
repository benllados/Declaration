import { afterEach, describe, expect, it, vi } from "vitest";

import { RateLimitConfigurationError } from "../../src/server/game-session/errors";

const mockedUpstash = vi.hoisted(() => ({
  counts: new Map<string, number>(),
  redisConfigurations: [] as unknown[],
  limiterConfigurations: [] as Array<Record<string, unknown>>,
}));

vi.mock("@upstash/redis", () => ({
  Redis: class Redis {
    constructor(configuration: unknown) {
      mockedUpstash.redisConfigurations.push(configuration);
    }
  },
}));

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class Ratelimit {
    static slidingWindow(limit: number, duration: string) {
      return { limit, duration };
    }

    constructor(configuration: Record<string, unknown>) {
      mockedUpstash.limiterConfigurations.push(configuration);
    }

    async limit(key: string) {
      const next = (mockedUpstash.counts.get(key) ?? 0) + 1;
      mockedUpstash.counts.set(key, next);
      return { success: next <= 2, reset: Date.now() + 10_000 };
    }
  },
}));

import {
  createProductionRateLimiter,
  limitRequestSource,
  SOURCE_GAME_CREATION_RATE_LIMIT,
} from "../../src/server/security/rate-limit";

const configuration = {
  redisUrl: "https://redis.example.invalid",
  redisToken: "not-a-real-token",
  keySecret: "A".repeat(43),
};

afterEach(() => {
  vi.unstubAllEnvs();
  mockedUpstash.counts.clear();
  mockedUpstash.redisConfigurations.length = 0;
  mockedUpstash.limiterConfigurations.length = 0;
});

describe("Upstash production rate limiter", () => {
  it("shares mocked Redis decisions across simulated instances without fail-open timeouts", async () => {
    const firstInstance = createProductionRateLimiter(configuration);
    const secondInstance = createProductionRateLimiter(configuration);
    const policy = { limit: 2, windowMs: 60_000 };

    expect((await firstInstance.consume("opaque-source-key", policy)).allowed).toBe(true);
    expect((await secondInstance.consume("opaque-source-key", policy)).allowed).toBe(true);
    expect((await firstInstance.consume("opaque-source-key", policy)).allowed).toBe(false);

    expect(mockedUpstash.redisConfigurations).toHaveLength(2);
    expect(mockedUpstash.limiterConfigurations).toHaveLength(2);
    for (const limiter of mockedUpstash.limiterConfigurations) {
      expect(limiter).toMatchObject({
        prefix: "declaration:rate-limit",
        analytics: false,
        ephemeralCache: false,
        timeout: 0,
      });
    }
  });

  it("fails closed on invalid production limiter configuration before creating a limiter", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "http://redis.example.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", configuration.redisToken);
    vi.stubEnv("DECLARATION_RATE_LIMIT_KEY_SECRET", configuration.keySecret);

    await expect(limitRequestSource(new Request("https://app.example"), SOURCE_GAME_CREATION_RATE_LIMIT))
      .rejects.toBeInstanceOf(RateLimitConfigurationError);

    vi.stubEnv("UPSTASH_REDIS_REST_URL", configuration.redisUrl);
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", " ");
    await expect(limitRequestSource(new Request("https://app.example"), SOURCE_GAME_CREATION_RATE_LIMIT))
      .rejects.toBeInstanceOf(RateLimitConfigurationError);

    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", configuration.redisToken);
    vi.stubEnv("DECLARATION_RATE_LIMIT_KEY_SECRET", "a".repeat(43));
    await expect(limitRequestSource(new Request("https://app.example"), SOURCE_GAME_CREATION_RATE_LIMIT))
      .rejects.toBeInstanceOf(RateLimitConfigurationError);

    expect(mockedUpstash.redisConfigurations).toHaveLength(0);
    expect(mockedUpstash.limiterConfigurations).toHaveLength(0);
  });

  it("initializes production limiting without the optional Vercel system environment variable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("UPSTASH_REDIS_REST_URL", configuration.redisUrl);
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", configuration.redisToken);
    vi.stubEnv("DECLARATION_RATE_LIMIT_KEY_SECRET", configuration.keySecret);

    await expect(limitRequestSource(
      new Request("https://app.example", { headers: { "x-forwarded-for": "203.0.113.10" } }),
      SOURCE_GAME_CREATION_RATE_LIMIT,
    )).rejects.toBeInstanceOf(RateLimitConfigurationError);
    expect(mockedUpstash.limiterConfigurations).toHaveLength(0);

    await expect(limitRequestSource(
      new Request("https://app.example", { headers: { "x-real-ip": "203.0.113.10" } }),
      SOURCE_GAME_CREATION_RATE_LIMIT,
    )).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(mockedUpstash.redisConfigurations).toHaveLength(1);
    expect(mockedUpstash.limiterConfigurations).toHaveLength(1);
  });
});
