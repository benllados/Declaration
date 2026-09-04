import { notFound } from "next/navigation";

import { JoinGameExperience } from "@/components/game/JoinGameExperience";
import { isOpaqueId } from "@/lib/multiplayer/action-codec";

export const dynamic = "force-dynamic";

/** This route intentionally never receives the invitation secret: it is a fragment. */
export default async function JoinPage({ params }: Readonly<{ params: Promise<{ gameId: string }> }>) {
  const { gameId } = await params;
  if (!isOpaqueId(gameId)) notFound();
  return <JoinGameExperience gameId={gameId} />;
}
