import type { Metadata } from "next";
import Link from "next/link";

import { GameplayExperience } from "@/components/game/GameplayExperience";

export const metadata: Metadata = {
  title: "Playable demo",
  description: "Try one deterministic turn of Declaration without creating a live six-player game.",
};

export default function DemoPage() {
  return (
    <div className="demo-experience">
      <header className="demo-intro">
        <nav aria-label="Demo navigation">
          <Link className="brand-lockup" href="/">
            <span className="brand-lockup__mark" aria-hidden="true">D</span>
            <span>DECLARATION</span>
          </Link>
          <Link href="/">Back to home</Link>
        </nav>
        <div className="demo-intro__copy">
          <div>
            <p className="eyebrow">Demo</p>
            <h1>Try one turn.</h1>
          </div>
          <p>
            Choose a card from Avery’s hand, ask an opponent, or make a declaration. The demo runs on this device.
          </p>
        </div>
      </header>
      <GameplayExperience controls="demo" />
    </div>
  );
}
