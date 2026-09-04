# Declaration private database setup

Apply the ordered SQL migrations with the Supabase direct PostgreSQL connection
(`MIGRATION_DATABASE_URL`). A fresh installation applies both the durable
transport migration and
`migrations/20260824000000_declaration_provisioner_least_privilege.sql`; the
schema remains outside Supabase's exposed API schemas.

The migration/admin responsibility remains the Supabase database owner using
the direct connection. The operator must create two non-browser login roles
through the approved Supabase/PostgreSQL administration process, then rerun
the migration (or its final grants block) after the roles exist:

- `declaration_runtime` — the transaction-pooler `DATABASE_URL` identity. It
  can read game state, only the seat columns needed for credential
  authentication/scoped views, and receipts; it can update game state/revision,
  lock seats for serialized actions, and insert idempotency receipts. It has no
  invite-hash access and no direct receipt `DELETE` privilege.
- `declaration_provisioner` — trusted server-side provisioning only. It can
  create games/seats, redeem a one-time invitation into a fresh credential,
  and rotate or revoke seat credentials, but cannot process ordinary gameplay
  receipts or update game state. It can read only `games.game_id` and the
  seat predicate/RETURNING columns required by those operations
  (`game_id`, `seat_id`, `player_id`, `invite_token_hash`,
  `credential_version`, `invite_redeemed_at`, `revoked_at`, and `expires_at`);
  it cannot read game state, cards, or `credential_hash`.

Do not use `anon`, `authenticated`, `service_role`, browser credentials, or a
Supabase Data API key for this transport. Place only the runtime transaction
pooler URI in `DATABASE_URL`; use the direct URI for the provisioner role in
`DECLARATION_PROVISIONING_DATABASE_URL`, and use a database-owner direct URI
exclusively as `MIGRATION_DATABASE_URL` for migration tooling. None belongs in
source control or a `NEXT_PUBLIC_*` variable.

## Local integration tests

`DECLARATION_TEST_DATABASE_URL` is a local-only test configuration. The suite
accepts only `localhost`, `127.0.0.1`, or `::1` connection hosts and must never
target staging or production. The local database needs the two roles above and
may be reset by `supabase db reset` before running `npm run test:postgres`.

## Receipt retention

The transport retains the newest 128 processed-action receipts per game. This
is the durable idempotency window: duplicate retries inside that window return
the original outcome; older action IDs are no longer remembered. The migration
prunes existing excess rows and the runtime calls the narrowly scoped
`declaration_private.prune_processed_action_receipts(text)` function after an
atomic receipt insert. That security-definer function has a fixed 128-row
policy, validates its game identifier, uses a fixed `search_path`, is owned by
the migration/database owner rather than the runtime role, and has default
public execution revoked. Only `declaration_runtime` receives `EXECUTE`; it
cannot directly delete receipts or use the function as a general deletion
operation.

If the durable-transport migration was already recorded in an environment, do
not rewrite its applied migration history. The database owner must apply the
included `20260824000000_declaration_provisioner_least_privilege.sql` forward
migration, after review, before deployment. The same policy applies to future
hardening changes.
