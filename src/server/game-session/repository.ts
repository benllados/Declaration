import type { StoredGameRecord } from "./stored-record";

/** A repository-owned atomic transaction for one authoritative game record. */
export type GameSessionTransaction = Readonly<{
  load: () => Promise<StoredGameRecord | null>;
  save: (record: StoredGameRecord) => Promise<void>;
}>;

/**
 * Implementations must run each callback atomically for its game id. A future
 * PostgreSQL adapter can use a row lock or compare-and-swap transaction here.
 */
export type GameSessionRepository = Readonly<{
  transact: <T>(gameId: string, operation: (transaction: GameSessionTransaction) => Promise<T>) => Promise<T>;
}>;
