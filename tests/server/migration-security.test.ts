import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationPath = new URL("../../supabase/migrations/20260818000000_declaration_durable_transport.sql", import.meta.url);
const provisionerForwardMigrationPath = new URL(
  "../../supabase/migrations/20260824000000_declaration_provisioner_least_privilege.sql",
  import.meta.url,
);

describe("durable transport migration privileges", () => {
  it("uses narrow runtime seat access and a constrained receipt-pruning function", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("grant select (game_id, seat_id, player_id, credential_hash, revoked_at, expires_at)");
    expect(migration).not.toMatch(/grant select on declaration_private\.game_seats to declaration_runtime/i);
    expect(migration).not.toMatch(/grant delete on declaration_private\.processed_action_receipts to declaration_runtime/i);
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = pg_catalog, declaration_private");
    expect(migration).toContain("owner to current_user");
    expect(migration).toContain("revoke all on function declaration_private.prune_processed_action_receipts(text) from public");
    expect(migration).toContain("grant execute on function declaration_private.prune_processed_action_receipts(text) to declaration_runtime");
    expect(migration).toContain("retention_rank > 128");
  });

  it("limits provisioner reads to the columns required by its SQL in fresh and forward migrations", async () => {
    const migrations = await Promise.all([
      readFile(migrationPath, "utf8"),
      readFile(provisionerForwardMigrationPath, "utf8"),
    ]);
    const expectedGameGrant = "grant select (game_id), insert on declaration_private.games to declaration_provisioner";
    const expectedSeatGrant = "grant select (game_id, seat_id, player_id, invite_token_hash, credential_version, invite_redeemed_at, revoked_at, expires_at), insert";

    for (const migration of migrations) {
      const provisionerBlock = migration.slice(migration.indexOf("declaration_provisioner"));
      expect(migration).toContain(expectedGameGrant);
      expect(migration).toContain(expectedSeatGrant);
      expect(provisionerBlock).not.toMatch(/grant select on declaration_private\.games to declaration_provisioner/i);
      expect(provisionerBlock).not.toMatch(/grant select on declaration_private\.game_seats to declaration_provisioner/i);
      expect(provisionerBlock).not.toMatch(/grant select\s*\([^)]*credential_hash/i);
      expect(provisionerBlock).not.toMatch(/grant select\s*\([^)]*state/i);
    }
  });
});
