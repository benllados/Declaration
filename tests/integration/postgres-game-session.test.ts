import { randomUUID } from "node:crypto";

import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createActiveDeclarationState, findLegalAsk } from "../support/game-session-fixtures";
import { createDeterministicLocalGame, LOCAL_PLAYERS } from "../../src/lib/local-game";
import { GameSessionAccessError, InvalidStoredGameRecordError } from "../../src/server/game-session/errors";
import { PostgresGameSessionRepository } from "../../src/server/game-session/postgres-repository";
import { PostgresGameProvisioner } from "../../src/server/game-session/provisioning";
import { hashSeatCredential } from "../../src/server/game-session/seat-credentials";
import { processAuthenticatedAction, readAuthenticatedScopedGameView } from "../../src/server/game-session/service";

const testDatabaseUrl = process.env.DECLARATION_TEST_DATABASE_URL;
const hostname = testDatabaseUrl === undefined ? null : new URL(testDatabaseUrl).hostname;
const explicitlyEnabled = process.env.DECLARATION_RUN_POSTGRES_INTEGRATION === "1";
const localHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
const describePostgres = explicitlyEnabled && localHost ? describe : describe.skip;

const PROVISIONER_GAME_READ_COLUMNS = ["game_id"];
const PROVISIONER_SEAT_READ_COLUMNS = [
  "game_id",
  "seat_id",
  "player_id",
  "invite_token_hash",
  "credential_version",
  "invite_redeemed_at",
  "revoked_at",
  "expires_at",
];

type ProvisionedTestGame = Readonly<{
  gameId: string;
  credential: string;
}>;

let sql: Sql;
let repository: PostgresGameSessionRepository;

const action = (gameId: string, actionId: string, expectedRevision: number) => ({
  gameId,
  actionId,
  expectedRevision,
  type: "ASK" as const,
  payload: findLegalAsk(createDeterministicLocalGame()),
});

const createTestGame = async (state = createDeterministicLocalGame()): Promise<ProvisionedTestGame> => {
  const gameId = `it-${randomUUID().replaceAll("-", "")}`;
  const credential = `credential-${randomUUID().replaceAll("-", "")}`;
  await sql`
    insert into declaration_private.games (game_id, engine_version, revision, state)
    values (${gameId}, 'declaration-v1', 0, ${sql.json(state)})
  `;
  for (const player of state.players) {
    const raw = player.id === LOCAL_PLAYERS.avery ? credential : `credential-${randomUUID().replaceAll("-", "")}`;
    await sql`
      insert into declaration_private.game_seats
        (seat_id, game_id, player_id, credential_hash, invite_token_hash, expires_at)
      values
        (${`seat-${gameId}-${player.id}`}, ${gameId}, ${player.id}, ${hashSeatCredential(raw)}, ${hashSeatCredential(`invite-${raw}`)},
         clock_timestamp() + interval '1 hour')
    `;
  }
  return { gameId, credential };
};

const processAction = (game: ProvisionedTestGame, actionId: string, expectedRevision: number) =>
  processAuthenticatedAction(game.gameId, hashSeatCredential(game.credential), action(game.gameId, actionId, expectedRevision), { repository });

describePostgres("Build 13 PostgreSQL durable multiplayer transport", () => {
  beforeAll(async () => {
    if (testDatabaseUrl === undefined) throw new Error("DECLARATION_TEST_DATABASE_URL is required for PostgreSQL integration tests.");
    sql = postgres(testDatabaseUrl, { prepare: false, max: 4 });
    repository = new PostgresGameSessionRepository(sql);
    const tables = await sql`
      select to_regclass('declaration_private.games') as games,
             to_regclass('declaration_private.game_seats') as seats,
             to_regclass('declaration_private.processed_action_receipts') as receipts
    `;
    if (!tables[0]?.games || !tables[0]?.seats || !tables[0]?.receipts) {
      throw new Error("Apply the local Supabase migration before running PostgreSQL integration tests.");
    }
  });

  afterAll(async () => {
    await sql.end({ timeout: 2 });
  });

  it("grants the provisioner only the reads required for creation, redemption, rotation, and revocation", async () => {
    const tablePrivileges = await sql<Readonly<{ games: boolean; seats: boolean }[]> >`
      select has_table_privilege('declaration_provisioner', 'declaration_private.games', 'select') as games,
             has_table_privilege('declaration_provisioner', 'declaration_private.game_seats', 'select') as seats
    `;
    const gameColumns = await sql<Readonly<{ column_name: string; permitted: boolean }[]> >`
      select column_name,
             has_column_privilege('declaration_provisioner', 'declaration_private.games', column_name, 'select') as permitted
      from information_schema.columns
      where table_schema = 'declaration_private' and table_name = 'games'
    `;
    const seatColumns = await sql<Readonly<{ column_name: string; permitted: boolean }[]> >`
      select column_name,
             has_column_privilege('declaration_provisioner', 'declaration_private.game_seats', column_name, 'select') as permitted
      from information_schema.columns
      where table_schema = 'declaration_private' and table_name = 'game_seats'
    `;

    expect(tablePrivileges[0]).toEqual({ games: false, seats: false });
    expect(gameColumns.filter((column) => column.permitted).map((column) => column.column_name).sort())
      .toEqual(PROVISIONER_GAME_READ_COLUMNS);
    expect(seatColumns.filter((column) => column.permitted).map((column) => column.column_name).sort())
      .toEqual([...PROVISIONER_SEAT_READ_COLUMNS].sort());
    expect(seatColumns.find((column) => column.column_name === "credential_hash")?.permitted).toBe(false);
    expect(gameColumns.find((column) => column.column_name === "state")?.permitted).toBe(false);
  });

  it("serializes same-revision actions and makes parallel duplicate delivery durable", async () => {
    const game = await createTestGame();
    const [sameRevisionA, sameRevisionB] = await Promise.all([
      processAction(game, "same-revision-a", 0),
      processAction(game, "same-revision-b", 0),
    ]);
    expect([sameRevisionA.status, sameRevisionB.status].sort()).toEqual(["APPLIED", "CONFLICT"]);

    const duplicateGame = await createTestGame();
    const [first, duplicate] = await Promise.all([
      processAction(duplicateGame, "parallel-duplicate", 0),
      processAction(duplicateGame, "parallel-duplicate", 0),
    ]);
    expect([first.status, duplicate.status].sort()).toEqual(["APPLIED", "DUPLICATE"]);
    const receipts = await sql`
      select action_id from declaration_private.processed_action_receipts
      where game_id = ${duplicateGame.gameId}
    `;
    expect(receipts).toHaveLength(1);

    const freshRepository = new PostgresGameSessionRepository(sql);
    const durable = await processAuthenticatedAction(
      duplicateGame.gameId,
      hashSeatCredential(duplicateGame.credential),
      action(duplicateGame.gameId, "parallel-duplicate", 0),
      { repository: freshRepository },
    );
    expect(durable.status).toBe("DUPLICATE");
  });

  it("rolls back callback failures and waits for a held row lock before proceeding", async () => {
    const game = await createTestGame();
    await expect(repository.transact(game.gameId, async (transaction) => {
      const loaded = await transaction.load();
      await transaction.save({ ...loaded!, revision: 1 });
      throw new Error("rollback test");
    })).rejects.toThrow("rollback test");
    const afterRollback = await sql`
      select revision from declaration_private.games where game_id = ${game.gameId}
    `;
    expect(Number(afterRollback[0]?.revision)).toBe(0);

    let completed = false;
    let pending: Promise<unknown> | undefined;
    await sql.begin(async (transactionSql) => {
      const transaction = transactionSql as unknown as Sql;
      await transaction`select game_id from declaration_private.games where game_id = ${game.gameId} for update`;
      pending = processAction(game, "after-row-lock", 0).then(() => {
        completed = true;
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      expect(completed).toBe(false);
    });
    await pending;
    expect(completed).toBe(true);
  });

  it("serves an unchanged authenticated projection without waiting on a held game-row lock", async () => {
    const game = await createTestGame();
    let completed = false;
    let pendingRead: Promise<unknown> | undefined;

    await sql.begin(async (transactionSql) => {
      const transaction = transactionSql as unknown as Sql;
      await transaction`select game_id from declaration_private.games where game_id = ${game.gameId} for update`;
      pendingRead = readAuthenticatedScopedGameView(game.gameId, hashSeatCredential(game.credential), { repository })
        .then(() => { completed = true; });
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      expect(completed).toBe(true);
    });
    await pendingRead;
  });

  it("performs credential preflight without a game-row lock and reauthenticates actions after revocation", async () => {
    const game = await createTestGame();
    const credentialHash = hashSeatCredential(game.credential);
    let completed = false;
    let pendingPreflight: Promise<unknown> | undefined;

    await sql.begin(async (transactionSql) => {
      const transaction = transactionSql as unknown as Sql;
      await transaction`select game_id from declaration_private.games where game_id = ${game.gameId} for update`;
      pendingPreflight = repository.authenticateSeat(game.gameId, credentialHash).then(() => {
        completed = true;
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      expect(completed).toBe(true);
    });
    await pendingPreflight;

    const seatId = `seat-${game.gameId}-${LOCAL_PLAYERS.avery}`;
    await new PostgresGameProvisioner(sql).revokeCredential(game.gameId, seatId);
    await expect(processAction(game, "post-revocation-action", 0)).rejects.toBeInstanceOf(GameSessionAccessError);
  });

  it("keeps durable duplicate responses within the 128-receipt retention window", async () => {
    const game = await createTestGame(createActiveDeclarationState(100));
    for (let index = 0; index <= 128; index += 1) {
      const response = await processAction(game, `db-retention-${String(index).padStart(3, "0")}`, 0);
      expect(response.status).toBe("REJECTED");
    }

    const retained = await processAction(game, "db-retention-128", 0);
    const receipts = await sql`
      select action_id from declaration_private.processed_action_receipts
      where game_id = ${game.gameId}
    `;

    expect(retained.status).toBe("DUPLICATE");
    expect(receipts).toHaveLength(128);
  });

  it("strictly rejects malformed persisted game state and receipt JSON", async () => {
    const malformedState = await createTestGame();
    await sql`update declaration_private.games set state = ${sql.json({})} where game_id = ${malformedState.gameId}`;
    await expect(repository.transact(malformedState.gameId, async (transaction) => transaction.load()))
      .rejects.toBeInstanceOf(InvalidStoredGameRecordError);

    const malformedReceipt = await createTestGame();
    const seatId = `seat-${malformedReceipt.gameId}-${LOCAL_PLAYERS.avery}`;
    await sql`
      insert into declaration_private.processed_action_receipts
        (game_id, seat_id, action_id, status, outcome, resulting_revision)
      values (${malformedReceipt.gameId}, ${seatId}, 'malformed-receipt', 'REJECTED', ${sql.json({ kind: 'NOPE' })}, 0)
    `;
    await expect(repository.transact(malformedReceipt.gameId, async (transaction) => transaction.load()))
      .rejects.toBeInstanceOf(InvalidStoredGameRecordError);
  });

  it("authenticates only current, unexpired credentials and never persists raw credentials", async () => {
    const gameId = `provisioned-${randomUUID().replaceAll("-", "")}`;
    const state = createDeterministicLocalGame();
    const provisioned = await new PostgresGameProvisioner(sql).createGame({
      gameId,
      state,
      seats: state.players.map((player) => ({ seatId: `seat-${gameId}-${player.id}`, playerId: player.id })),
      seatTtlSeconds: 3600,
    });
    const seat = provisioned.seats.find((candidate) => candidate.playerId === LOCAL_PLAYERS.avery)!;
    await expect(readAuthenticatedScopedGameView(gameId, hashSeatCredential("not-a-seat"), { repository }))
      .rejects.toBeInstanceOf(GameSessionAccessError);
    const redeemed = await new PostgresGameProvisioner(sql).redeemInvitation(gameId, seat.inviteToken);
    await expect(readAuthenticatedScopedGameView("missing-game", hashSeatCredential(redeemed.credential), { repository }))
      .rejects.toBeInstanceOf(GameSessionAccessError);

    const stored = await sql`
      select credential_hash, octet_length(credential_hash) as credential_hash_length
      from declaration_private.game_seats where game_id = ${gameId} and seat_id = ${seat.seatId}
    `;
    expect(Number(stored[0]?.credential_hash_length)).toBe(32);
    expect(Buffer.from(stored[0]?.credential_hash).toString("utf8")).not.toContain(redeemed.credential);

    await expect(new PostgresGameProvisioner(sql).redeemInvitation(gameId, seat.inviteToken))
      .rejects.toBeInstanceOf(GameSessionAccessError);

    await sql`
      update declaration_private.game_seats
      set expires_at = created_at + interval '1 millisecond'
      where game_id = ${gameId} and seat_id = ${seat.seatId}
    `;
    await expect(readAuthenticatedScopedGameView(gameId, hashSeatCredential(redeemed.credential), { repository }))
      .rejects.toBeInstanceOf(GameSessionAccessError);

    const rotated = await new PostgresGameProvisioner(sql).rotateCredential(gameId, seat.seatId, 3600);
    await expect(readAuthenticatedScopedGameView(gameId, hashSeatCredential(redeemed.credential), { repository }))
      .rejects.toBeInstanceOf(GameSessionAccessError);
    await expect(readAuthenticatedScopedGameView(gameId, hashSeatCredential(rotated.credential), { repository }))
      .resolves.toMatchObject({ revision: 0 });

    await new PostgresGameProvisioner(sql).revokeCredential(gameId, seat.seatId);
    await expect(readAuthenticatedScopedGameView(gameId, hashSeatCredential(rotated.credential), { repository }))
      .rejects.toBeInstanceOf(GameSessionAccessError);
  });

  it("uses database time after the lock and resolves an expired declaration once", async () => {
    const game = await createTestGame();
    const before = await sql`select extract(epoch from clock_timestamp())::double precision as seconds`;
    const started = await processAuthenticatedAction(game.gameId, hashSeatCredential(game.credential), {
      gameId: game.gameId,
      actionId: "db-time-start",
      expectedRevision: 0,
      type: "START_DECLARATION" as const,
      payload: { selectedSetId: "LOW_HEARTS" },
    }, { repository });
    const after = await sql`select extract(epoch from clock_timestamp())::double precision as seconds`;
    const persisted = await sql`
      select state from declaration_private.games where game_id = ${game.gameId}
    `;
    const startedAt = Number(persisted[0]?.state?.activeDeclaration?.startedAt);
    expect(started.status).toBe("APPLIED");
    expect(startedAt).toBeGreaterThanOrEqual(Number(before[0]?.seconds));
    expect(startedAt).toBeLessThanOrEqual(Number(after[0]?.seconds));

    const expiryGame = await createTestGame(createActiveDeclarationState(1));
    const [first, second] = await Promise.all([
      readAuthenticatedScopedGameView(expiryGame.gameId, hashSeatCredential(expiryGame.credential), { repository }),
      readAuthenticatedScopedGameView(expiryGame.gameId, hashSeatCredential(expiryGame.credential), { repository }),
    ]);
    expect(first.revision).toBe(1);
    expect(second.revision).toBe(1);
  });
});
