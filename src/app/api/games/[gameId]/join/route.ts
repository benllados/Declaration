import { type NextRequest, NextResponse } from "next/server";

import { getDeclarationAppOrigin } from "@/server/config/environment";
import { GameSessionAccessError } from "@/server/game-session/errors";
import { privateResponseHeaders, rateLimited, readLimitedJson, toSafeGameErrorResponse, unavailableSession } from "@/server/game-session/http";
import { getGameProvisioningRuntime } from "@/server/game-session/provisioning-runtime";
import { getSeatCookieName, getSeatCookieOptions } from "@/server/game-session/seat-credentials";
import { isOpaqueId } from "@/lib/multiplayer/action-codec";
import { limitRequestSource, SOURCE_INVITATION_REDEMPTION_RATE_LIMIT } from "@/server/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_JOIN_BODY_BYTES = 1024;

const isJsonContentType = (value: string | null): boolean =>
  value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";

const isInviteToken = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);

const decodeInvite = (value: unknown): string | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 && isInviteToken(record.inviteToken) ? record.inviteToken : null;
};

type JoinRouteContext = Readonly<{ params: Promise<{ gameId: string }> }>;

/** Redeems an invite sent explicitly from the fragment-only join page. */
export const POST = async (request: NextRequest, context: JoinRouteContext): Promise<Response> => {
  try {
    const decision = await limitRequestSource(request, SOURCE_INVITATION_REDEMPTION_RATE_LIMIT);
    if (!decision.allowed) return rateLimited(decision.retryAfterSeconds);
  } catch (error) {
    return toSafeGameErrorResponse(error);
  }
  const { gameId } = await context.params;
  if (!isOpaqueId(gameId)) return unavailableSession();
  if (!isJsonContentType(request.headers.get("content-type"))) return unavailableSession();
  try {
    if (request.headers.get("origin") !== getDeclarationAppOrigin()) return unavailableSession();
  } catch (error) {
    return toSafeGameErrorResponse(error);
  }
  const parsed = await readLimitedJson(request, MAX_JOIN_BODY_BYTES);
  const inviteToken = parsed.ok ? decodeInvite(parsed.value) : null;
  // Keep every malformed, expired, and replayed invitation indistinguishable.
  if (inviteToken === null) return unavailableSession();

  try {
    const seat = await getGameProvisioningRuntime().provisioner.redeemInvitation(gameId, inviteToken);
    const response = NextResponse.json({ gameId }, { headers: privateResponseHeaders });
    response.cookies.set(getSeatCookieName(gameId), seat.credential, getSeatCookieOptions(gameId, seat.expiresAt));
    return response;
  } catch (error) {
    if (error instanceof GameSessionAccessError) return unavailableSession();
    return toSafeGameErrorResponse(error);
  }
};
