const POLL_INTERVAL_MS = 1_500;
const MAX_RETRY_AFTER_SECONDS = 60 * 60;
const MAX_RETRY_JITTER_MS = 250;

/** Bounded client-side jitter avoids synchronized retries after a shared limit. */
export const rateLimitPauseMilliseconds = (
  retryAfter: string | null,
  random: () => number = Math.random,
): number => {
  const parsed = retryAfter !== null && /^\d+$/.test(retryAfter) ? Number(retryAfter) : 1;
  const seconds = Number.isSafeInteger(parsed) ? Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, parsed)) : 1;
  const jitter = Math.floor(Math.min(0.999_999, Math.max(0, random())) * (MAX_RETRY_JITTER_MS + 1));
  return seconds * 1_000 + jitter;
};

/** Keep the furthest applicable pause when multiple boundaries return 429. */
export const extendRateLimitPause = (
  currentUntil: number,
  now: number,
  retryAfter: string | null,
  random: () => number = Math.random,
): number => Math.max(currentUntil, now + rateLimitPauseMilliseconds(retryAfter, random));

/** Polling never schedules a normal interval before an active 429 pause ends. */
export const nextPollingDelayMilliseconds = (rateLimitedUntil: number, now: number): number =>
  Math.max(POLL_INTERVAL_MS, rateLimitedUntil - now);
