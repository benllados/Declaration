import { CANONICAL_DECK } from "../../src/game/cards";
import { startDeclaration } from "../../src/game/engine/declaration";
import { createNormalPlayState, type NormalPlayGameState } from "../../src/game/engine/normal-play";
import { getCardsInSet, getSetForCard, SET_IDS } from "../../src/game/sets";
import type { PlayerId } from "../../src/game/types/player";
import { LOCAL_PLAYER_SETUPS, LOCAL_PLAYERS, createDeterministicLocalGame } from "../../src/lib/local-game";
import type { SeatIdentity } from "../../src/server/game-session/seat-identity";
import { ENGINE_VERSION, type StoredGameRecord } from "../../src/server/game-session/stored-record";
import type { ServerClock } from "../../src/server/game-session/server-clock";

export const GAME_ID = "game-12";

export class TestServerClock implements ServerClock {
  constructor(private value: number) {}

  now = (): number => this.value;

  set(value: number): void {
    this.value = value;
  }
}

export const seatFor = (playerId: PlayerId): SeatIdentity => ({
  seatId: `seat-${playerId}`,
  gameId: GAME_ID,
  playerId,
});

export const createRecord = (
  state: NormalPlayGameState = createDeterministicLocalGame(),
  revision = 0,
): StoredGameRecord => ({
  gameId: GAME_ID,
  engineVersion: ENGINE_VERSION,
  revision,
  state,
  processedActions: [],
});

/** The selected set is owned by Avery's team, enabling both correct and malformed submissions. */
export const createDeclarationReadyState = (): NormalPlayGameState => {
  const selectedCards = getCardsInSet("LOW_HEARTS");
  const otherCards = CANONICAL_DECK.map((card) => card.id).filter((cardId) => !selectedCards.includes(cardId));
  return createNormalPlayState({
    players: LOCAL_PLAYER_SETUPS.map((player) => ({
      ...player,
      hand: player.id === LOCAL_PLAYERS.avery
        ? [selectedCards[0]]
        : player.id === LOCAL_PLAYERS.jules
          ? selectedCards.slice(1, 3)
          : player.id === LOCAL_PLAYERS.noa
            ? selectedCards.slice(3)
            : player.id === LOCAL_PLAYERS.maya
              ? otherCards
              : [],
    })),
    currentTurnOwner: LOCAL_PLAYERS.avery,
    scores: { TEAM_A: 0, TEAM_B: 0 },
  });
};

export const createActiveDeclarationState = (startedAt = 100): NormalPlayGameState =>
  startDeclaration(createDeclarationReadyState(), {
    declarerId: LOCAL_PLAYERS.avery,
    selectedSetId: "LOW_HEARTS",
    startedAt,
  }).state;

export const correctAssignments = (state: NormalPlayGameState) =>
  state.activeDeclaration!.ownershipSnapshot.map(({ cardId, ownerId }) => ({ cardId, playerId: ownerId }));

export const createBlindState = (): NormalPlayGameState => {
  const resolvedSetIds = SET_IDS.slice(0, 7);
  const activeCards = CANONICAL_DECK
    .map((card) => card.id)
    .filter((cardId) => !resolvedSetIds.includes(getSetForCard(cardId)));
  return createNormalPlayState({
    players: LOCAL_PLAYER_SETUPS.map((player) => ({
      ...player,
      hand: player.teamId === "TEAM_B" && player.id === LOCAL_PLAYERS.maya ? activeCards : [],
    })),
    currentTurnOwner: LOCAL_PLAYERS.avery,
    resolvedSetIds,
    scores: { TEAM_A: resolvedSetIds.length, TEAM_B: 0 },
    phase: "BLIND_DECLARATION",
    blindDeclarationTeamId: "TEAM_B",
  });
};

export const createGameOverState = (): NormalPlayGameState =>
  createNormalPlayState({
    players: LOCAL_PLAYER_SETUPS.map((player) => ({ ...player, hand: [] })),
    currentTurnOwner: LOCAL_PLAYERS.avery,
    resolvedSetIds: SET_IDS,
    scores: { TEAM_A: 5, TEAM_B: 4 },
    phase: "GAME_OVER",
  });

export const findLegalAsk = (state: NormalPlayGameState) => {
  const asker = state.players.find((player) => player.id === LOCAL_PLAYERS.avery)!;
  const requestedCardId = getCardsInSet(getSetForCard(asker.hand[0])).find((cardId) => !asker.hand.includes(cardId))!;
  return { targetPlayerId: LOCAL_PLAYERS.maya, requestedCardId };
};
