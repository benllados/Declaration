import type { PlayerId } from "@/game/types/player";

/**
 * Trusted context supplied by a future authentication adapter. It is never
 * decoded from an action body and is the sole source of acting-player identity.
 */
export type SeatIdentity = Readonly<{
  seatId: string;
  gameId: string;
  playerId: PlayerId;
}>;
