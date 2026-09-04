import "server-only";

import type { AuthoritativeTimestamp } from "@/game/types/declaration";
import { createPlayerId } from "@/game/types/player";
import { isOpaqueId } from "@/lib/multiplayer/action-codec";
import type { Sql } from "postgres";

import {
  GameSessionAccessError,
  InvalidStoredGameRecordError,
  RetryableGameSessionError,
} from "./errors";
import type {
  AuthenticatedGameSessionSnapshot,
  GameSessionTransaction,
  SeatAuthenticatedGameSessionRepository,
} from "./repository";
import type { SeatIdentity } from "./seat-identity";
import {
  decodeStoredGameRecord,
  MAX_PROCESSED_ACTION_RECEIPTS,
  type ProcessedActionReceipt,
  type StoredGameRecord,
} from "./stored-record";

const LOCK_TIMEOUT = "3s";
const STATEMENT_TIMEOUT = "8s";
const MAX_TRANSACTION_ATTEMPTS = 2;

type PersistedGameRow = Readonly<{
  game_id: unknown;
  engine_version: unknown;
  revision: unknown;
  state: unknown;
}>;

type PersistedReceiptRow = Readonly<{
  seat_id: unknown;
  action_id: unknown;
  status: unknown;
  outcome: unknown;
  resulting_revision: unknown;
}>;

type PersistedScopedGameRow = PersistedGameRow & Readonly<{
  seat_id: unknown;
  player_id: unknown;
  seconds: unknown;
}>;

const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const revisionFromDatabase = (value: unknown, label: string): number => {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new InvalidStoredGameRecordError();
  return parsed;
};

const decodePersistedRecord = (
  game: PersistedGameRow,
  receipts: readonly PersistedReceiptRow[],
): StoredGameRecord => {
  const decoded = decodeStoredGameRecord({
    gameId: game.game_id,
    engineVersion: game.engine_version,
    revision: revisionFromDatabase(game.revision, "game revision"),
    state: game.state,
    processedActions: receipts.map((receipt) => ({
      seatId: receipt.seat_id,
      actionId: receipt.action_id,
      status: receipt.status,
      outcome: receipt.outcome,
      resultingRevision: revisionFromDatabase(receipt.resulting_revision, "receipt revision"),
    })),
  });
  if (!decoded.ok) throw new InvalidStoredGameRecordError();
  return deepFreeze(decoded.value);
};

/** Returns a fresh, frozen defensive copy before data reaches a callback. */
const cloneRecord = (record: StoredGameRecord): StoredGameRecord => {
  const decoded = decodeStoredGameRecord(JSON.parse(JSON.stringify(record)));
  if (!decoded.ok) throw new InvalidStoredGameRecordError();
  return deepFreeze(decoded.value);
};

const receiptKey = (receipt: ProcessedActionReceipt): string => `${receipt.seatId}:${receipt.actionId}`;
const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const validateSave = (gameId: string, baseline: StoredGameRecord, candidate: StoredGameRecord): StoredGameRecord => {
  const decoded = decodeStoredGameRecord(JSON.parse(JSON.stringify(candidate)));
  if (!decoded.ok) throw new InvalidStoredGameRecordError();
  const record = decoded.value;
  if (record.gameId !== gameId || record.gameId !== baseline.gameId || record.engineVersion !== baseline.engineVersion) {
    throw new InvalidStoredGameRecordError();
  }
  if (record.revision < baseline.revision) throw new InvalidStoredGameRecordError();
  if (!sameJson(record.state, baseline.state) && record.revision <= baseline.revision) {
    throw new InvalidStoredGameRecordError();
  }

  const received = new Map(record.processedActions.map((receipt) => [receiptKey(receipt), receipt]));
  const baselineKeys = new Set(baseline.processedActions.map(receiptKey));
  const addedReceiptCount = record.processedActions.filter((receipt) => !baselineKeys.has(receiptKey(receipt))).length;
  const removedReceiptCount = baseline.processedActions.filter((receipt) => !received.has(receiptKey(receipt))).length;
  // A save may evict only enough history to make room for newly appended
  // receipts; timeout-only saves are never allowed to erase idempotency data.
  if (removedReceiptCount > addedReceiptCount) throw new InvalidStoredGameRecordError();
  for (const receipt of baseline.processedActions) {
    const matching = received.get(receiptKey(receipt));
    // Retention may prune a receipt, but an existing receipt is immutable.
    if (matching !== undefined && !sameJson(matching, receipt)) throw new InvalidStoredGameRecordError();
  }
  return deepFreeze(record);
};

const postgresCode = (error: unknown): string | null =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : null;

const isTransactionRetryCode = (error: unknown): boolean => {
  const code = postgresCode(error);
  return code === "40P01" || code === "40001";
};

const isRetryableDatabaseFailure = (error: unknown): boolean => {
  const code = postgresCode(error);
  if (code !== null && (code === "55P03" || code === "57014" || code === "53300" || code.startsWith("08"))) return true;
  return error instanceof Error && /ECONNRESET|ECONNREFUSED|ETIMEDOUT|connection terminated/i.test(error.message);
};

type Operation<T> = (transaction: GameSessionTransaction, identity?: SeatIdentity) => Promise<T>;

/**
 * Postgres.js repository for the authoritative transport. The game row is
 * always locked first, then (when needed) its seat row, providing deterministic
 * cross-instance serialization under READ COMMITTED.
 */
export class PostgresGameSessionRepository implements SeatAuthenticatedGameSessionRepository {
  constructor(private readonly sql: Sql) {}

  async transact<T>(gameId: string, operation: (transaction: GameSessionTransaction) => Promise<T>): Promise<T> {
    return this.withRetry(() => this.run(gameId, undefined, async (transaction) => operation(transaction)));
  }

  async transactAuthenticated<T>(
    gameId: string,
    credentialHash: Uint8Array,
    operation: (transaction: GameSessionTransaction, identity: SeatIdentity) => Promise<T>,
  ): Promise<T> {
    return this.withRetry(() => this.run(gameId, credentialHash, async (transaction, identity) => {
      if (identity === undefined) throw new GameSessionAccessError();
      return operation(transaction, identity);
    }));
  }

  /**
   * Cheapest authoritative credential lookup. It deliberately does not lock a
   * game or seat row; serialized action processing authenticates again later.
   */
  async authenticateSeat(gameId: string, credentialHash: Uint8Array): Promise<SeatIdentity> {
    if (!isOpaqueId(gameId) || credentialHash.byteLength !== 32) throw new GameSessionAccessError();
    return this.withRetry(() => this.authenticateSeatSnapshot(this.sql, gameId, credentialHash));
  }

  async readAuthenticatedSnapshot(
    gameId: string,
    credentialHash: Uint8Array,
  ): Promise<AuthenticatedGameSessionSnapshot> {
    if (!isOpaqueId(gameId) || credentialHash.byteLength !== 32) throw new GameSessionAccessError();
    return this.withRetry(async () => {
      // This is intentionally a plain SELECT: frequent player polling never
      // takes the game-row lock. A due timeout is serialized separately.
      const rows = await this.sql<PersistedScopedGameRow[]>`
        select g.game_id, g.engine_version, g.revision, g.state,
               s.seat_id, s.player_id,
               extract(epoch from clock_timestamp())::double precision as seconds
        from declaration_private.games as g
        join declaration_private.game_seats as s on s.game_id = g.game_id
        where g.game_id = ${gameId}
          and s.credential_hash = ${credentialHash}
          and s.revoked_at is null
          and s.expires_at > clock_timestamp()
      `;
      const row = rows[0];
      if (row === undefined || !isOpaqueId(row.seat_id) || !isOpaqueId(row.player_id)) {
        throw new GameSessionAccessError();
      }
      const seconds = Number(row.seconds);
      if (!Number.isFinite(seconds)) throw new RetryableGameSessionError();
      const record = decodePersistedRecord(row, []);
      const identity: SeatIdentity = {
        gameId,
        seatId: row.seat_id,
        playerId: createPlayerId(row.player_id),
      };
      return { record, identity, now: seconds as AuthoritativeTimestamp };
    });
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (isTransactionRetryCode(error) && attempt + 1 < MAX_TRANSACTION_ATTEMPTS) continue;
        if (isTransactionRetryCode(error) || isRetryableDatabaseFailure(error)) throw new RetryableGameSessionError();
        throw error;
      }
    }
    throw new RetryableGameSessionError();
  }

  private async run<T>(gameId: string, credentialHash: Uint8Array | undefined, operation: Operation<T>): Promise<T> {
    if (!isOpaqueId(gameId)) throw new GameSessionAccessError();
    return (await this.sql.begin(async (transactionSql) => {
      // postgres' TransactionSql declaration omits its template-tag call
      // signature even though the runtime transaction object supports it.
      const sql = transactionSql as unknown as Sql;
      await sql`select set_config('lock_timeout', ${LOCK_TIMEOUT}, true)`;
      await sql`select set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true)`;
      const controlledTransaction = this.createTransaction(sql, gameId);
      const transaction = controlledTransaction.transaction;

      // Acquiring this lock before the seat lock is intentional and consistent.
      const record = await transaction.load();
      if (record === null) throw new GameSessionAccessError();

      let identity: SeatIdentity | undefined;
      if (credentialHash !== undefined) identity = await this.authenticateSeatUnderLock(sql, gameId, credentialHash);
      const result = await operation(transaction, identity);
      await controlledTransaction.commit();
      return result;
    })) as T;
  }

  private createTransaction(sql: Sql, gameId: string): Readonly<{
    transaction: GameSessionTransaction;
    commit: () => Promise<void>;
  }> {
    let loaded: StoredGameRecord | null | undefined;
    let pending: StoredGameRecord | undefined;
    let authoritativeNow: AuthoritativeTimestamp | undefined;

    const load = async (): Promise<StoredGameRecord | null> => {
      if (loaded !== undefined) return loaded === null ? null : cloneRecord(loaded);
      const games = await sql<PersistedGameRow[]>`
        select game_id, engine_version, revision, state
        from declaration_private.games
        where game_id = ${gameId}
        for update
      `;
      const game = games[0];
      if (game === undefined) {
        loaded = null;
        return null;
      }
      const receipts = await sql<PersistedReceiptRow[]>`
        select seat_id, action_id, status, outcome, resulting_revision
        from (
          select seat_id, action_id, status, outcome, resulting_revision, processed_at
          from declaration_private.processed_action_receipts
          where game_id = ${gameId}
          order by processed_at desc, seat_id desc, action_id desc
          limit ${MAX_PROCESSED_ACTION_RECEIPTS}
        ) as retained_receipts
        order by processed_at asc, seat_id asc, action_id asc
      `;
      loaded = decodePersistedRecord(game, receipts);
      return cloneRecord(loaded);
    };

    const now = async (): Promise<AuthoritativeTimestamp> => {
      if (loaded === undefined) throw new InvalidStoredGameRecordError();
      if (authoritativeNow !== undefined) return authoritativeNow;
      const rows = await sql<Readonly<{ seconds: unknown }[]> >`
        select extract(epoch from clock_timestamp())::double precision as seconds
      `;
      const seconds = Number(rows[0]?.seconds);
      if (!Number.isFinite(seconds)) throw new RetryableGameSessionError();
      authoritativeNow = seconds as AuthoritativeTimestamp;
      return authoritativeNow;
    };

    const save = async (candidate: StoredGameRecord): Promise<void> => {
      const baseline = await load();
      if (baseline === null) throw new GameSessionAccessError();
      pending = validateSave(gameId, baseline, candidate);
    };

    const commit = async (): Promise<void> => {
      if (pending === undefined) return;
      const baseline = await load();
      if (baseline === null) throw new GameSessionAccessError();
      const updated = await sql`
        update declaration_private.games
        set state = ${sql.json(pending.state)}, revision = ${String(pending.revision)}, updated_at = clock_timestamp()
        where game_id = ${gameId} and revision = ${String(baseline.revision)}
        returning game_id
      `;
      if (updated.length !== 1) throw new RetryableGameSessionError();

      const baselineReceipts = new Set(baseline.processedActions.map(receiptKey));
      let insertedReceipt = false;
      for (const receipt of pending.processedActions) {
        if (baselineReceipts.has(receiptKey(receipt))) continue;
        insertedReceipt = true;
        await sql`
          insert into declaration_private.processed_action_receipts
            (game_id, seat_id, action_id, status, outcome, resulting_revision)
          values
            (${gameId}, ${receipt.seatId}, ${receipt.actionId}, ${receipt.status}, ${sql.json(receipt.outcome)}, ${String(receipt.resultingRevision)})
        `;
      }
      if (insertedReceipt) {
        await sql`select declaration_private.prune_processed_action_receipts(${gameId})`;
      }
    };

    return { transaction: { load, save, now }, commit };
  }

  private async authenticateSeatSnapshot(
    sql: Sql,
    gameId: string,
    credentialHash: Uint8Array,
  ): Promise<SeatIdentity> {
    if (credentialHash.byteLength !== 32) throw new GameSessionAccessError();
    const rows = await sql<Readonly<{ seat_id: unknown; player_id: unknown }[]> >`
      select seat_id, player_id
      from declaration_private.game_seats
      where game_id = ${gameId}
        and credential_hash = ${credentialHash}
        and revoked_at is null
        and expires_at > clock_timestamp()
    `;
    const seat = rows[0];
    if (seat === undefined || !isOpaqueId(seat.seat_id) || !isOpaqueId(seat.player_id)) throw new GameSessionAccessError();
    return { gameId, seatId: seat.seat_id, playerId: createPlayerId(seat.player_id) };
  }

  private async authenticateSeatUnderLock(
    sql: Sql,
    gameId: string,
    credentialHash: Uint8Array,
  ): Promise<SeatIdentity> {
    if (credentialHash.byteLength !== 32) throw new GameSessionAccessError();
    const rows = await sql<Readonly<{ seat_id: unknown; player_id: unknown }[]> >`
      select seat_id, player_id
      from declaration_private.game_seats
      where game_id = ${gameId}
        and credential_hash = ${credentialHash}
        and revoked_at is null
        and expires_at > clock_timestamp()
      for update
    `;
    const seat = rows[0];
    if (seat === undefined || !isOpaqueId(seat.seat_id) || !isOpaqueId(seat.player_id)) throw new GameSessionAccessError();
    return { gameId, seatId: seat.seat_id, playerId: createPlayerId(seat.player_id) };
  }
}
