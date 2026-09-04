import { describe, expect, it, vi } from "vitest";

import { createPublicGame } from "../../src/server/game-session/create-game";
import type { GameProvisioningInput, ProvisionedSeat } from "../../src/server/game-session/provisioning";

const playerNames = ["Avery", "Jules", "Noa", "Maya", "Eli", "Sage"];

const invitation = (index: number): string => `${String(index).padStart(2, "0")}${"x".repeat(41)}`;

const createProvisioner = () => {
  let received: GameProvisioningInput | undefined;
  const provisioner = {
    createGame: async (input: GameProvisioningInput): Promise<Readonly<{ gameId: string; seats: readonly ProvisionedSeat[] }>> => {
      received = input;
      return {
        gameId: input.gameId,
        seats: input.seats.map((seat, index) => ({
          ...seat,
          inviteToken: invitation(index),
          expiresAt: new Date("2030-01-01T00:00:00.000Z"),
        })),
      };
    },
  };
  return { provisioner, received: () => received };
};

describe("public game creation", () => {
  it("creates a random six-player deal, stable two-team assignment, and one invite per player", async () => {
    const fake = createProvisioner();
    const created = await createPublicGame({ playerNames }, { provisioner: fake.provisioner, random: () => 0.25 });
    const provisioned = fake.received();

    expect(created.gameId).toMatch(/^game-[A-Za-z0-9_-]{24}$/);
    expect(created.invitations).toEqual(playerNames.map((displayName, index) => ({
      displayName,
      inviteToken: invitation(index),
    })));
    expect(provisioned?.seats).toHaveLength(6);
    expect(new Set(provisioned?.seats.map((seat) => seat.seatId))).toHaveLength(6);
    expect(provisioned?.state.players.map((player) => player.displayName)).toEqual(playerNames);
    expect(provisioned?.state.players.slice(0, 3).every((player) => player.teamId === "TEAM_A")).toBe(true);
    expect(provisioned?.state.players.slice(3).every((player) => player.teamId === "TEAM_B")).toBe(true);
    expect(provisioned?.state.players.flatMap((player) => player.hand)).toHaveLength(54);
    expect(provisioned?.state.currentTurnOwner).toBe(provisioned?.state.players[0].id);
  });

  it("never falls back to Math.random for a production game deal", async () => {
    const fake = createProvisioner();
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random must not create a public game deal.");
    });

    await expect(createPublicGame({ playerNames }, { provisioner: fake.provisioner })).resolves.toEqual(expect.objectContaining({ gameId: expect.stringMatching(/^game-/) }));
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it.each([
    {},
    { playerNames: playerNames.slice(0, 5) },
    { playerNames: [...playerNames.slice(0, 5), "avery"] },
    { playerNames: [...playerNames.slice(0, 5), " "] },
    { playerNames: [...playerNames.slice(0, 5), "x".repeat(33)] },
    { playerNames, unexpected: true },
  ])("rejects malformed public creation input", async (input) => {
    const fake = createProvisioner();
    await expect(createPublicGame(input, { provisioner: fake.provisioner })).rejects.toThrow("Game creation request is invalid.");
    expect(fake.received()).toBeUndefined();
  });
});
