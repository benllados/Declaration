/** Deliberately generic: callers must not learn whether a game or seat exists. */
export class GameSessionAccessError extends Error {
  constructor() {
    super("Game session access denied.");
  }
}

/** A safe-to-retry infrastructure failure; its cause is deliberately hidden. */
export class RetryableGameSessionError extends Error {
  constructor() {
    super("Game session is temporarily unavailable.");
  }
}

/** Persisted JSON did not satisfy the strict, versioned storage codec. */
export class InvalidStoredGameRecordError extends Error {
  constructor() {
    super("Stored game record is invalid.");
  }
}

/** Production must supply a cross-instance rate-limit adapter before serving public traffic. */
export class RateLimitConfigurationError extends Error {
  constructor() {
    super("A production rate-limit adapter has not been configured.");
  }
}

/** The shared limiter could not make an authoritative decision. */
export class RateLimitUnavailableError extends Error {
  constructor() {
    super("The rate-limit service is temporarily unavailable.");
  }
}
