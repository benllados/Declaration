/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CreateGameExperience } from "../../src/components/game/CreateGameExperience";

const INVITE_TOKEN = "a".repeat(43);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(window.navigator, "share", { configurable: true, value: undefined });
});

describe("CreateGameExperience", () => {
  it("explains the remote friend-group product and offers a no-backend playable demo before creation", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<CreateGameExperience />);

    expect(screen.getByRole("heading", { name: "Play Declaration with friends, wherever you are." })).toBeDefined();
    expect(screen.getByRole("link", { name: /Try the demo/ }).getAttribute("href")).toBe("/demo");
    expect(screen.getByRole("heading", { name: "Create a game" })).toBeDefined();
    expect(screen.getAllByRole("textbox")).toHaveLength(6);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the device share sheet for a created private seat when available", async () => {
    const joinPath = `/join/game-one#${INVITE_TOKEN}`;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: vi.fn().mockResolvedValue({
        gameId: "game-one",
        invitations: [{ displayName: "Avery", joinPath }],
      }),
    });
    const shareMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(window.navigator, "share", { configurable: true, value: shareMock });

    const user = userEvent.setup();
    render(<CreateGameExperience />);
    screen.getAllByRole("textbox").forEach((input, index) => {
      fireEvent.change(input, { target: { value: `Player ${index + 1}` } });
    });
    await user.click(screen.getByRole("button", { name: "Create game" }));

    await user.click(await screen.findByRole("button", { name: "Share seat" }));

    expect(shareMock).toHaveBeenCalledWith({
      title: "Your Declaration seat",
      text: "Avery, your private seat is ready.",
      url: `${window.location.origin}${joinPath}`,
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Shared" })).toBeDefined());
  });
});
