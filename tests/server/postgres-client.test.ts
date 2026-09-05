import { afterEach, describe, expect, it, vi } from "vitest";

const postgresFactory = vi.hoisted(() => vi.fn(() => ({})));

vi.mock("postgres", () => ({ default: postgresFactory }));

import { getPostgresClient, getProvisioningPostgresClient } from "../../src/server/db/postgres";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Supabase pooler PostgreSQL clients", () => {
  it("requires encrypted TLS and never permits plaintext", () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://declaration_runtime.project_ref:synthetic@localhost:6543/postgres",
    );
    vi.stubEnv(
      "DECLARATION_PROVISIONING_DATABASE_URL",
      "postgresql://declaration_provisioner.project_ref:synthetic@localhost:6543/postgres",
    );

    getPostgresClient();
    getProvisioningPostgresClient();

    expect(postgresFactory).toHaveBeenNthCalledWith(1, expect.any(String), {
      ssl: "require",
      prepare: false,
      max: 3,
      idle_timeout: 10,
      connect_timeout: 5,
    });
    expect(postgresFactory).toHaveBeenNthCalledWith(2, expect.any(String), {
      ssl: "require",
      prepare: false,
      max: 1,
      idle_timeout: 10,
      connect_timeout: 5,
    });
    expect(postgresFactory.mock.calls.map(([, options]) => options)).not.toContainEqual(expect.objectContaining({ ssl: false }));
  });
});
