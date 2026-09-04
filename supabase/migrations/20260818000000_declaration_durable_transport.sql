-- Build 13 authoritative transport. This schema is intentionally not added to
-- Supabase's exposed API schemas: browser roles have no privileges here.
create schema if not exists declaration_private;

revoke all on schema declaration_private from public;

create table if not exists declaration_private.games (
  game_id text primary key,
  engine_version text not null,
  revision bigint not null,
  state jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint declaration_games_identifier_check
    check (game_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  constraint declaration_games_engine_version_check
    check (engine_version = 'declaration-v1'),
  constraint declaration_games_safe_revision_check
    check (revision between 0 and 9007199254740991),
  constraint declaration_games_state_object_check
    check (jsonb_typeof(state) = 'object')
);

create table if not exists declaration_private.game_seats (
  seat_id text primary key,
  game_id text not null references declaration_private.games(game_id) on delete cascade,
  player_id text not null,
  credential_hash bytea not null,
  invite_token_hash bytea not null,
  credential_version integer not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  rotated_at timestamptz,
  revoked_at timestamptz,
  invite_redeemed_at timestamptz,
  expires_at timestamptz not null,
  constraint declaration_game_seats_identifier_check
    check (
      seat_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
      and game_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
      and player_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    ),
  constraint declaration_game_seats_credential_hash_check
    check (octet_length(credential_hash) = 32),
  constraint declaration_game_seats_invite_token_hash_check
    check (octet_length(invite_token_hash) = 32),
  constraint declaration_game_seats_credential_version_check
    check (credential_version > 0),
  constraint declaration_game_seats_expiry_check
    check (expires_at > created_at),
  constraint declaration_game_seats_game_player_unique unique (game_id, player_id),
  constraint declaration_game_seats_game_seat_unique unique (game_id, seat_id),
  constraint declaration_game_seats_game_hash_unique unique (game_id, credential_hash),
  constraint declaration_game_seats_game_invite_unique unique (game_id, invite_token_hash)
);

create table if not exists declaration_private.processed_action_receipts (
  game_id text not null,
  seat_id text not null,
  action_id text not null,
  status text not null,
  outcome jsonb not null,
  resulting_revision bigint not null,
  processed_at timestamptz not null default clock_timestamp(),
  primary key (game_id, seat_id, action_id),
  constraint declaration_receipts_seat_fk
    foreign key (game_id, seat_id)
    references declaration_private.game_seats(game_id, seat_id)
    on delete cascade,
  constraint declaration_receipts_identifier_check
    check (
      game_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
      and seat_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
      and action_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    ),
  constraint declaration_receipts_status_check
    check (status in ('APPLIED', 'REJECTED')),
  constraint declaration_receipts_outcome_object_check
    check (jsonb_typeof(outcome) = 'object'),
  constraint declaration_receipts_safe_revision_check
    check (resulting_revision between 0 and 9007199254740991)
);

drop index if exists declaration_private.declaration_receipts_processed_at_idx;

create index declaration_receipts_processed_at_idx
  on declaration_private.processed_action_receipts (game_id, processed_at desc, seat_id desc, action_id desc);

-- Retain only the most recent 128 action receipts for each game. This bounds
-- storage and defines the durable idempotency retry window.
with ranked_receipts as (
  select ctid,
         row_number() over (
           partition by game_id
           order by processed_at desc, seat_id desc, action_id desc
         ) as retention_rank
  from declaration_private.processed_action_receipts
)
delete from declaration_private.processed_action_receipts as receipts
using ranked_receipts
where receipts.ctid = ranked_receipts.ctid
  and ranked_receipts.retention_rank > 128;

-- The runtime can invoke this only after it has atomically appended a receipt.
-- It always retains the newest 128 rows and cannot act as general DELETE.
-- The migration must run as the database owner, which remains the function owner.
create or replace function declaration_private.prune_processed_action_receipts(target_game_id text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, declaration_private
as $$
begin
  if target_game_id is null
     or target_game_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' then
    raise exception 'invalid game identifier';
  end if;

  with ranked_receipts as (
    select ctid,
           row_number() over (
             order by processed_at desc, seat_id desc, action_id desc
           ) as retention_rank
    from declaration_private.processed_action_receipts
    where game_id = target_game_id
  )
  delete from declaration_private.processed_action_receipts as receipts
  using ranked_receipts
  where receipts.ctid = ranked_receipts.ctid
    and ranked_receipts.retention_rank > 128;
end;
$$;

alter function declaration_private.prune_processed_action_receipts(text) owner to current_user;
revoke all on function declaration_private.prune_processed_action_receipts(text) from public;

-- RLS is not the trust boundary. These tables are server-only and use explicit
-- role privileges; they remain outside every Supabase Data API schema.
alter table declaration_private.games disable row level security;
alter table declaration_private.game_seats disable row level security;
alter table declaration_private.processed_action_receipts disable row level security;

-- No browser, API, or implicit public access.
do $$
declare
  restricted_role text;
begin
  foreach restricted_role in array array['anon', 'authenticated', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = restricted_role) then
      execute format('revoke all on schema declaration_private from %I', restricted_role);
      execute format('revoke all on all tables in schema declaration_private from %I', restricted_role);
    end if;
  end loop;
end $$;

-- Custom roles are deliberately created by the operator, not this migration.
-- Apply these grants if the roles already exist; see supabase/README.md.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'declaration_runtime') then
    revoke all on all tables in schema declaration_private from declaration_runtime;
    revoke all on function declaration_private.prune_processed_action_receipts(text) from declaration_runtime;
    grant usage on schema declaration_private to declaration_runtime;
    grant select (game_id, engine_version, revision, state) on declaration_private.games to declaration_runtime;
    grant update (state, revision, updated_at) on declaration_private.games to declaration_runtime;
    grant select (game_id, seat_id, player_id, credential_hash, revoked_at, expires_at)
      on declaration_private.game_seats to declaration_runtime;
    -- A column-level UPDATE grant is required for SELECT ... FOR UPDATE. The
    -- runtime never changes seat metadata, credentials, expiry, or revocation.
    grant update (rotated_at) on declaration_private.game_seats to declaration_runtime;
    grant select, insert on declaration_private.processed_action_receipts to declaration_runtime;
    grant execute on function declaration_private.prune_processed_action_receipts(text) to declaration_runtime;
  end if;

  if exists (select 1 from pg_roles where rolname = 'declaration_provisioner') then
    revoke all on all tables in schema declaration_private from declaration_provisioner;
    grant usage on schema declaration_private to declaration_provisioner;
    -- Provisioning locks a game by identifier only; state and cards remain
    -- unreadable to this role.
    grant select (game_id), insert on declaration_private.games to declaration_provisioner;
    -- Enables the deterministic game-row lock used before seat rotation.
    grant update (updated_at) on declaration_private.games to declaration_provisioner;
    -- Required by provisioning UPDATE predicates/expressions and RETURNING:
    -- game_id, seat_id, player_id, invite_token_hash, credential_version,
    -- invite_redeemed_at, revoked_at, and expires_at. credential_hash is
    -- write-only here; runtime credential hashes are never readable.
    grant select (game_id, seat_id, player_id, invite_token_hash, credential_version, invite_redeemed_at, revoked_at, expires_at), insert
      on declaration_private.game_seats to declaration_provisioner;
    grant update (credential_hash, credential_version, rotated_at, revoked_at, expires_at, invite_redeemed_at)
      on declaration_private.game_seats to declaration_provisioner;
  end if;
end $$;
