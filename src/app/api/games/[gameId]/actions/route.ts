import { type NextRequest } from "next/server";

import { isOpaqueId } from "@/lib/multiplayer/action-codec";
import { getDeclarationAppOrigin } from "@/server/config/environment";
import { gameJson, rateLimited, readLimitedJson, toSafeGameErrorResponse, unavailableSession } from "@/server/game-session/http";
import { hashSeatCredential, getSeatCookieName } from "@/server/game-session/seat-credentials";
import { processAuthenticatedAction } from "@/server/game-session/service";
import { getGameSessionRuntime } from "@/server/game-session/runtime";
import {
  AUTHENTICATED_GAME_ACTION_RATE_LIMIT,
  limitAuthenticatedSeat,
  limitRequestSource,
  SOURCE_GAME_ACTION_RATE_LIMIT,
} from "@/server/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ACTION_BODY_BYTES = 8 * 1024;
type ActionRouteContext = Readonly<{ params: Promise<{ gameId: string }> }>;

const isJsonContentType = (value: string | null): boolean =>
  value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";

export const POST = async (request: NextRequest, context: ActionRouteContext): Promise<Response> => {
  try {
    const decision = await limitRequestSource(request, SOURCE_GAME_ACTION_RATE_LIMIT);
    if (!decision.allowed) return rateLimited(decision.retryAfterSeconds);
  } catch (error) {
    return toSafeGameErrorResponse(error);
  }
  const { gameId } = await context.params;
  if (!isOpaqueId(gameId)) return unavailableSession();
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

  const parsed = await readLimitedJson(request, MAX_ACTION_BODY_BYTES);
  if (!parsed.ok) return gameJson({ code: parsed.status === 413 ? "PAYLOAD_TOO_LARGE" : "VALIDATION_ERROR" }, parsed.status);

  const credential = request.cookies.get(getSeatCookieName(gameId))?.value;
  if (credential === undefined || credential.length === 0) return unavailableSession();
  try {
    const credentialHash = hashSeatCredential(credential);
    const runtime = getGameSessionRuntime();
    const identity = await runtime.repository.authenticateSeat(gameId, credentialHash);
    const decision = await limitAuthenticatedSeat(
      identity,
      AUTHENTICATED_GAME_ACTION_RATE_LIMIT,
    );
    if (!decision.allowed) return rateLimited(decision.retryAfterSeconds);
    const response = await processAuthenticatedAction(
      gameId,
      credentialHash,
      parsed.value,
      runtime,
    );
    return gameJson(response, response.status === "CONFLICT" ? 409 : response.status === "VALIDATION_ERROR" ? 400 : 200);
  } catch (error) {
    return toSafeGameErrorResponse(error);
  }
};
