-- Forward-only least-privilege correction for installations that already
-- recorded the durable transport migration before provisioner read narrowing.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'declaration_provisioner') then
    revoke all on all tables in schema declaration_private from declaration_provisioner;
    grant usage on schema declaration_private to declaration_provisioner;

    -- Provisioner game-row locks select only the identifier.
    grant select (game_id), insert on declaration_private.games to declaration_provisioner;
    grant update (updated_at) on declaration_private.games to declaration_provisioner;

    -- These are the only predicate/expression/RETURNING columns used by
    -- provisioning, redemption, rotation, and revocation. credential_hash
    -- remains write-only for this role.
    grant select (game_id, seat_id, player_id, invite_token_hash, credential_version, invite_redeemed_at, revoked_at, expires_at), insert
      on declaration_private.game_seats to declaration_provisioner;
    grant update (credential_hash, credential_version, rotated_at, revoked_at, expires_at, invite_redeemed_at)
      on declaration_private.game_seats to declaration_provisioner;
  end if;
end $$;
