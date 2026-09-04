"use client";

import { useEffect, useRef, useState } from "react";

import { rateLimitPauseMilliseconds } from "@/components/game/rate-limit-backoff";
import { redirectToJoinedGame } from "@/components/game/join-navigation";
import { Button } from "@/components/ui/Button";

type JoinState = "PREPARING" | "READY" | "REDEEMING" | "UNAVAILABLE" | "ERROR";

const invitationToken = (): string | null => {
  const value = window.location.hash.slice(1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
};

/** The join route uses 404 for every terminal unavailable/replayed/invalid invite. */
export const isTerminalInvitationResponse = (status: number): boolean => status === 404;

/**
 * The fragment is client-only. Remove it before sending the explicit POST so
 * browser history, subsequent referrers, and server URLs never retain it.
 */
export function JoinGameExperience({ gameId }: Readonly<{ gameId: string }>) {
  const [state, setState] = useState<JoinState>("PREPARING");
  const [retryBlocked, setRetryBlocked] = useState(false);
  const invitationTokenRef = useRef<string | null>(null);
  const redemptionPendingRef = useRef(false);
  const retryAvailableAtRef = useRef(0);
  const retryTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const fragmentToken = invitationToken();
    if (fragmentToken !== null) invitationTokenRef.current = fragmentToken;
    window.history.replaceState(null, "", `/join/${gameId}`);
    let cancelled = false;
    if (invitationTokenRef.current === null) {
      queueMicrotask(() => {
        if (!cancelled) setState("UNAVAILABLE");
      });
      return () => { cancelled = true; };
    }
    queueMicrotask(() => {
      if (!cancelled) setState("READY");
    });
    return () => { cancelled = true; };
  }, [gameId]);

  useEffect(() => () => {
    if (retryTimerRef.current !== undefined) window.clearTimeout(retryTimerRef.current);
  }, []);

  const deferRetry = (retryAfter: string | null): void => {
    const availableAt = Math.max(
      retryAvailableAtRef.current,
      Date.now() + rateLimitPauseMilliseconds(retryAfter),
    );
    retryAvailableAtRef.current = availableAt;
    setRetryBlocked(true);
    if (retryTimerRef.current !== undefined) window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = window.setTimeout(() => {
      if (Date.now() >= retryAvailableAtRef.current) setRetryBlocked(false);
    }, Math.max(0, availableAt - Date.now()));
  };

  const redeem = async (): Promise<void> => {
    const token = invitationTokenRef.current;
    if (token === null) {
      setState("UNAVAILABLE");
      return;
    }
    if (redemptionPendingRef.current) return;
    if (Date.now() < retryAvailableAtRef.current) return;
    redemptionPendingRef.current = true;
    setRetryBlocked(false);
    setState("REDEEMING");
    try {
      const response = await fetch(`/api/games/${gameId}/join`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteToken: token }),
      });
      if (response.ok) {
        invitationTokenRef.current = null;
        redirectToJoinedGame(gameId);
        return;
      }
      if (isTerminalInvitationResponse(response.status)) {
        invitationTokenRef.current = null;
        setState("UNAVAILABLE");
        return;
      }
      if (response.status === 429) deferRetry(response.headers.get("retry-after"));
      setState("ERROR");
    } catch {
      setState("ERROR");
    } finally {
      redemptionPendingRef.current = false;
    }
  };

  const unavailable = state === "UNAVAILABLE";
  const ready = state === "READY";
  return (
    <main className="game-page">
      <section className="game-surface game-surface--message" aria-live="polite">
        <div className="game-over-panel">
          <span aria-hidden="true">D</span>
          <p className="eyebrow">Declaration</p>
          <h1>{unavailable ? "This invitation isn’t available." : state === "ERROR" ? "We couldn’t join the game." : ready ? "Ready to join?" : "Preparing your invitation…"}</h1>
          <p>{unavailable ? "Ask the host for a new invitation." : state === "ERROR" ? retryBlocked ? "Please wait a moment before trying again." : "Check your connection and try again." : ready ? "Confirm to secure this seat at the table." : "Securing your invitation."}</p>
          {ready ? <Button onClick={() => void redeem()}>Join game</Button> : null}
          {state === "REDEEMING" ? <Button disabled>Joining…</Button> : null}
          {state === "ERROR" ? <Button disabled={retryBlocked} onClick={() => void redeem()}>{retryBlocked ? "Try again shortly" : "Try again"}</Button> : null}
        </div>
      </section>
    </main>
  );
}
