import { describe, expect, it } from "vitest";

import {
  extendRateLimitPause,
  nextPollingDelayMilliseconds,
  rateLimitPauseMilliseconds,
} from "../../src/components/game/rate-limit-backoff";

describe("remote gameplay rate-limit backoff", () => {
  it("uses bounded deterministic jitter and a safe Retry-After fallback", () => {
    expect(rateLimitPauseMilliseconds("5", () => 0.5)).toBe(5_125);
    expect(rateLimitPauseMilliseconds("invalid", () => 0)).toBe(1_000);
    expect(rateLimitPauseMilliseconds("999999", () => 1)).toBe(3_600_250);
  });

  it("extends repeated 429 pauses and resumes normal polling only after the pause", () => {
    const firstPause = extendRateLimitPause(0, 10_000, "4", () => 0);
    const extendedPause = extendRateLimitPause(firstPause, 11_000, "8", () => 0);

    expect(firstPause).toBe(14_000);
    expect(extendedPause).toBe(19_000);
    expect(nextPollingDelayMilliseconds(extendedPause, 11_000)).toBe(8_000);
    expect(nextPollingDelayMilliseconds(extendedPause, 19_000)).toBe(1_500);
  });
});
