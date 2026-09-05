import { afterEach, describe, expect, it, vi } from "vitest";

const postgresFactory = vi.hoisted(() => vi.fn(() => ({})));

vi.mock("postgres", () => ({ default: postgresFactory }));

import { getProvisioningPostgresClient } from "../../src/server/db/postgres";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("provisioning PostgreSQL client", () => {
  it("requires verified TLS while preserving session-pooler transaction settings", () => {
    vi.stubEnv(
      "DECLARATION_PROVISIONING_DATABASE_URL",
      "postgresql://declaration_provisioner.project_ref:synthetic@localhost:5432/postgres",
    );

    getProvisioningPostgresClient();

    expect(postgresFactory).toHaveBeenCalledWith(expect.any(String), {
      ssl: { rejectUnauthorized: true },
      prepare: false,
      max: 1,
      idle_timeout: 10,
      connect_timeout: 5,
    });
  });
});
