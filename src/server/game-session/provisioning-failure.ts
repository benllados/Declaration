import "server-only";

export type ProvisioningFailureCategory =
  | "provisioning_database_authentication"
  | "provisioning_database_permission"
  | "provisioning_database_schema"
  | "provisioning_database_connection"
  | "provisioning_configuration"
  | "provisioning_input_validation"
  | "provisioning_transaction_start"
  | "provisioning_game_insert"
  | "provisioning_seat_insert"
  | "provisioning_result_decoding"
  | "provisioning_failed";

const PROVISIONING_AUTHENTICATION_CODES: ReadonlySet<string> = new Set(["28000", "28P01"]);
const PROVISIONING_PERMISSION_CODES: ReadonlySet<string> = new Set(["42501"]);
const PROVISIONING_SCHEMA_CODES: ReadonlySet<string> = new Set(["3F000", "42P01", "42703"]);
const PROVISIONING_CONNECTION_CODES: ReadonlySet<string> = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECTION_ENDED",
  "EAI_AGAIN",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
]);

const errorObject = (value: unknown): object | null =>
  typeof value === "object" && value !== null ? value : null;

const readStringProperty = (value: object, property: string): string | null => {
  try {
    const candidate = Reflect.get(value, property);
    return typeof candidate === "string" ? candidate : null;
  } catch {
    return null;
  }
};

const readCause = (value: object): unknown => {
  try {
    return Reflect.get(value, "cause");
  } catch {
    return null;
  }
};

const categoryForCode = (code: string): ProvisioningFailureCategory | null => {
  if (PROVISIONING_AUTHENTICATION_CODES.has(code)) return "provisioning_database_authentication";
  if (PROVISIONING_PERMISSION_CODES.has(code)) return "provisioning_database_permission";
  if (PROVISIONING_SCHEMA_CODES.has(code)) return "provisioning_database_schema";
  if (PROVISIONING_CONNECTION_CODES.has(code)) return "provisioning_database_connection";
  return null;
};

/** A safe diagnostic value that intentionally never retains the original error. */
export class ProvisioningFailure extends Error {
  constructor(readonly category: ProvisioningFailureCategory) {
    super(category);
    this.name = "ProvisioningFailure";
  }
}

/**
 * Postgres.js errors expose `code` directly, while runtime adapters can wrap
 * those errors in an Error `cause`. Inspect only the bounded code chain.
 */
export const classifyProvisioningFailure = (error: unknown): ProvisioningFailureCategory => {
  const seen = new Set<object>();
  let candidate: unknown = error;

  for (let depth = 0; depth < 4; depth += 1) {
    if (candidate instanceof ProvisioningFailure) return candidate.category;
    const object = errorObject(candidate);
    if (object === null || seen.has(object)) break;
    seen.add(object);

    const category = categoryForCode(readStringProperty(object, "code") ?? "");
    if (category !== null) return category;
    candidate = readCause(object);
  }

  return "provisioning_failed";
};

/** Converts an unknown failure to a stage category without retaining its details. */
export const toProvisioningFailure = (
  error: unknown,
  fallbackCategory: Exclude<ProvisioningFailureCategory, "provisioning_failed">,
): ProvisioningFailure => {
  if (error instanceof ProvisioningFailure) return error;
  const category = classifyProvisioningFailure(error);
  return new ProvisioningFailure(category === "provisioning_failed" ? fallbackCategory : category);
};
