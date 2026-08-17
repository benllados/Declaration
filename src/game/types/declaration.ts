import type { CardId } from "./card";
import type { PlayerId } from "./player";
import type { TeamId } from "./team";
import type { SetId } from "../sets";

/**
 * Server-authoritative timestamps are caller-supplied seconds. The declaration
 * deadline is always `startedAt + 90`; the engine never reads the wall clock.
 */
export type AuthoritativeTimestamp = number;

export type TeamScores = Readonly<Record<TeamId, number>>;

/** Internal ownership captured when an official declaration starts. */
export type DeclarationCardOwnership = Readonly<{
  cardId: CardId;
  ownerId: PlayerId;
}>;

/**
 * Authoritative state for the currently frozen normal declaration. This is
 * server state, not a client-facing event payload; its snapshot is private.
 */
export type ActiveDeclaration = Readonly<{
  declarerId: PlayerId;
  declarerTeamId: TeamId;
  selectedSetId: SetId;
  startedAt: AuthoritativeTimestamp;
  deadline: AuthoritativeTimestamp;
  interruptedTurnOwner: PlayerId;
  ownershipSnapshot: readonly DeclarationCardOwnership[];
}>;
