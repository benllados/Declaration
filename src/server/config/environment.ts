import "server-only";

const DEFAULT_SEAT_TTL_SECONDS = 60 * 60 * 24 * 7;

const nonEmpty = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/** Read only where a Node server is about to establish a database connection. */
export const getDatabaseUrl = (): string => {
  const value = nonEmpty(process.env.DATABASE_URL);
  if (value === null) throw new Error("DATABASE_URL is required for the server database connection.");
  return value;
};

/**
 * Creation, invitation redemption, and credential rotation use a separately
 * scoped direct connection. It is never exposed to browser code or used for
 * normal gameplay actions.
 */
export const getProvisioningDatabaseUrl = (): string => {
  const value = nonEmpty(process.env.DECLARATION_PROVISIONING_DATABASE_URL);
  if (value === null) throw new Error("DECLARATION_PROVISIONING_DATABASE_URL is required for game provisioning.");
  return value;
};

/** Exact origin comparison is intentional; wildcard origin policy is never valid here. */
export const getDeclarationAppOrigin = (): string => {
  const value = nonEmpty(process.env.DECLARATION_APP_ORIGIN);
  if (value === null) throw new Error("DECLARATION_APP_ORIGIN is required for game actions.");
  try {
    const url = new URL(value);
    if (url.origin !== value || (url.protocol !== "https:" && url.protocol !== "http:")) throw new Error();
    const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (url.protocol !== "https:" && !localHost) throw new Error();
    return value;
  } catch {
    throw new Error("DECLARATION_APP_ORIGIN must be an HTTPS origin (or a loopback HTTP origin) without a path.");
  }
};

/**
 * Provisioning may choose a stricter deployment value. A secure one-week
 * default keeps local/server provisioning usable without exposing a long-lived
 * credential accidentally.
 */
export const getSeatTtlSeconds = (): number => {
  const configured = nonEmpty(process.env.DECLARATION_SEAT_TTL_SECONDS);
  if (configured === null) return DEFAULT_SEAT_TTL_SECONDS;
  if (!/^[0-9]+$/.test(configured)) throw new Error("DECLARATION_SEAT_TTL_SECONDS must be a positive integer.");
  const seconds = Number(configured);
  if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > 60 * 60 * 24 * 90) {
    throw new Error("DECLARATION_SEAT_TTL_SECONDS must be between 60 seconds and 90 days.");
  }
  return seconds;
};
