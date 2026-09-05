import "server-only";

export type ProvisioningFailureCategory =
  | "provisioning_authentication"
  | "provisioning_tls"
  | "provisioning_dns"
  | "provisioning_connection_refused"
  | "provisioning_timeout"
  | "provisioning_database_authorization"
  | "provisioning_configuration"
  | "provisioning_input_validation"
  | "provisioning_transaction_start_unknown"
  | "provisioning_game_insert"
  | "provisioning_seat_insert"
  | "provisioning_result_decoding";

const PROVISIONING_AUTHENTICATION_CODES: ReadonlySet<string> = new Set([
  "28000",
  "28P01",
  "AUTH_TYPE_NOT_IMPLEMENTED",
  "SASL_SIGNATURE_MISMATCH",
]);
const PROVISIONING_TLS_CODES: ReadonlySet<string> = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);
const PROVISIONING_DNS_CODES: ReadonlySet<string> = new Set([
  "EAI_AGAIN",
  "EAI_FAIL",
  "ENOTFOUND",
]);
const PROVISIONING_TIMEOUT_CODES: ReadonlySet<string> = new Set([
  "CONNECT_TIMEOUT",
  "ERR_SOCKET_CONNECTION_TIMEOUT",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
]);
const MAX_ERROR_NODES = 16;
const MAX_NESTED_ERRORS = 8;

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

const readNestedErrors = (value: object): readonly unknown[] => {
  if (Array.isArray(value)) return value.slice(0, MAX_NESTED_ERRORS);
  try {
    const errors = Reflect.get(value, "errors");
    return Array.isArray(errors) ? errors.slice(0, MAX_NESTED_ERRORS) : [];
  } catch {
    return [];
  }
};

const categoryForCode = (code: string): ProvisioningFailureCategory | null => {
  if (PROVISIONING_AUTHENTICATION_CODES.has(code)) return "provisioning_authentication";
  if (PROVISIONING_TLS_CODES.has(code) || code.startsWith("ERR_TLS_") || code.startsWith("ERR_SSL_")) {
    return "provisioning_tls";
  }
  if (PROVISIONING_DNS_CODES.has(code)) return "provisioning_dns";
  if (code === "ECONNREFUSED") return "provisioning_connection_refused";
  if (PROVISIONING_TIMEOUT_CODES.has(code)) return "provisioning_timeout";
  if (code === "42501") return "provisioning_database_authorization";
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
 * Postgres.js errors expose `code` directly. Node can group network failures
 * under an AggregateError or nested `errors` arrays, and adapters can add a
 * `cause`; inspect only a bounded graph of codes.
 */
const findProvisioningFailureCategory = (error: unknown): ProvisioningFailureCategory | null => {
  const seen = new Set<object>();
  const candidates: unknown[] = [error];

  while (candidates.length > 0 && seen.size < MAX_ERROR_NODES) {
    const candidate = candidates.shift();
    if (candidate instanceof ProvisioningFailure) return candidate.category;
    const object = errorObject(candidate);
    if (object === null || seen.has(object)) continue;
    seen.add(object);

    const category = categoryForCode(readStringProperty(object, "code") ?? "");
    if (category !== null) return category;
    candidates.push(readCause(object), ...readNestedErrors(object));
  }

  return null;
};

/** Classifies an error without exposing its code, message, or nested values. */
export const classifyProvisioningFailure = (error: unknown): ProvisioningFailureCategory =>
  findProvisioningFailureCategory(error) ?? "provisioning_transaction_start_unknown";

/** Converts an unknown failure to a stage category without retaining its details. */
export const toProvisioningFailure = (
  error: unknown,
  fallbackCategory: ProvisioningFailureCategory,
): ProvisioningFailure => {
  if (error instanceof ProvisioningFailure) return error;
  return new ProvisioningFailure(findProvisioningFailureCategory(error) ?? fallbackCategory);
};
