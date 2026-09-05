import type { Sql } from "postgres";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDeterministicLocalGame } from "../../src/lib/local-game";
import type { GameProvisioningInput } from "../../src/server/game-session/provisioning";
import { PostgresGameProvisioner } from "../../src/server/game-session/provisioning";

type QueryHandler = (statement: string) => unknown;

const input = (): GameProvisioningInput => {
  const state = createDeterministicLocalGame();
  return {
    gameId: "game-provisioning-stage",
    state,
    seats: state.players.map((player) => ({ seatId: `seat-${player.id}`, playerId: player.id })),
    seatTtlSeconds: 3600,
  };
};

const fakeSql = (
  queryHandler: QueryHandler,
  beginOverride?: (callback: (transaction: Sql) => unknown) => Promise<unknown>,
): Sql => {
  const sql = vi.fn((strings: TemplateStringsArray) => queryHandler(strings.join(" "))) as unknown as Sql;
  const begin = beginOverride ?? (async (callback: (transaction: Sql) => unknown) => callback(sql));
  Object.assign(sql, {
    begin,
    json: (value: unknown) => value,
  });
  return sql;
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Postgres game provisioning diagnostics", () => {
  it("classifies invalid provisioning configuration before starting a transaction", async () => {
    vi.stubEnv("DECLARATION_SEAT_TTL_SECONDS", "not-a-number");
    const provisioner = new PostgresGameProvisioner(fakeSql(() => []));
    const configured = { ...input(), seatTtlSeconds: undefined };

    await expect(provisioner.createGame(configured)).rejects.toMatchObject({ category: "provisioning_configuration" });
  });

  it("classifies invalid input before starting a transaction", async () => {
    const provisioner = new PostgresGameProvisioner(fakeSql(() => []));
    const invalid = { ...input(), seats: input().seats.slice(0, 5) };

    await expect(provisioner.createGame(invalid)).rejects.toMatchObject({ category: "provisioning_input_validation" });
  });

  it("classifies an unrecognized failure before a transaction callback begins", async () => {
    const provisioner = new PostgresGameProvisioner(fakeSql(
      () => [],
      async () => { throw new Error("synthetic transaction startup failure"); },
    ));

    await expect(provisioner.createGame(input())).rejects.toMatchObject({ category: "provisioning_transaction_start_unknown" });
  });

  it("preserves a connection category inside an AggregateError from sql.begin", async () => {
    const provisioner = new PostgresGameProvisioner(fakeSql(
      () => [],
      async () => {
        throw new AggregateError([
          Object.assign(new Error("synthetic connection refusal"), { code: "ECONNREFUSED" }),
        ], "synthetic connection aggregate");
      },
    ));

    await expect(provisioner.createGame(input())).rejects.toMatchObject({ category: "provisioning_connection_refused" });
  });

  it("classifies a game insert failure", async () => {
    const provisioner = new PostgresGameProvisioner(fakeSql((statement) => {
      if (statement.includes("insert into declaration_private.games")) {
        throw new Error("synthetic game insert failure");
      }
      return [];
    }));

    await expect(provisioner.createGame(input())).rejects.toMatchObject({ category: "provisioning_game_insert" });
  });

  it("classifies a game-state serialization failure as a game insert failure", async () => {
    const sql = fakeSql(() => []);
    Object.assign(sql, {
      json: () => { throw new Error("synthetic JSON serialization failure"); },
    });
    const provisioner = new PostgresGameProvisioner(sql);

    await expect(provisioner.createGame(input())).rejects.toMatchObject({ category: "provisioning_game_insert" });
  });

  it("classifies a seat insert failure", async () => {
    const provisioner = new PostgresGameProvisioner(fakeSql((statement) => {
      if (statement.includes("insert into declaration_private.games")) return [];
      throw new Error("synthetic seat insert failure");
    }));

    await expect(provisioner.createGame(input())).rejects.toMatchObject({ category: "provisioning_seat_insert" });
  });

  it("classifies an invalid returned seat expiry", async () => {
    const provisioner = new PostgresGameProvisioner(fakeSql((statement) =>
      statement.includes("insert into declaration_private.games") ? [] : [{ expires_at: "not-a-date" }],
    ));

    await expect(provisioner.createGame(input())).rejects.toMatchObject({ category: "provisioning_result_decoding" });
  });
});
