import type { PlayerId } from "../types/player";
import type { TeamId } from "../types/team";
import { createNormalPlayState, type NormalPlayGameState } from "./normal-play";

/** Intent to lock the sole player who may make all remaining Blind Declarations. */
export type SelectBlindDeclarerAction =
  | Readonly<{ blindDeclarerId: PlayerId }>
  | Readonly<{ playerId: PlayerId }>;

export const INVALID_BLIND_DECLARER_SELECTION_REASONS = [
  "BLIND_DECLARATION_NOT_ACTIVE",
  "BLIND_DECLARER_ALREADY_SELECTED",
  "INVALID_BLIND_DECLARER",
  "PLAYER_NOT_ON_BLIND_DECLARATION_TEAM",
] as const;
export type InvalidBlindDeclarerSelectionReason =
  (typeof INVALID_BLIND_DECLARER_SELECTION_REASONS)[number];

export type BlindDeclarerSelectionResult =
  | Readonly<{ kind: "BLIND_DECLARER_SELECTED"; blindDeclarerId: PlayerId; blindDeclarationTeamId: TeamId }>
  | Readonly<{ kind: "INVALID_BLIND_DECLARER_SELECTION"; reason: InvalidBlindDeclarerSelectionReason }>;

export type BlindDeclarerSelectionResolution = Readonly<{
  state: NormalPlayGameState;
  result: BlindDeclarerSelectionResult;
}>;

/**
 * Locks an eligible player for the rest of Blind Declaration Mode. A player
 * with no active cards remains eligible, exactly as the rules require.
 */
export const selectBlindDeclarer = (
  state: NormalPlayGameState,
  action: SelectBlindDeclarerAction | PlayerId,
): BlindDeclarerSelectionResolution => {
  if (state.phase !== "BLIND_DECLARATION") {
    return {
      state,
      result: { kind: "INVALID_BLIND_DECLARER_SELECTION", reason: "BLIND_DECLARATION_NOT_ACTIVE" },
    };
  }
  if (state.blindDeclarerId !== null) {
    return {
      state,
      result: { kind: "INVALID_BLIND_DECLARER_SELECTION", reason: "BLIND_DECLARER_ALREADY_SELECTED" },
    };
  }

  if (action === null || (typeof action !== "string" && typeof action !== "object")) {
    return {
      state,
      result: { kind: "INVALID_BLIND_DECLARER_SELECTION", reason: "INVALID_BLIND_DECLARER" },
    };
  }
  const blindDeclarerId = typeof action === "string"
    ? action
    : "blindDeclarerId" in action ? action.blindDeclarerId : action.playerId;
  const player = state.players.find((candidate) => candidate.id === blindDeclarerId);
  if (!player) {
    return {
      state,
      result: { kind: "INVALID_BLIND_DECLARER_SELECTION", reason: "INVALID_BLIND_DECLARER" },
    };
  }
  if (player.teamId !== state.blindDeclarationTeamId) {
    return {
      state,
      result: { kind: "INVALID_BLIND_DECLARER_SELECTION", reason: "PLAYER_NOT_ON_BLIND_DECLARATION_TEAM" },
    };
  }

  const nextState = createNormalPlayState({
    players: state.players,
    currentTurnOwner: state.currentTurnOwner,
    resolvedSetIds: state.resolvedSetIds,
    phase: "BLIND_DECLARATION",
    scores: state.scores,
    activeDeclaration: null,
    blindDeclarationTeamId: state.blindDeclarationTeamId,
    blindDeclarerId,
  });
  return {
    state: nextState,
    result: {
      kind: "BLIND_DECLARER_SELECTED",
      blindDeclarerId,
      blindDeclarationTeamId: state.blindDeclarationTeamId,
    },
  };
};
