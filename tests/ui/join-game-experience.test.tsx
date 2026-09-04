/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const joinNavigation = vi.hoisted(() => ({ redirectToJoinedGame: vi.fn() }));

vi.mock("@/components/game/join-navigation", () => joinNavigation);

import { isTerminalInvitationResponse, JoinGameExperience } from "../../src/components/game/JoinGameExperience";

const GAME_ID = "game-join";
const NEXT_GAME_ID = "game-next";
const INVITE_TOKEN = "a".repeat(43);

type JoinResponse = Response & Readonly<{ json: ReturnType<typeof vi.fn> }>;

const joinResponse = (status: number, headers?: HeadersInit): JoinResponse => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(headers),
  json: vi.fn(),
}) as unknown as JoinResponse;

const renderInvitation = (gameId = GAME_ID) => {
  window.history.replaceState(null, "", `/join/${gameId}#${INVITE_TOKEN}`);
  return render(<JoinGameExperience gameId={gameId} />);
};

const expectFragmentAndStorageToRemainPrivate = (): void => {
  expect(window.location.href).not.toContain(INVITE_TOKEN);
  expect(window.localStorage.getItem("invite")).toBeNull();
  expect(window.sessionStorage.getItem("invite")).toBeNull();
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  joinNavigation.redirectToJoinedGame.mockReset();
  vi.unstubAllGlobals();
});

describe("JoinGameExperience", () => {
  it("scrubs a fragment before any request, never auto-redeems, and prevents duplicate pending submissions", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    const localStorageSpy = vi.spyOn(Storage.prototype, "setItem");
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderInvitation();

    const button = await screen.findByRole("button", { name: "Join game" });
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe(`/join/${GAME_ID}`);
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(button);
    await user.click(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/games/${GAME_ID}/join`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain(INVITE_TOKEN);
    expect(localStorageSpy).not.toHaveBeenCalled();
    expectFragmentAndStorageToRemainPrivate();
  });

  it("retains a 429 token in memory, honors Retry-After, and permits a later explicit retry", async () => {
    const limited = joinResponse(429, { "retry-after": "1" });
    const unavailable = joinResponse(503);
    const fetchMock = vi.fn().mockResolvedValueOnce(limited).mockResolvedValueOnce(unavailable);
    vi.stubGlobal("fetch", fetchMock);

    renderInvitation();
    const joinButton = await screen.findByRole("button", { name: "Join game" });
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    fireEvent.click(joinButton);

    await act(async () => {});
    const delayedRetry = screen.getByRole("button", { name: "Try again shortly" }) as HTMLButtonElement;
    expect(delayedRetry.disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(limited.json).not.toHaveBeenCalled();
    expectFragmentAndStorageToRemainPrivate();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    const retry = screen.getByRole("button", { name: "Try again" });
    fireEvent.click(retry);

    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expectFragmentAndStorageToRemainPrivate();
  });

  it("retains a 503 token in memory and permits a later explicit retry", async () => {
    const unavailable = joinResponse(503);
    const followUp = joinResponse(500);
    const fetchMock = vi.fn().mockResolvedValueOnce(unavailable).mockResolvedValueOnce(followUp);
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderInvitation();
    await user.click(await screen.findByRole("button", { name: "Join game" }));
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(unavailable.json).not.toHaveBeenCalled();
    expectFragmentAndStorageToRemainPrivate();
  });

  it("retains a token after a network failure without redeeming automatically", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("network unavailable")).mockResolvedValueOnce(joinResponse(503));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderInvitation();
    await user.click(await screen.findByRole("button", { name: "Join game" }));
    expect((await screen.findByRole("button", { name: "Try again" }) as HTMLButtonElement).disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expectFragmentAndStorageToRemainPrivate();
  });

  it("clears the token after success or the route's terminal generic 404 response", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(joinResponse(200));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const rendered = renderInvitation();
    await user.click(await screen.findByRole("button", { name: "Join game" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    rendered.rerender(<JoinGameExperience gameId={NEXT_GAME_ID} />);
    expect(await screen.findByRole("heading", { name: "This invitation isn’t available." })).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(joinNavigation.redirectToJoinedGame).toHaveBeenCalledWith(GAME_ID);
    expectFragmentAndStorageToRemainPrivate();

    cleanup();
    const terminalFetch = vi.fn().mockResolvedValueOnce(joinResponse(404));
    vi.stubGlobal("fetch", terminalFetch);
    const terminal = renderInvitation();
    await user.click(await screen.findByRole("button", { name: "Join game" }));
    expect(await screen.findByRole("heading", { name: "This invitation isn’t available." })).toBeDefined();
    terminal.rerender(<JoinGameExperience gameId={NEXT_GAME_ID} />);
    expect(await screen.findByRole("heading", { name: "This invitation isn’t available." })).toBeDefined();
    expect(terminalFetch).toHaveBeenCalledTimes(1);
    expectFragmentAndStorageToRemainPrivate();
  });

  it("classifies only the generic route 404 as terminal", () => {
    expect(isTerminalInvitationResponse(404)).toBe(true);
    expect(isTerminalInvitationResponse(429)).toBe(false);
    expect(isTerminalInvitationResponse(503)).toBe(false);
    expect(isTerminalInvitationResponse(500)).toBe(false);
  });
});
