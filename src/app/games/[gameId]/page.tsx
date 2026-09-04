import { notFound } from "next/navigation";

import { RemoteGameplayExperience } from "@/components/game/RemoteGameplayExperience";
import { isOpaqueId } from "@/lib/multiplayer/action-codec";

export const dynamic = "force-dynamic";

export default async function GamePage({ params }: Readonly<{ params: Promise<{ gameId: string }> }>) {
  const { gameId } = await params;
  if (!isOpaqueId(gameId)) notFound();
  return <RemoteGameplayExperience gameId={gameId} />;
}
