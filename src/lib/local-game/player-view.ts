import type { CardId } from "@/game/cards";
import type { NormalPlayGameState } from "@/game/engine/normal-play";
import { getCardsInSet, SET_IDS, type SetId } from "@/game/sets";
import type { DeclarationMode } from "@/game/types/declaration";
import type { PlayerId } from "@/game/types/player";
import type { TeamId } from "@/game/types/team";

export type PlayerRelationship = "team" | "opponent";

export type VisiblePlayer = Readonly<{
  id: PlayerId;
  displayName: string;
  relationship: PlayerRelationship;
  cardCount: number;
  isCurrentTurn: boolean;
}>;

/** Public lock details only; the authoritative ownership snapshot never crosses this boundary. */
export type PublicActiveDeclaration = Readonly<{
  declarerId: PlayerId;
  declarerTeamId: TeamId;
  mode: DeclarationMode;
  selectedSetId: SetId;
  startedAt: number;
  deadline: number;
}>;

/**
 * The only state shape presentation components receive. It intentionally has
 * no teammate or opponent hand data, ownership map, or declaration snapshot.
 */
export type PlayerGameView = Readonly<{
  localPlayer: Readonly<{ id: PlayerId; displayName: string; teamId: TeamId }>;
  visibleHand: readonly CardId[];
  visiblePlayers: readonly VisiblePlayer[];
  currentTurnOwner: Readonly<{ id: PlayerId; displayName: string; isLocal: boolean }>;
  phase: NormalPlayGameState["phase"];
  canAsk: boolean;
  teamScore: number;
  opponentScore: number;
  resolvedSetIds: readonly SetId[];
  unresolvedSetIds: readonly SetId[];
  activeDeclaration: PublicActiveDeclaration | null;
  blindDeclarationTeamId: TeamId | null;
  blindDeclarerId: PlayerId | null;
  winnerTeamId: TeamId | null;
  winnerLabel: string | null;
}>;

export type AskWorkbenchCard = Readonly<{
  cardId: CardId;
  isInHand: boolean;
  isRequestable: boolean;
  isSelected: boolean;
}>;

export type AskWorkbenchView = Readonly<{
  setId: SetId;
  setLabel: string;
  isResolved: boolean;
  cards: readonly AskWorkbenchCard[];
}>;

const SET_LABELS: Readonly<Record<SetId, string>> = Object.freeze({
  LOW_HEARTS: "Low Hearts",
  LOW_DIAMONDS: "Low Diamonds",
  LOW_CLUBS: "Low Clubs",
  LOW_SPADES: "Low Spades",
  HIGH_HEARTS: "High Hearts",
  HIGH_DIAMONDS: "High Diamonds",
  HIGH_CLUBS: "High Clubs",
  HIGH_SPADES: "High Spades",
  EIGHTS_JOKERS: "Eights + Jokers",
});

export const getSetLabel = (setId: SetId): string => SET_LABELS[setId];

/** Converts private local state into the player-scoped shape the UI may render. */
export const createPlayerGameView = (
  state: NormalPlayGameState,
  localPlayerId: PlayerId,
): PlayerGameView => {
  const localPlayer = state.players.find((player) => player.id === localPlayerId);
  const turnOwner = state.players.find((player) => player.id === state.currentTurnOwner);

  if (!localPlayer || !turnOwner) {
    throw new Error("The local game harness must use a player in the authoritative state.");
  }

  const visiblePlayers = state.players
    .filter((player) => player.id !== localPlayerId)
    .map((player) => Object.freeze({
      id: player.id,
      displayName: player.displayName,
      relationship: player.teamId === localPlayer.teamId ? "team" : "opponent",
      cardCount: player.hand.length,
      isCurrentTurn: player.id === state.currentTurnOwner,
    }));
  const opposingTeamId = localPlayer.teamId === "TEAM_A" ? "TEAM_B" : "TEAM_A";
  const winnerLabel = state.winnerTeamId === null
    ? null
    : state.winnerTeamId === localPlayer.teamId ? "Your team wins" : "Their team wins";
  const activeDeclaration = state.activeDeclaration === null
    ? null
    : Object.freeze({
      declarerId: state.activeDeclaration.declarerId,
      declarerTeamId: state.activeDeclaration.declarerTeamId,
      mode: state.activeDeclaration.mode,
      selectedSetId: state.activeDeclaration.selectedSetId,
      startedAt: state.activeDeclaration.startedAt,
      deadline: state.activeDeclaration.deadline,
    });

  return Object.freeze({
    localPlayer: Object.freeze({
      id: localPlayer.id,
      displayName: localPlayer.displayName,
      teamId: localPlayer.teamId,
    }),
    visibleHand: Object.freeze([...localPlayer.hand]),
    visiblePlayers: Object.freeze(visiblePlayers),
    currentTurnOwner: Object.freeze({
      id: turnOwner.id,
      displayName: turnOwner.displayName,
      isLocal: turnOwner.id === localPlayerId,
    }),
    phase: state.phase,
    canAsk: state.phase === "PLAYING" && state.normalAskingAllowed && state.currentTurnOwner === localPlayerId,
    teamScore: state.scores[localPlayer.teamId],
    opponentScore: state.scores[opposingTeamId],
    resolvedSetIds: Object.freeze([...state.resolvedSetIds]),
    unresolvedSetIds: Object.freeze(SET_IDS.filter((setId) => !state.resolvedSetIds.includes(setId))),
    activeDeclaration,
    blindDeclarationTeamId: state.blindDeclarationTeamId,
    blindDeclarerId: state.blindDeclarerId,
    winnerTeamId: state.winnerTeamId,
    winnerLabel,
  });
};

/**
 * Produces the public set workbench. Set membership is supplied by the domain;
 * this adapter never consults another player's hand to decide availability.
 */
export const createAskWorkbenchView = (
  view: PlayerGameView,
  setId: SetId,
  selectedRequestedCardId?: CardId,
): AskWorkbenchView => {
  const isResolved = view.resolvedSetIds.includes(setId);
  const cards = getCardsInSet(setId).map((cardId) => {
    const isInHand = view.visibleHand.includes(cardId);

    return Object.freeze({
      cardId,
      isInHand,
      isRequestable: !isResolved && !isInHand,
      isSelected: selectedRequestedCardId === cardId,
    });
  });

  return Object.freeze({
    setId,
    setLabel: getSetLabel(setId),
    isResolved,
    cards: Object.freeze(cards),
  });
};
