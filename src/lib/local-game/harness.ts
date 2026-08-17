import { resolveAsk, type AskAction, type AskResolution } from "@/game/engine/asking";
import { initializeNormalPlayGame } from "@/game/engine/setup";
import type { NormalPlayGameState } from "@/game/engine/normal-play";
import { createPlayerId, type PlayerId, type PlayerSetup } from "@/game/types/player";

/**
 * Stable, local-only participants for the Build 10 integration harness. These
 * are deliberately outside the game engine so future server setup can replace
 * them without changing rules code.
 */
export const LOCAL_PLAYERS = Object.freeze({
  avery: createPlayerId("local-avery"),
  jules: createPlayerId("local-jules"),
  noa: createPlayerId("local-noa"),
  maya: createPlayerId("local-maya"),
  eli: createPlayerId("local-eli"),
  sage: createPlayerId("local-sage"),
});

export const DEFAULT_LOCAL_PLAYER_ID = LOCAL_PLAYERS.avery;

export const LOCAL_PLAYER_SETUPS: readonly PlayerSetup[] = Object.freeze([
  { id: LOCAL_PLAYERS.avery, displayName: "Avery", teamId: "TEAM_A" },
  { id: LOCAL_PLAYERS.jules, displayName: "Jules", teamId: "TEAM_A" },
  { id: LOCAL_PLAYERS.noa, displayName: "Noa", teamId: "TEAM_A" },
  { id: LOCAL_PLAYERS.maya, displayName: "Maya", teamId: "TEAM_B" },
  { id: LOCAL_PLAYERS.eli, displayName: "Eli", teamId: "TEAM_B" },
  { id: LOCAL_PLAYERS.sage, displayName: "Sage", teamId: "TEAM_B" },
]);

const LOCAL_DEAL_SEED = 0xdec1a7e;

/** A tiny deterministic random source for repeatable local development deals. */
const createSeededRandom = (seed: number): (() => number) => {
  let value = seed >>> 0;

  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
};

/**
 * Creates the one deterministic six-player game used by the local client.
 * It delegates shuffling, dealing, and normal-play construction to the frozen
 * engine; it does not construct hands itself.
 */
export const createDeterministicLocalGame = (): NormalPlayGameState =>
  initializeNormalPlayGame(
    {
      players: LOCAL_PLAYER_SETUPS,
      initialTurnOwner: DEFAULT_LOCAL_PLAYER_ID,
    },
    createSeededRandom(LOCAL_DEAL_SEED),
  );

/** Creates the intent the UI submits to the frozen asking engine. */
export const createLocalAskAction = (
  asker: PlayerId,
  target: PlayerId,
  requestedCard: AskAction["requestedCard"],
): AskAction => ({ asker, target, requestedCard });

/**
 * The local integration's sole action boundary. It deliberately delegates all
 * validation, transfers, turn ownership, and lifecycle changes to the engine.
 */
export const resolveLocalAsk = (
  state: NormalPlayGameState,
  action: AskAction,
): AskResolution => resolveAsk(state, action);
