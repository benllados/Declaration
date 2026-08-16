import type { CardId } from "./cards";
import type { Player, PlayerId } from "./types/player";

export const getPlayerHand = (players: readonly Player[], playerId: PlayerId): readonly CardId[] | undefined => players.find((player) => player.id === playerId)?.hand;
export const playerHasCard = (players: readonly Player[], playerId: PlayerId, cardId: CardId): boolean => getPlayerHand(players, playerId)?.includes(cardId) ?? false;
export const getPlayerCardCount = (players: readonly Player[], playerId: PlayerId): number => getPlayerHand(players, playerId)?.length ?? 0;
export const getCardOwner = (players: readonly Player[], cardId: CardId): Player | undefined => players.find((player) => player.hand.includes(cardId));
