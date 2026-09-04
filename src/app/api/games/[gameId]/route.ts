import { type NextRequest } from "next/server";

import { isOpaqueId } from "@/lib/multiplayer/action-codec";
import { readAuthenticatedScopedGameView } from "@/server/game-session/service";
import { hashSeatCredential, getSeatCookieName } from "@/server/game-session/seat-credentials";
import { getGameSessionRuntime } from "@/server/game-session/runtime";
import { gameJson, rateLimited, toSafeGameErrorResponse, unavailableSession } from "@/server/game-session/http";
import {
  AUTHENTICATED_GAME_READ_RATE_LIMIT,
  limitAuthenticatedSeat,
  limitRequestSource,
  SOURCE_GAME_READ_RATE_LIMIT,
} from "@/server/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GameRouteContext = Readonly<{ params: Promise<{ gameId: string }> }>;

/** Returns only the authenticated player's scoped view, never a stored record. */
export const GET = async (request: NextRequest, context: GameRouteContext): Promise<Response> => {
  try {
    const decision = await limitRequestSource(request, SOURCE_GAME_READ_RATE_LIMIT);
    if (!decision.allowed) return rateLimited(decision.retryAfterSeconds);
  } catch (error) {
    return toSafeGameErrorResponse(error);
  }
  const { gameId } = await context.params;
  if (!isOpaqueId(gameId)) return unavailableSession();
  const credential = request.cookies.get(getSeatCookieName(gameId))?.value;
  if (credential === undefined || credential.length === 0) return unavailableSession();
  try {
    const credentialHash = hashSeatCredential(credential);
    const runtime = getGameSessionRuntime();
    const identity = await runtime.repository.authenticateSeat(gameId, credentialHash);
    const decision = await limitAuthenticatedSeat(
      identity,
      AUTHENTICATED_GAME_READ_RATE_LIMIT,
    );
    if (!decision.allowed) return rateLimited(decision.retryAfterSeconds);
    const scoped = await readAuthenticatedScopedGameView(
      gameId,
      credentialHash,
      runtime,
    );
    return gameJson(scoped);
  } catch (error) {
    return toSafeGameErrorResponse(error);
  }
};
