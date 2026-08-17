import type { AuthoritativeTimestamp } from "@/game/types/declaration";

/** Supplies the engine's existing seconds-based authoritative timestamp. */
export type ServerClock = Readonly<{
  now: () => AuthoritativeTimestamp;
}>;
