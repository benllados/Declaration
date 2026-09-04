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
    return toSafeGameErrorResponse(error);
  }
};
