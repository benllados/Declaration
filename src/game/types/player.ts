import type { CardId } from "./card";
import type { TeamId } from "./team";

/** A stable, serializable identifier owned by the game domain. */
export type PlayerId = string & { readonly __brand: "PlayerId" };

export const createPlayerId = (value: string): PlayerId => {
  if (value.trim().length === 0) throw new Error("Player id must not be empty.");
  return value as PlayerId;
};

/** Card ids are kept separately from immutable card definitions. */
export type Hand = readonly CardId[];

export type Player = Readonly<{ id: PlayerId; displayName: string; teamId: TeamId; hand: Hand }>;
export type PlayerSetup = Readonly<{ id: PlayerId; displayName: string; teamId: TeamId }>;
