import { resolveAsk, type AskAction, type AskResolution } from "@/game/engine/asking";
import { selectBlindDeclarer, type BlindDeclarerSelectionResult } from "@/game/engine/blind-declaration";
import {
  resolveDeclarationTimeout,
  startDeclaration,
  submitDeclaration,
  type DeclarationAssignment,
  type DeclarationResolutionResult,
  type DeclarationTimeoutResult,
  type InvalidDeclarationStartReason,
} from "@/game/engine/declaration";
import { initializeNormalPlayGame } from "@/game/engine/setup";
import type { NormalPlayGameState } from "@/game/engine/normal-play";
import type { SetId } from "@/game/sets";
import { createPlayerId, type PlayerId, type PlayerSetup } from "@/game/types/player";
import { createPlayerGameView, type PlayerGameView } from "./player-view";

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

/**
 * The local clock mirrors the future server-time boundary. UI code requests a
 * time from this harness instead of constructing engine timestamps itself.
 */
export type LocalGameClock = Readonly<{ now: () => number }>;

export const createLocalGameClock = (now: () => number = () => Date.now() / 1_000): LocalGameClock =>
  Object.freeze({ now });

const LOCAL_GAME_CLOCK = createLocalGameClock();

/** Exposes harness time for display-only countdown rendering. */
export const getLocalGameNow = (): number => LOCAL_GAME_CLOCK.now();

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

export type LocalDeclarationStartResult =
  | Readonly<{
    kind: "STARTED";
    declarerId: PlayerId;
    declarerTeamId: "TEAM_A" | "TEAM_B";
    selectedSetId: SetId;
    deadline: number;
  }>
  | Readonly<{ kind: "INVALID_START"; reason: InvalidDeclarationStartReason }>;

export type LocalActionResolution<Result> = Readonly<{
  /** The engine-returned state is retained only by the local integration root. */
  state: NormalPlayGameState;
  /** The safe, newly projected state for UI feedback and presentation. */
  view: PlayerGameView;
  result: Result;
}>;

const projectLocalAction = <Result>(
  state: NormalPlayGameState,
  localPlayerId: PlayerId,
  result: Result,
): LocalActionResolution<Result> => Object.freeze({
  state,
  view: createPlayerGameView(state, localPlayerId),
  result,
});

const toLocalDeclarationStartResult = (
  result: ReturnType<typeof startDeclaration>["result"],
): LocalDeclarationStartResult => result.kind === "STARTED"
  ? Object.freeze({
    kind: result.kind,
    declarerId: result.declarerId,
    declarerTeamId: result.declarerTeamId,
    selectedSetId: result.selectedSetId,
    deadline: result.deadline,
  })
  : result;

/** Locks a selected set through the frozen engine using harness-owned time. */
export const startLocalDeclaration = (
  state: NormalPlayGameState,
  localPlayerId: PlayerId,
  selectedSetId: SetId,
  clock: LocalGameClock = LOCAL_GAME_CLOCK,
): LocalActionResolution<LocalDeclarationStartResult> => {
  const resolution = startDeclaration(state, {
    declarerId: localPlayerId,
    selectedSetId,
    startedAt: clock.now(),
  });

  return projectLocalAction(
    resolution.state,
    localPlayerId,
    toLocalDeclarationStartResult(resolution.result),
  );
};

/** Submits assignment intent only; the frozen engine validates and resolves it. */
export const submitLocalDeclaration = (
  state: NormalPlayGameState,
  localPlayerId: PlayerId,
  assignments: readonly DeclarationAssignment[],
  clock: LocalGameClock = LOCAL_GAME_CLOCK,
): LocalActionResolution<DeclarationResolutionResult> => {
  const resolution = submitDeclaration(state, {
    declarerId: localPlayerId,
    assignments,
    submittedAt: clock.now(),
  });

  return projectLocalAction(resolution.state, localPlayerId, resolution.result);
};

/** Lets the engine decide whether an active Declaration has truly timed out. */
export const resolveLocalDeclarationTimeout = (
  state: NormalPlayGameState,
  localPlayerId: PlayerId,
  clock: LocalGameClock = LOCAL_GAME_CLOCK,
): LocalActionResolution<DeclarationTimeoutResult> => {
  const resolution = resolveDeclarationTimeout(state, { resolvedAt: clock.now() });
  return projectLocalAction(resolution.state, localPlayerId, resolution.result);
};

/** Locks a Blind Declarer through the engine; authorization belongs to a future server. */
export const selectLocalBlindDeclarer = (
  state: NormalPlayGameState,
  localPlayerId: PlayerId,
  blindDeclarerId: PlayerId,
): LocalActionResolution<BlindDeclarerSelectionResult> => {
  const resolution = selectBlindDeclarer(state, { blindDeclarerId });
  return projectLocalAction(resolution.state, localPlayerId, resolution.result);
};
