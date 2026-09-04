import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const CREDENTIAL_BYTES = 32;

export const getSeatCookieName = (gameId: string): string => `declaration-seat-${gameId}`;

/** Generates an unguessable browser credential. It is never persisted raw. */
export const generateSeatCredential = (): string => randomBytes(CREDENTIAL_BYTES).toString("base64url");

/**
 * A one-time invite is intentionally distinct from the long-lived credential
 * placed in the browser cookie after redemption.
 */
export const generateSeatInviteToken = (): string => randomBytes(CREDENTIAL_BYTES).toString("base64url");

/** Hashes the raw base64url credential exactly once at the server boundary. */
export const hashSeatCredential = (credential: string): Buffer =>
  createHash("sha256").update(credential, "utf8").digest();

/** Constant-time helper useful for in-memory/test adapters; PostgreSQL compares hashes server-side. */
export const credentialsMatch = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && timingSafeEqual(left, right);

export const getSeatCookieOptions = (gameId: string, expiresAt: Date) => ({
  httpOnly: true,
  sameSite: "strict" as const,
  path: `/api/games/${gameId}`,
  secure: process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test",
  expires: expiresAt,
  priority: "high" as const,
});
