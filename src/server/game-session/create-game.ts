import "server-only";

import { randomBytes } from "node:crypto";

import { initializeNormalPlayGame } from "@/game/engine/setup";
import type { Random } from "@/game/engine/deal";
import { createPlayerId, type PlayerSetup } from "@/game/types/player";

import type { PostgresGameProvisioner } from "./provisioning";
import { secureRandom } from "./secure-random";

const PLAYER_COUNT = 6;
const TEAM_SIZE = 3;
const MAX_DISPLAY_NAME_LENGTH = 32;

export class CreateGameValidationError extends Error {
  constructor() {
    super("Game creation request is invalid.");
  }
}

export type CreatedGame = Readonly<{
  gameId: string;
  invitations: readonly Readonly<{
    displayName: string;
    inviteToken: string;
  }>[];
}>;

type GameProvisioner = Pick<PostgresGameProvisioner, "createGame">;

const createOpaqueId = (prefix: string): string => `${prefix}-${randomBytes(18).toString("base64url")}`;

const decodePlayerNames = (value: unknown): readonly string[] => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1) {
    throw new CreateGameValidationError();
  }
  const playerNames = (value as Record<string, unknown>).playerNames;
  if (!Array.isArray(playerNames) || playerNames.length !== PLAYER_COUNT) throw new CreateGameValidationError();

  const names = playerNames.map((name) => typeof name === "string" ? name.trim() : "");
  if (
    names.some((name) => name.length === 0 || name.length > MAX_DISPLAY_NAME_LENGTH || /[\u0000-\u001F\u007F]/.test(name))
    || new Set(names.map((name) => name.toLocaleLowerCase())).size !== PLAYER_COUNT
  ) {
    throw new CreateGameValidationError();
  }
  return Object.freeze(names);
};

/**
 * Creates the initial six-seat deal. Team assignment is deliberately explicit
 * and stable: the first three names are Team A and the final three Team B.
 */
export const createPublicGame = async (
  input: unknown,
  dependencies: Readonly<{ provisioner: GameProvisioner; random?: Random }>,
): Promise<CreatedGame> => {
  const names = decodePlayerNames(input);
  const gameId = createOpaqueId("game");
  const players: readonly PlayerSetup[] = Object.freeze(names.map((displayName, index) => Object.freeze({
    id: createPlayerId(createOpaqueId("player")),
    displayName,
    teamId: index < TEAM_SIZE ? "TEAM_A" : "TEAM_B",
  })));
  const seats = players.map((player) => Object.freeze({
    seatId: createOpaqueId("seat"),
    playerId: player.id,
  }));
  const state = initializeNormalPlayGame({ players, initialTurnOwner: players[0].id }, dependencies.random ?? secureRandom);
  const provisioned = await dependencies.provisioner.createGame({ gameId, state, seats });
  const namesByPlayerId = new Map(players.map((player) => [player.id, player.displayName]));

  return Object.freeze({
    gameId,
    invitations: Object.freeze(provisioned.seats.map((seat) => Object.freeze({
      displayName: namesByPlayerId.get(seat.playerId) ?? "Player",
      inviteToken: seat.inviteToken,
    }))),
  });
};
