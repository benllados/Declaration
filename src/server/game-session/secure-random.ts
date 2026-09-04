import "server-only";

import { randomBytes } from "node:crypto";

import type { Random } from "@/game/engine/deal";

const RANDOM_BYTES = 6;
const RANDOM_RANGE = 2 ** (RANDOM_BYTES * 8);

/**
 * A cryptographically secure source for production shuffles. Six bytes fit
 * exactly within JavaScript's safe integer range and provide 48 random bits.
 */
export const secureRandom: Random = (): number =>
  randomBytes(RANDOM_BYTES).readUIntBE(0, RANDOM_BYTES) / RANDOM_RANGE;
