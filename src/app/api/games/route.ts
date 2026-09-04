import { type NextRequest } from "next/server";

import { getDeclarationAppOrigin } from "@/server/config/environment";
import { CreateGameValidationError, createPublicGame } from "@/server/game-session/create-game";
import { RateLimitConfigurationError, RateLimitUnavailableError } from "@/server/game-session/errors";
import { gameJson, rateLimited, readLimitedJson, toSafeGameErrorResponse } from "@/server/game-session/http";
import { getGameProvisioningRuntime } from "@/server/game-session/provisioning-runtime";
import {
  limitRequestSource,
  SOURCE_GAME_CREATION_RATE_LIMIT,
} from "@/server/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CREATE_BODY_BYTES = 4 * 1024;

const isJsonContentType = (value: string | null): boolean =>
  value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";

type ProvisioningFailureCategory =
  | "provisioning_database_authentication"
  | "provisioning_database_permission"
  | "provisioning_database_schema"
  | "provisioning_database_connection"
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

const getErrorCode = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
};

const classifyProvisioningFailure = (error: unknown): ProvisioningFailureCategory => {
  const code = getErrorCode(error);

  if (code !== null) {
    if (PROVISIONING_AUTHENTICATION_CODES.has(code)) return "provisioning_database_authentication";
    if (PROVISIONING_PERMISSION_CODES.has(code)) return "provisioning_database_permission";
    if (PROVISIONING_SCHEMA_CODES.has(code)) return "provisioning_database_schema";
    if (PROVISIONING_CONNECTION_CODES.has(code)) return "provisioning_database_connection";
  }

  return "provisioning_failed";
};

const logProvisioningFailure = (error: unknown): void => {
  console.error({ category: classifyProvisioningFailure(error) });
};

const logRateLimitFailure = (error: unknown): void => {
  if (error instanceof RateLimitConfigurationError) {
    console.error({ category: "rate_limit_configuration" });
  } else if (error instanceof RateLimitUnavailableError) {
    console.error({ category: "rate_limit_unavailable" });
  }
};

/** Creates a fresh six-seat game and returns its one-time invitation tokens. */
export const POST = async (request: NextRequest): Promise<Response> => {
  try {
    const decision = await limitRequestSource(request, SOURCE_GAME_CREATION_RATE_LIMIT);
    if (!decision.allowed) return rateLimited(decision.retryAfterSeconds);
  } catch (error) {
    logRateLimitFailure(error);
    return toSafeGameErrorResponse(error);
  }
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return gameJson({ code: "UNSUPPORTED_MEDIA_TYPE" }, 415);
  }
  try {
    if (request.headers.get("origin") !== getDeclarationAppOrigin()) {
      return gameJson({ code: "FORBIDDEN" }, 403);
    }
  } catch (error) {
    return toSafeGameErrorResponse(error);
  }
  const parsed = await readLimitedJson(request, MAX_CREATE_BODY_BYTES);
  if (!parsed.ok) return gameJson({ code: parsed.status === 413 ? "PAYLOAD_TOO_LARGE" : "VALIDATION_ERROR" }, parsed.status);

  try {
    const game = await createPublicGame(parsed.value, getGameProvisioningRuntime());
    return gameJson({
      gameId: game.gameId,
      invitations: game.invitations.map((invitation) => ({
        displayName: invitation.displayName,
        // Fragments are never sent in an HTTP request, so the one-time secret
        // cannot reach server, proxy, or analytics URL logs.
        joinPath: `/join/${game.gameId}#${invitation.inviteToken}`,
      })),
    }, 201);
  } catch (error) {
    if (error instanceof CreateGameValidationError) return gameJson({ code: "VALIDATION_ERROR" }, 400);
    logProvisioningFailure(error);
    return toSafeGameErrorResponse(error);
  }
};
