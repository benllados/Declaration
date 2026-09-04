import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "../../src/app/api/games/[gameId]/route";
import { POST } from "../../src/app/api/games/[gameId]/actions/route";
import { GameSessionAccessError, RetryableGameSessionError } from "../../src/server/game-session/errors";
import type { GameSessionTransaction, SeatAuthenticatedGameSessionRepository } from "../../src/server/game-session/repository";
import { configureRateLimitRuntimeForTests, InMemoryRateLimiter, type RateLimiter } from "../../src/server/security/rate-limit";
import { credentialsMatch, getSeatCookieName, hashSeatCredential } from "../../src/server/game-session/seat-credentials";
import type { SeatIdentity } from "../../src/server/game-session/seat-identity";
import { LOCAL_PLAYERS, createDeterministicLocalGame } from "../../src/lib/local-game";
import { GAME_ID, TestServerClock, createRecord, findLegalAsk, seatFor } from "../support/game-session-fixtures";
import { TestGameSessionRepository } from "../support/game-session-repository";

class RouteRepository implements SeatAuthenticatedGameSessionRepository {
  constructor(
    private readonly repository: TestGameSessionRepository,
    private readonly credential: Uint8Array,
    private readonly identity: SeatIdentity,
  ) {}

  transact = <T>(gameId: string, operation: (transaction: GameSessionTransaction) => Promise<T>): Promise<T> =>
    this.repository.transact(gameId, operation);

  transactAuthenticated = <T>(
    gameId: string,
    hash: Uint8Array,
    operation: (transaction: GameSessionTransaction, identity: SeatIdentity) => Promise<T>,
  ): Promise<T> => {
    if (gameId !== this.identity.gameId || !credentialsMatch(hash, this.credential)) throw new GameSessionAccessError();
    return this.repository.transact(gameId, (transaction) => operation(transaction, this.identity));
  };

  authenticateSeat = async (gameId: string, hash: Uint8Array): Promise<SeatIdentity> => {
    if (gameId !== this.identity.gameId || !credentialsMatch(hash, this.credential)) throw new GameSessionAccessError();
    return this.identity;
  };

  readAuthenticatedSnapshot = async (gameId: string, hash: Uint8Array) =>
    this.transactAuthenticated(gameId, hash, async (transaction, identity) => {
      const record = await transaction.load();
      if (record === null) throw new GameSessionAccessError();
      return { record, identity, now: await transaction.now() };
    });
}

let runtime: { repository: SeatAuthenticatedGameSessionRepository };

vi.mock("@/server/game-session/runtime", () => ({
  getGameSessionRuntime: () => runtime,
}));

const routeContext = { params: Promise.resolve({ gameId: GAME_ID }) };
const credential = "test-seat-credential";
const cookie = `${getSeatCookieName(GAME_ID)}=${credential}`;
const action = (actionId: string, expectedRevision: number) => ({
  gameId: GAME_ID,
  actionId,
  expectedRevision,
  type: "ASK" as const,
  payload: findLegalAsk(createDeterministicLocalGame()),
});

const request = (path: string, init: RequestInit = {}): NextRequest => new NextRequest(`http://localhost:3000${path}`, init);

beforeEach(() => {
  vi.stubEnv("DECLARATION_APP_ORIGIN", "http://localhost:3000");
  configureRateLimitRuntimeForTests(new InMemoryRateLimiter());
  const repository = new TestGameSessionRepository([createRecord()]);
  repository.setClock(new TestServerClock(100));
  runtime = {
    repository: new RouteRepository(repository, hashSeatCredential(credential), seatFor(LOCAL_PLAYERS.avery)),
  };
});

describe("Build 13 game Route Handlers", () => {
  it("returns only the authenticated seat's scoped view with private cache headers", async () => {
    const response = await GET(request(`/api/games/${GAME_ID}`, { headers: { cookie } }), routeContext);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(payload.view.localPlayer.id).toBe(LOCAL_PLAYERS.avery);
    expect(JSON.stringify(payload)).not.toContain('"processedActions"');
    expect(JSON.stringify(payload)).not.toContain('"state"');
    for (const player of createDeterministicLocalGame().players.filter((player) => player.id !== LOCAL_PLAYERS.avery)) {
      for (const card of player.hand) expect(JSON.stringify(payload)).not.toContain(JSON.stringify(card));
    }
  });

  it("maps missing and invalid credentials to the same generic inaccessible response", async () => {
    const missing = await GET(request(`/api/games/${GAME_ID}`), routeContext);
    const invalid = await GET(request(`/api/games/${GAME_ID}`, {
      headers: { cookie: `${getSeatCookieName(GAME_ID)}=invalid` },
    }), routeContext);

    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual(await invalid.json());
  });

  it("limits reads and actions before parameter, body, cookie, or database work", async () => {
    const limiter: RateLimiter = { consume: vi.fn().mockResolvedValue({ allowed: false, retryAfterSeconds: 3 }) };
    const authenticateSeat = vi.fn();
    configureRateLimitRuntimeForTests(limiter);
    runtime = { repository: { authenticateSeat } as unknown as SeatAuthenticatedGameSessionRepository };
    const actionRequest = request(`/api/games/${GAME_ID}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    const [read, actionResponse] = await Promise.all([
      GET(request(`/api/games/${GAME_ID}`), routeContext),
      POST(actionRequest, routeContext),
    ]);

    expect([read.status, actionResponse.status]).toEqual([429, 429]);
    expect(read.headers.get("retry-after")).toBe("3");
    expect(actionResponse.headers.get("retry-after")).toBe("3");
    expect(actionRequest.bodyUsed).toBe(false);
    expect(authenticateSeat).not.toHaveBeenCalled();
  });

  it("accepts an authenticated action, then preserves duplicate and conflict semantics", async () => {
    const headers = { cookie, origin: "http://localhost:3000", "content-type": "application/json" };
    const first = await POST(request(`/api/games/${GAME_ID}/actions`, { method: "POST", headers, body: JSON.stringify(action("route-action", 0)) }), routeContext);
    const duplicate = await POST(request(`/api/games/${GAME_ID}/actions`, { method: "POST", headers, body: JSON.stringify(action("route-action", 0)) }), routeContext);
    const conflict = await POST(request(`/api/games/${GAME_ID}/actions`, { method: "POST", headers, body: JSON.stringify(action("route-conflict", 0)) }), routeContext);

    expect(first.status).toBe(200);
    expect((await first.json()).status).toBe("APPLIED");
    expect(duplicate.status).toBe(200);
    expect((await duplicate.json()).status).toBe("DUPLICATE");
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).status).toBe("CONFLICT");
  });

  it("rejects malformed, oversized, mismatched, and cross-origin action requests without internals", async () => {
    const headers = { cookie, origin: "http://localhost:3000", "content-type": "application/json" };
    const malformedJson = await POST(request(`/api/games/${GAME_ID}/actions`, { method: "POST", headers, body: "{" }), routeContext);
    const malformedAction = await POST(request(`/api/games/${GAME_ID}/actions`, { method: "POST", headers, body: JSON.stringify({ ...action("bad-action", 0), actor: "attacker" }) }), routeContext);
    const mismatch = await POST(request(`/api/games/${GAME_ID}/actions`, { method: "POST", headers, body: JSON.stringify({ ...action("wrong-game", 0), gameId: "other-game" }) }), routeContext);
    const wrongType = await POST(request(`/api/games/${GAME_ID}/actions`, { method: "POST", headers: { cookie, origin: "http://localhost:3000", "content-type": "text/plain" }, body: "x" }), routeContext);
    const oversized = await POST(request(`/api/games/${GAME_ID}/actions`, { method: "POST", headers, body: JSON.stringify({ value: "x".repeat(8 * 1024) }) }), routeContext);
    const wrongOrigin = await POST(request(`/api/games/${GAME_ID}/actions`, { method: "POST", headers: { ...headers, origin: "https://attacker.example" }, body: JSON.stringify(action("wrong-origin", 0)) }), routeContext);

    expect([malformedJson.status, malformedAction.status, mismatch.status, wrongType.status, oversized.status, wrongOrigin.status])
      .toEqual([400, 400, 400, 415, 413, 403]);
    for (const response of [malformedJson, malformedAction, mismatch, wrongType, oversized, wrongOrigin]) {
      expect(JSON.stringify(await response.json())).not.toMatch(/postgres|declaration_private|credential_hash/i);
    }
  });

  it("maps retryable database failures to a generic 503", async () => {
    runtime = {
      repository: {
        transact: async () => {
          throw new RetryableGameSessionError();
        },
        authenticateSeat: async () => {
          throw new RetryableGameSessionError();
        },
        readAuthenticatedSnapshot: async () => {
          throw new RetryableGameSessionError();
        },
        transactAuthenticated: async () => {
          throw new RetryableGameSessionError();
        },
      },
    };
    const response = await GET(request(`/api/games/${GAME_ID}`, { headers: { cookie } }), routeContext);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "GAME_SESSION_TEMPORARILY_UNAVAILABLE" });
  });
});
