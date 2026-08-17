import type { AskResult } from "@/game/engine/asking";
import type { PlayerGameView } from "./player-view";

export type AskFeedback = Readonly<{
  tone: "success" | "quiet" | "warning";
  title: string;
  detail: string;
  cardId?: Exclude<AskResult, { kind: "INVALID" }> ["requestedCard"];
}>;

const getVisibleName = (view: PlayerGameView, playerId: string): string => {
  if (playerId === view.localPlayer.id) return "You";
  return view.visiblePlayers.find((player) => player.id === playerId)?.displayName ?? "That player";
};

const ILLEGAL_MESSAGES: Readonly<Record<Extract<AskResult, { kind: "ILLEGAL" }> ["reason"], string>> = {
  NOT_TURN_OWNER: "That turn has already moved on.",
  TARGET_IS_SELF: "Choose someone on the other team.",
  TARGET_IS_TEAMMATE: "Choose someone on the other team.",
  TARGET_HAS_NO_CARDS: "That player has no cards to ask for.",
  SET_ALREADY_RESOLVED: "That set has already been resolved.",
  REQUESTED_CARD_ALREADY_OWNED: "That card is already in your hand.",
  NO_CARD_FROM_REQUESTED_SET: "Start from a card in the same set.",
  NORMAL_ASKING_NOT_ALLOWED: "Normal asks are paused right now.",
};

/** Turns machine-readable engine results into concise, public player feedback. */
export const createAskFeedback = (view: PlayerGameView, result: AskResult): AskFeedback => {
  if (result.kind === "SUCCESS") {
    const targetName = getVisibleName(view, result.target);
    return {
      tone: "success",
      title: `${targetName} had it!`,
      detail: `${targetName} → You`,
      cardId: result.requestedCard,
    };
  }

  if (result.kind === "UNSUCCESSFUL") {
    const targetName = getVisibleName(view, result.target);
    return {
      tone: "quiet",
      title: `${targetName} doesn’t have it.`,
      detail: `${targetName} has the turn.`,
      cardId: result.requestedCard,
    };
  }

  if (result.kind === "ILLEGAL") {
    const targetName = getVisibleName(view, result.resultingTurnOwner);
    return {
      tone: "warning",
      title: ILLEGAL_MESSAGES[result.reason],
      detail: `${targetName} has the turn.`,
      cardId: result.requestedCard,
    };
  }

  return {
    tone: "warning",
    title: "That action couldn’t be completed.",
    detail: "Try a fresh selection.",
  };
};
