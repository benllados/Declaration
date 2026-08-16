import { TEAM_SIZE, TOTAL_PLAYERS } from "./constants/game";
import { GameDomainError } from "./errors";
import type { PlayerSetup } from "./types/player";
import { TEAM_IDS, type Team, type TeamId } from "./types/team";

export { TEAM_IDS, type Team, type TeamId } from "./types/team";

/** Validates the complete six-player, two-team game composition. */
export const validateTeamComposition = (players: readonly PlayerSetup[]): void => {
  if (players.length !== TOTAL_PLAYERS) throw new GameDomainError(`A Declaration game requires exactly ${TOTAL_PLAYERS} players.`);
  const playerIds = players.map((player) => player.id);
  if (new Set(playerIds).size !== playerIds.length) throw new GameDomainError("Each player id must be unique.");
  for (const player of players) {
    if (!TEAM_IDS.includes(player.teamId)) throw new GameDomainError(`Player ${player.id} has an invalid team assignment.`);
  }
  for (const teamId of TEAM_IDS) {
    if (players.filter((player) => player.teamId === teamId).length !== TEAM_SIZE) {
      throw new GameDomainError(`Team ${teamId} must contain exactly ${TEAM_SIZE} players.`);
    }
  }
};

export const createTeams = (players: readonly PlayerSetup[]): readonly Team[] => {
  validateTeamComposition(players);
  return Object.freeze(TEAM_IDS.map((id) => Object.freeze({
    id,
    playerIds: Object.freeze(players.filter((player) => player.teamId === id).map((player) => player.id)),
  })));
};

export const getTeam = (teams: readonly Team[], teamId: TeamId): Team | undefined => teams.find((team) => team.id === teamId);
