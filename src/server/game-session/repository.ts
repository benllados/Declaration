import type { StoredGameRecord } from "./stored-record";
import type { AuthoritativeTimestamp } from "@/game/types/declaration";
import type { SeatIdentity } from "./seat-identity";

/** A repository-owned atomic transaction for one authoritative game record. */
export type GameSessionTransaction = Readonly<{
  load: () => Promise<StoredGameRecord | null>;
  save: (record: StoredGameRecord) => Promise<void>;
  /**
   * Returns one transaction-cached, database-authoritative seconds timestamp.
   * Implementations must only resolve it after the game row has been locked.
   */
  now: () => Promise<AuthoritativeTimestamp>;
}>;

/**
 * Implementations must run each callback atomically for its game id. The
 * PostgreSQL adapter uses a game-row lock as the cross-instance boundary.
 */
export type GameSessionRepository = Readonly<{
  transact: <T>(gameId: string, operation: (transaction: GameSessionTransaction) => Promise<T>) => Promise<T>;
}>;

/** A credential-authenticated, non-locking point-in-time game snapshot. */
export type AuthenticatedGameSessionSnapshot = Readonly<{
  record: StoredGameRecord;
  identity: SeatIdentity;
  now: AuthoritativeTimestamp;
}>;

/**
 * Server-only extension used by the HTTP boundary. Authentication occurs after
 * the game row lock, preventing a rotated/revoked credential from winning a
 * race with an action.
 */
export type SeatAuthenticatedGameSessionRepository = GameSessionRepository & Readonly<{
  /** Non-locking credential preflight used before a trusted per-seat limit. */
  authenticateSeat: (gameId: string, credentialHash: Uint8Array) => Promise<SeatIdentity>;
  readAuthenticatedSnapshot: (
    gameId: string,
    credentialHash: Uint8Array,
  ) => Promise<AuthenticatedGameSessionSnapshot>;
  transactAuthenticated: <T>(
    gameId: string,
    credentialHash: Uint8Array,
    operation: (transaction: GameSessionTransaction, identity: SeatIdentity) => Promise<T>,
  ) => Promise<T>;
}>;
