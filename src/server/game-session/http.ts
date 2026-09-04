import "server-only";

import {
  GameSessionAccessError,
  InvalidStoredGameRecordError,
  RateLimitConfigurationError,
  RateLimitUnavailableError,
  RetryableGameSessionError,
} from "./errors";

export const privateResponseHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

export const gameJson = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: privateResponseHeaders });

export const unavailableSession = (): Response =>
  gameJson({ code: "GAME_SESSION_UNAVAILABLE" }, 404);

export const temporarilyUnavailable = (): Response =>
  gameJson({ code: "GAME_SESSION_TEMPORARILY_UNAVAILABLE" }, 503);

const retryAfterHeader = (retryAfterSeconds: number): string =>
  String(Math.max(1, Math.min(60 * 60, Math.ceil(retryAfterSeconds))));

/** Generic throttling response; never disclose a limiter key or policy name. */
export const rateLimited = (retryAfterSeconds: number): Response =>
  Response.json(
    { code: "RATE_LIMITED" },
    { status: 429, headers: { ...privateResponseHeaders, "Retry-After": retryAfterHeader(retryAfterSeconds) } },
  );

export const internalUnavailable = (): Response =>
  gameJson({ code: "GAME_SESSION_UNAVAILABLE" }, 500);

/** Prevent database/schema/provider detail from ever crossing the HTTP boundary. */
export const toSafeGameErrorResponse = (error: unknown): Response => {
  if (error instanceof GameSessionAccessError) return unavailableSession();
  if (error instanceof RetryableGameSessionError) return temporarilyUnavailable();
  if (error instanceof RateLimitConfigurationError) return temporarilyUnavailable();
  if (error instanceof RateLimitUnavailableError) return temporarilyUnavailable();
  if (error instanceof InvalidStoredGameRecordError) return internalUnavailable();
  return internalUnavailable();
};

export const readLimitedJson = async (
  request: Request,
  maximumBytes: number,
): Promise<Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false; status: 400 | 413 }>> => {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > maximumBytes) {
    return { ok: false, status: 413 };
  }
  const reader = request.body?.getReader();
  if (reader === undefined) return { ok: false, status: 400 };
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        return { ok: false, status: 413 };
      }
      chunks.push(next.value);
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) };
  } catch {
    return { ok: false, status: 400 };
  } finally {
    reader.releaseLock();
  }
};
