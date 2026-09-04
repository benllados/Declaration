import "server-only";

import type { NormalPlayGameState } from "@/game/engine/normal-play";
import type { PlayerId } from "@/game/types/player";
import { isOpaqueId } from "@/lib/multiplayer/action-codec";
import type { Sql } from "postgres";

import { getSeatTtlSeconds } from "@/server/config/environment";
import { GameSessionAccessError } from "./errors";
import {
  generateSeatCredential,
  generateSeatInviteToken,
  hashSeatCredential,
} from "./seat-credentials";
import { decodeStoredGameRecord, ENGINE_VERSION } from "./stored-record";

export type ProvisionedSeat = Readonly<{
  seatId: string;
  playerId: PlayerId;
  /** Trusted creation output only; this becomes invalid after its first redemption. */
  inviteToken: string;
  expiresAt: Date;
}>;

/** The short-lived raw credential returned only from trusted invite redemption. */
export type RedeemedSeatCredential = Readonly<{
  seatId: string;
  playerId: PlayerId;
  credential: string;
  expiresAt: Date;
}>;

export type GameProvisioningInput = Readonly<{
  gameId: string;
  state: NormalPlayGameState;
  seats: readonly Readonly<{ seatId: string; playerId: PlayerId }>[];
  seatTtlSeconds?: number;
}>;

const asDate = (value: unknown): Date => {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error("Provisioning database returned an invalid seat expiry.");
  return date;
};

const validateTtl = (ttl: number): number => {
  if (!Number.isSafeInteger(ttl) || ttl < 60 || ttl > 60 * 60 * 24 * 90) {
    throw new Error("Seat TTL must be between 60 seconds and 90 days.");
  }
  return ttl;
};

const validateInput = (input: GameProvisioningInput): void => {
  if (!isOpaqueId(input.gameId) || input.seats.length !== 6) throw new Error("A game and exactly six valid seats are required.");
  const decoded = decodeStoredGameRecord({
    gameId: input.gameId,
    engineVersion: ENGINE_VERSION,
    revision: 0,
    state: input.state,
    processedActions: [],
  });
  if (!decoded.ok) throw new Error("Initial game state is invalid.");
  const statePlayerIds = decoded.value.state.players.map((player) => player.id).sort();
  const seatPlayerIds = input.seats.map((seat) => seat.playerId).sort();
  if (
    input.seats.some((seat) => !isOpaqueId(seat.seatId) || !isOpaqueId(seat.playerId))
    || new Set(input.seats.map((seat) => seat.seatId)).size !== 6
    || new Set(seatPlayerIds).size !== 6
    || JSON.stringify(statePlayerIds) !== JSON.stringify(seatPlayerIds)
  ) {
    throw new Error("Seats must map each game player exactly once.");
  }
};

/**
 * Server-only provisioning boundary. Supply a connection authenticated as the
 * narrowly privileged `declaration_provisioner` role; it is intentionally not
 * used by normal gameplay runtime code.
 */
export class PostgresGameProvisioner {
  constructor(private readonly sql: Sql) {}

  async createGame(input: GameProvisioningInput): Promise<Readonly<{ gameId: string; seats: readonly ProvisionedSeat[] }>> {
    validateInput(input);
    const ttl = validateTtl(input.seatTtlSeconds ?? getSeatTtlSeconds());
    // Initial credential hashes are deliberately unusable: redemption rotates
    // them to a new secret that has never appeared in an invite URL.
    const credentialHashes = input.seats.map(() => hashSeatCredential(generateSeatCredential()));
    const inviteTokens = input.seats.map(generateSeatInviteToken);
    const inviteHashes = inviteTokens.map(hashSeatCredential);

    return (await this.sql.begin(async (transactionSql) => {
      // See postgres-repository: the runtime transaction is a callable SQL tag.
      const sql = transactionSql as unknown as Sql;
      await sql`
        insert into declaration_private.games (game_id, engine_version, revision, state)
        values (${input.gameId}, ${ENGINE_VERSION}, 0, ${sql.json(input.state)})
      `;
      const seats: ProvisionedSeat[] = [];
      for (const [index, seat] of input.seats.entries()) {
        const rows = await sql<Readonly<{ expires_at: unknown }[]> >`
          insert into declaration_private.game_seats
            (seat_id, game_id, player_id, credential_hash, invite_token_hash, credential_version, expires_at)
          values
            (${seat.seatId}, ${input.gameId}, ${seat.playerId}, ${credentialHashes[index]}, ${inviteHashes[index]}, 1,
             clock_timestamp() + (${ttl} * interval '1 second'))
          returning expires_at
        `;
        seats.push({
          seatId: seat.seatId,
          playerId: seat.playerId,
          inviteToken: inviteTokens[index],
          expiresAt: asDate(rows[0]?.expires_at),
        });
      }
      return { gameId: input.gameId, seats };
    })) as Readonly<{ gameId: string; seats: readonly ProvisionedSeat[] }>;
  }

  async redeemInvitation(
    gameId: string,
    inviteToken: string,
  ): Promise<RedeemedSeatCredential> {
    if (!isOpaqueId(gameId) || !/^[A-Za-z0-9_-]{43}$/.test(inviteToken)) {
      throw new GameSessionAccessError();
    }
    const credential = generateSeatCredential();
    const credentialHash = hashSeatCredential(credential);
    const inviteHash = hashSeatCredential(inviteToken);

    return (await this.sql.begin(async (transactionSql) => {
      const sql = transactionSql as unknown as Sql;
      // Lock order always starts with the game, matching normal gameplay and rotation.
      const games = await sql<Readonly<{ game_id: unknown }[]> >`
        select game_id from declaration_private.games where game_id = ${gameId} for update
      `;
      if (games.length !== 1) throw new GameSessionAccessError();
      const rows = await sql<Readonly<{ seat_id: unknown; player_id: unknown; expires_at: unknown }[]> >`
        update declaration_private.game_seats
        set credential_hash = ${credentialHash},
            credential_version = credential_version + 1,
            rotated_at = clock_timestamp(),
            invite_redeemed_at = clock_timestamp()
        where game_id = ${gameId}
          and invite_token_hash = ${inviteHash}
          and invite_redeemed_at is null
          and revoked_at is null
          and expires_at > clock_timestamp()
        returning seat_id, player_id, expires_at
      `;
      const seat = rows[0];
      if (seat === undefined || !isOpaqueId(seat.seat_id) || !isOpaqueId(seat.player_id)) {
        throw new GameSessionAccessError();
      }
      return {
        seatId: seat.seat_id,
        playerId: seat.player_id as PlayerId,
        credential,
        expiresAt: asDate(seat.expires_at),
      };
    })) as RedeemedSeatCredential;
  }

  async rotateCredential(
    gameId: string,
    seatId: string,
    seatTtlSeconds = getSeatTtlSeconds(),
  ): Promise<RedeemedSeatCredential> {
    if (!isOpaqueId(gameId) || !isOpaqueId(seatId)) throw new Error("Invalid game or seat identifier.");
    const ttl = validateTtl(seatTtlSeconds);
    const credential = generateSeatCredential();
    const credentialHash = hashSeatCredential(credential);
    return (await this.sql.begin(async (transactionSql) => {
      const sql = transactionSql as unknown as Sql;
      // The game lock always precedes the seat lock, matching gameplay order.
      const games = await sql<Readonly<{ game_id: unknown }[]> >`
        select game_id from declaration_private.games where game_id = ${gameId} for update
      `;
      if (games.length !== 1) throw new Error("Game is unavailable for provisioning.");
      const rows = await sql<Readonly<{ player_id: unknown; expires_at: unknown }[]> >`
        update declaration_private.game_seats
        set credential_hash = ${credentialHash},
            credential_version = credential_version + 1,
            rotated_at = clock_timestamp(),
            revoked_at = null,
            expires_at = clock_timestamp() + (${ttl} * interval '1 second')
        where game_id = ${gameId} and seat_id = ${seatId}
        returning player_id, expires_at
      `;
      const seat = rows[0];
      if (seat === undefined || !isOpaqueId(seat.player_id)) throw new Error("Seat is unavailable for provisioning.");
      return { seatId, playerId: seat.player_id as PlayerId, credential, expiresAt: asDate(seat.expires_at) };
    })) as RedeemedSeatCredential;
  }

  async revokeCredential(gameId: string, seatId: string): Promise<void> {
    if (!isOpaqueId(gameId) || !isOpaqueId(seatId)) throw new Error("Invalid game or seat identifier.");
    await this.sql.begin(async (transactionSql) => {
      const sql = transactionSql as unknown as Sql;
      const games = await sql<Readonly<{ game_id: unknown }[]> >`
        select game_id from declaration_private.games where game_id = ${gameId} for update
      `;
      if (games.length !== 1) throw new Error("Game is unavailable for provisioning.");
      const rows = await sql`
        update declaration_private.game_seats
        set revoked_at = clock_timestamp()
        where game_id = ${gameId} and seat_id = ${seatId} and revoked_at is null
        returning seat_id
      `;
      if (rows.length !== 1) throw new Error("Seat is unavailable for provisioning.");
    });
  }
}
