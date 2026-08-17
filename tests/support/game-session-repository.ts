import type { NormalPlayGameState } from "../../src/game/engine/normal-play";
import type { GameSessionRepository, GameSessionTransaction } from "../../src/server/game-session/repository";
import { decodeStoredGameRecord, type StoredGameRecord } from "../../src/server/game-session/stored-record";

const cloneRecord = (record: StoredGameRecord): StoredGameRecord => {
  const decoded = decodeStoredGameRecord(JSON.parse(JSON.stringify(record)));
  if (!decoded.ok) throw new Error(`Test repository received an invalid record: ${decoded.reason}`);
  return decoded.value;
};

/**
 * Test-only adapter. Its per-game queue models the atomic callback a durable
 * repository must provide without ever being available to production source.
 */
export class TestGameSessionRepository implements GameSessionRepository {
  private readonly records = new Map<string, StoredGameRecord>();
  private readonly locks = new Map<string, Promise<void>>();

  readonly savedRecordReferences: StoredGameRecord[] = [];
  readonly savedStateReferences: NormalPlayGameState[] = [];

  constructor(records: readonly StoredGameRecord[]) {
    for (const record of records) this.records.set(record.gameId, cloneRecord(record));
  }

  async transact<T>(gameId: string, operation: (transaction: GameSessionTransaction) => Promise<T>): Promise<T> {
    const prior = this.locks.get(gameId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(gameId, prior.then(() => held));
    await prior;

    let pending: StoredGameRecord | null = null;
    const transaction: GameSessionTransaction = {
      load: async () => {
        const record = this.records.get(gameId);
        return record === undefined ? null : cloneRecord(record);
      },
      save: async (record) => {
        if (record.gameId !== gameId) throw new Error("Transaction cannot save a different game.");
        this.savedRecordReferences.push(record);
        this.savedStateReferences.push(record.state);
        pending = cloneRecord(record);
      },
    };

    try {
      const result = await operation(transaction);
      if (pending !== null) this.records.set(gameId, pending);
      return result;
    } finally {
      release?.();
    }
  }

  snapshot(gameId: string): StoredGameRecord {
    const record = this.records.get(gameId);
    if (record === undefined) throw new Error(`No test game found for ${gameId}.`);
    return cloneRecord(record);
  }
}
