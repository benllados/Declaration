import { describe, expect, it, vi } from "vitest";

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

import { createProductionRateLimiter } from "../../src/server/security/rate-limit";

const configuration = {
  redisUrl: "https://redis.example.invalid",
  redisToken: "not-a-real-token",
  keySecret: "a".repeat(43),
};

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
});
