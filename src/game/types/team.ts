import type { PlayerId } from "./player";

export const TEAM_IDS = ["TEAM_A", "TEAM_B"] as const;
export type TeamId = (typeof TEAM_IDS)[number];
export type Team = Readonly<{ id: TeamId; playerIds: readonly PlayerId[] }>;

export const isTeamId = (value: unknown): value is TeamId =>
  typeof value === "string" && (TEAM_IDS as readonly string[]).includes(value);
