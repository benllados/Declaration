import { GameDomainError } from "../errors";
import { createTeams, validateTeamComposition } from "../teams";
import type { Player, PlayerSetup } from "../types/player";
import type { Team } from "../types/team";
import { dealInitialHands, shuffleCanonicalDeck, type Random } from "./deal";

export type GameSetupInput = Readonly<{ players: readonly PlayerSetup[] }>;
export type InitialGameState = Readonly<{ players: readonly Player[]; teams: readonly Team[] }>;

export const validateGameSetup = (input: GameSetupInput): void => {
  if (!input || !Array.isArray(input.players)) throw new GameDomainError("Game setup must include a players array.");
  validateTeamComposition(input.players);
};

export const initializeGame = (input: GameSetupInput, random: Random = Math.random): InitialGameState => {
  validateGameSetup(input);
  const hands = dealInitialHands(input.players.map((player) => player.id), shuffleCanonicalDeck(random));
  return Object.freeze({
    players: Object.freeze(input.players.map((player) => Object.freeze({ ...player, hand: hands.get(player.id)! }))),
    teams: createTeams(input.players),
  });
};
