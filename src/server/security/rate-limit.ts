import "server-only";

import { createHmac } from "node:crypto";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { ipAddress } from "@vercel/functions";

import {
  RateLimitConfigurationError,
  RateLimitUnavailableError,
} from "@/server/game-session/errors";
import type { SeatIdentity } from "@/server/game-session/seat-identity";

export type RateLimitPolicy = Readonly<{
  limit: number;
  windowMs: number;
}>;

export type RateLimitDecision = Readonly<{
  allowed: boolean;
  retryAfterSeconds: number;
}>;

/** Implementations must make one shared, atomic decision for every instance. */
export type RateLimiter = Readonly<{
  consume: (key: string, policy: RateLimitPolicy) => RateLimitDecision | Promise<RateLimitDecision>;
}>;

type Bucket = Readonly<{ count: number; resetsAt: number }>;
type Now = () => number;
type SourceIdentityResolver = (request: Request) => string | null;
type RateLimitRuntime = Readonly<{
  limiter: RateLimiter;
  keySecret: string;
  sourceIdentity: SourceIdentityResolver;
}>;
export type ProductionRateLimitConfiguration = Readonly<{
  redisUrl: string;
  redisToken: string;
  keySecret: string;
}>;

const LOCAL_KEY_SECRET = "declaration-local-rate-limit-key-not-for-production";
const MINIMUM_HMAC_SECRET_BYTES = 32;

export const SOURCE_GAME_CREATION_RATE_LIMIT: RateLimitPolicy = { limit: 8, windowMs: 60_000 };
export const SOURCE_INVITATION_REDEMPTION_RATE_LIMIT: RateLimitPolicy = { limit: 20, windowMs: 60_000 };
// Six phones polling once per 1.5 seconds produce 240 reads/minute behind one NAT.
export const SOURCE_GAME_READ_RATE_LIMIT: RateLimitPolicy = { limit: 360, windowMs: 60_000 };
export const SOURCE_GAME_ACTION_RATE_LIMIT: RateLimitPolicy = { limit: 180, windowMs: 60_000 };
export const AUTHENTICATED_GAME_READ_RATE_LIMIT: RateLimitPolicy = { limit: 90, windowMs: 60_000 };
export const AUTHENTICATED_GAME_ACTION_RATE_LIMIT: RateLimitPolicy = { limit: 30, windowMs: 60_000 };

const validatePolicy = (policy: RateLimitPolicy): void => {
  if (!Number.isSafeInteger(policy.limit) || policy.limit < 1 || !Number.isSafeInteger(policy.windowMs) || policy.windowMs < 1) {
    throw new RateLimitConfigurationError();
  }
};

/** Safe only for local development and test processes. */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly now: Now = Date.now) {}

  consume(key: string, policy: RateLimitPolicy): RateLimitDecision {
    validatePolicy(policy);
    const now = this.now();
    const existing = this.buckets.get(key);
    const current = existing === undefined || existing.resetsAt <= now
      ? { count: 0, resetsAt: now + policy.windowMs }
      : existing;
    const next: Bucket = { count: current.count + 1, resetsAt: current.resetsAt };
    this.buckets.set(key, next);
    const retryAfterSeconds = Math.max(1, Math.ceil((next.resetsAt - now) / 1_000));
    return next.count <= policy.limit
      ? { allowed: true, retryAfterSeconds: 0 }
      : { allowed: false, retryAfterSeconds };
  }
}

const nonEmpty = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed === value ? trimmed : null;
};

const requireProductionValue = (value: string | undefined): string => {
  const configured = nonEmpty(value);
  if (configured === null) throw new RateLimitConfigurationError();
  return configured;
};

const validateRateLimitKeySecret = (value: string): string => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new RateLimitConfigurationError();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength < MINIMUM_HMAC_SECRET_BYTES || decoded.toString("base64url") !== value) {
    throw new RateLimitConfigurationError();
  }
  return value;
};

const loadProductionConfiguration = (): ProductionRateLimitConfiguration => {
  const redisUrl = requireProductionValue(process.env.UPSTASH_REDIS_REST_URL);
  const redisToken = requireProductionValue(process.env.UPSTASH_REDIS_REST_TOKEN);
  try {
    if (new URL(redisUrl).protocol !== "https:") throw new Error();
  } catch {
    throw new RateLimitConfigurationError();
  }
  return {
    redisUrl,
    redisToken,
    keySecret: validateRateLimitKeySecret(requireProductionValue(process.env.DECLARATION_RATE_LIMIT_KEY_SECRET)),
  };
};

/** Opaque and domain-separated: Redis never receives an IP, cookie, token, or game id. */
export const deriveRateLimitKey = (keySecret: string, namespace: string, value: string): string =>
  createHmac("sha256", keySecret).update(`${namespace}\u0000${value}`, "utf8").digest("base64url");

const sourceNamespace = (policy: RateLimitPolicy): string => `source:${policy.limit}:${policy.windowMs}`;
const seatNamespace = (policy: RateLimitPolicy): string => `seat:${policy.limit}:${policy.windowMs}`;

/**
 * No timeout is configured: a Redis delay/error must reject instead of letting
 * traffic through. `Ratelimit` instances share the supplied Redis backend.
 */
class UpstashRateLimiter implements RateLimiter {
  private readonly limiters = new Map<string, Ratelimit>();

  constructor(private readonly redis: Redis) {}

  async consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision> {
    validatePolicy(policy);
    const policyKey = `${policy.limit}:${policy.windowMs}`;
    let limiter = this.limiters.get(policyKey);
    if (limiter === undefined) {
      limiter = new Ratelimit({
        redis: this.redis,
        limiter: Ratelimit.slidingWindow(policy.limit, `${policy.windowMs} ms` as `${number} ms`),
        prefix: "declaration:rate-limit",
        analytics: false,
        ephemeralCache: false,
        timeout: 0,
      });
      this.limiters.set(policyKey, limiter);
    }
    try {
      const result = await limiter.limit(key);
      if (result.reason === "timeout") throw new RateLimitUnavailableError();
      return {
        allowed: result.success,
        retryAfterSeconds: result.success ? 0 : Math.max(1, Math.ceil((result.reset - Date.now()) / 1_000)),
      };
    } catch (error) {
      if (error instanceof RateLimitUnavailableError) throw error;
      throw new RateLimitUnavailableError();
    }
  }
}

/** Constructs lazily; no Redis request is made until the first limit decision. */
export const createProductionRateLimiter = (configuration: ProductionRateLimitConfiguration): RateLimiter =>
  new UpstashRateLimiter(new Redis({ url: configuration.redisUrl, token: configuration.redisToken }));

const resolveProductionSource: SourceIdentityResolver = (request) => ipAddress(request) ?? null;
const localRuntime: RateLimitRuntime = {
  limiter: new InMemoryRateLimiter(),
  keySecret: LOCAL_KEY_SECRET,
  sourceIdentity: () => "local-process",
};
let productionRuntime: RateLimitRuntime | undefined;
let testRuntime: RateLimitRuntime | undefined;

const getRuntime = (): RateLimitRuntime => {
  if (process.env.NODE_ENV === "test" && testRuntime !== undefined) return testRuntime;
  if (process.env.NODE_ENV !== "production") return localRuntime;
  if (productionRuntime !== undefined) return productionRuntime;
  const configuration = loadProductionConfiguration();
  productionRuntime = {
    limiter: createProductionRateLimiter(configuration),
    keySecret: configuration.keySecret,
    sourceIdentity: resolveProductionSource,
  };
  return productionRuntime;
};

/** A source check must run before parsing, cookies, parameters, or database work. */
export const limitRequestSource = async (request: Request, policy: RateLimitPolicy): Promise<RateLimitDecision> => {
  const runtime = getRuntime();
  const source = runtime.sourceIdentity(request);
  if (source === null || source.length === 0) throw new RateLimitConfigurationError();
  try {
    return await runtime.limiter.consume(deriveRateLimitKey(runtime.keySecret, sourceNamespace(policy), source), policy);
  } catch (error) {
    if (error instanceof RateLimitConfigurationError || error instanceof RateLimitUnavailableError) throw error;
    throw new RateLimitUnavailableError();
  }
};

/** Only call after the repository has authoritatively identified the seat. */
export const limitAuthenticatedSeat = async (
  identity: SeatIdentity,
  policy: RateLimitPolicy,
): Promise<RateLimitDecision> => {
  const runtime = getRuntime();
  const identifier = `${identity.gameId}\u0000${identity.seatId}`;
  try {
    return await runtime.limiter.consume(deriveRateLimitKey(runtime.keySecret, seatNamespace(policy), identifier), policy);
  } catch (error) {
    if (error instanceof RateLimitConfigurationError || error instanceof RateLimitUnavailableError) throw error;
    throw new RateLimitUnavailableError();
  }
};

/** Test-only factory for deterministic policy and identity assertions without production headers. */
export const createRateLimitRuntimeForTests = (
  limiter: RateLimiter,
  keySecret: string,
  sourceIdentity: SourceIdentityResolver,
) => Object.freeze({
  limitSource: async (request: Request, policy: RateLimitPolicy): Promise<RateLimitDecision> => {
    const source = sourceIdentity(request);
    if (source === null || source.length === 0) throw new RateLimitConfigurationError();
    return limiter.consume(deriveRateLimitKey(keySecret, sourceNamespace(policy), source), policy);
  },
  limitSeat: async (identity: SeatIdentity, policy: RateLimitPolicy): Promise<RateLimitDecision> =>
    limiter.consume(
      deriveRateLimitKey(keySecret, seatNamespace(policy), `${identity.gameId}\u0000${identity.seatId}`),
      policy,
    ),
});

/** Isolated dependency injection for route tests; production can never use it. */
export const configureRateLimitRuntimeForTests = (
  limiter: RateLimiter | undefined,
  keySecret = LOCAL_KEY_SECRET,
  sourceIdentity: SourceIdentityResolver = () => "test-source",
): void => {
  if (process.env.NODE_ENV !== "test") throw new Error("Test rate-limit configuration is unavailable outside tests.");
  testRuntime = limiter === undefined ? undefined : { limiter, keySecret, sourceIdentity };
};
