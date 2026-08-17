import type { BlindDeclarerSelectionResult } from "@/game/engine/blind-declaration";
import type {
  DeclarationResolutionResult,
  DeclarationTimeoutResult,
} from "@/game/engine/declaration";

import type { LocalDeclarationStartResult } from "./harness";
import { getSetLabel, type PlayerGameView } from "./player-view";

export type DeclarationFeedback = Readonly<{
  tone: "success" | "quiet" | "warning";
  title: string;
  detail: string;
}>;

export type DeclarationFeedbackResult =
  | LocalDeclarationStartResult
  | DeclarationResolutionResult
  | DeclarationTimeoutResult
  | BlindDeclarerSelectionResult;

const getVisibleName = (view: PlayerGameView, playerId: string): string => {
  if (playerId === view.localPlayer.id) return "You";
  return view.visiblePlayers.find((player) => player.id === playerId)?.displayName ?? "That player";
};

const INVALID_START_MESSAGES: Readonly<Record<Extract<LocalDeclarationStartResult, { kind: "INVALID_START" }>["reason"], string>> = {
  INVALID_DECLARATION_ACTION: "That Declaration request wasn’t valid.",
  INVALID_DECLARER: "That player can’t start this Declaration.",
  INVALID_SELECTED_SET: "Choose an unresolved set.",
  SET_ALREADY_RESOLVED: "That set has already been resolved.",
  INVALID_STARTED_AT: "The table clock needs a fresh moment.",
  DECLARATION_ALREADY_ACTIVE: "A Declaration is already in progress.",
  NORMAL_PLAY_NOT_AVAILABLE: "Normal Declarations are paused right now.",
  BLIND_DECLARER_NOT_SELECTED: "Choose the Blind Declarer first.",
  NOT_BLIND_DECLARER: "Only the locked Blind Declarer can start this set.",
  GAME_OVER: "This game has already finished.",
};

const INVALID_SUBMISSION_MESSAGES: Readonly<Record<Extract<DeclarationResolutionResult, { kind: "INVALID_SUBMISSION" }>["reason"], string>> = {
  INVALID_SUBMISSION: "Those assignments weren’t ready to submit.",
  NO_ACTIVE_DECLARATION: "There is no active Declaration to submit.",
  WRONG_DECLARER: "Only the declarer can submit these assignments.",
  INVALID_SUBMISSION_TIMESTAMP: "The table clock needs a fresh moment.",
  INVALID_ASSIGNMENTS: "Choose each card’s teammate again.",
  ASSIGNMENT_COUNT_MISMATCH: "Assign all six cards before submitting.",
  INVALID_ASSIGNED_CARD: "One of those cards is not available to assign.",
  DUPLICATE_ASSIGNED_CARD: "Each locked card needs one assignment.",
  CARD_OUTSIDE_SELECTED_SET: "Assignments must use the locked set.",
  INVALID_ASSIGNED_PLAYER: "Choose a teammate shown at the table.",
  ASSIGNED_PLAYER_IS_OPPONENT: "Cards can only be assigned to your team.",
};

const INVALID_BLIND_MESSAGES: Readonly<Record<Extract<BlindDeclarerSelectionResult, { kind: "INVALID_BLIND_DECLARER_SELECTION" }>["reason"], string>> = {
  BLIND_DECLARATION_NOT_ACTIVE: "Blind Declaration is not active yet.",
  BLIND_DECLARER_ALREADY_SELECTED: "The Blind Declarer is already locked.",
  INVALID_BLIND_DECLARER: "Choose one of the players at this table.",
  PLAYER_NOT_ON_BLIND_DECLARATION_TEAM: "Choose a player on the eligible team.",
};

/** Converts public engine outcomes into concise table feedback without hidden ownership detail. */
export const createDeclarationFeedback = (
  view: PlayerGameView,
  result: DeclarationFeedbackResult,
): DeclarationFeedback => {
  if (result.kind === "STARTED") {
    return {
      tone: "quiet",
      title: `${getVisibleName(view, result.declarerId)} locked ${getSetLabel(result.selectedSetId)}.`,
      detail: "The 90-second Declaration clock has started.",
    };
  }

  if (result.kind === "CORRECT") {
    return {
      tone: "success",
      title: "Declaration correct!",
      detail: `${getSetLabel(result.selectedSetId)} is resolved.`,
    };
  }

  if (result.kind === "INCORRECT") {
    return {
      tone: "warning",
      title: "Declaration incorrect.",
      detail: `${getSetLabel(result.selectedSetId)} is resolved.`,
    };
  }

  if (result.kind === "TIMED_OUT") {
    return {
      tone: "warning",
      title: "Time ran out.",
      detail: `${getSetLabel(result.selectedSetId)} is resolved.`,
    };
  }

  if (result.kind === "INVALID_START") {
    return { tone: "warning", title: INVALID_START_MESSAGES[result.reason], detail: "Your set selection is still available." };
  }

  if (result.kind === "INVALID_SUBMISSION") {
    return { tone: "warning", title: INVALID_SUBMISSION_MESSAGES[result.reason], detail: "The Declaration is still active—make a correction while time remains." };
  }

  if (result.kind === "TIMEOUT_NOT_REACHED") {
    return { tone: "quiet", title: "The clock is still open.", detail: "A complete submission is accepted through the exact deadline." };
  }

  if (result.kind === "INVALID_TIMEOUT") {
    return { tone: "quiet", title: "There is no active timer to resolve.", detail: "The table is already up to date." };
  }

  if (result.kind === "BLIND_DECLARER_SELECTED") {
    return {
      tone: "success",
      title: `${getVisibleName(view, result.blindDeclarerId)} is the Blind Declarer.`,
      detail: "They can now choose the remaining sets.",
    };
  }

  return {
    tone: "warning",
    title: INVALID_BLIND_MESSAGES[result.reason],
    detail: "Choose an eligible player and try again.",
  };
};
