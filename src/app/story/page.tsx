import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { PlayingCard } from "@/components/cards/PlayingCard";

export const metadata: Metadata = {
  title: "Why I built it",
  description: "How Declaration keeps a longtime friend-group card-game ritual alive across distance.",
};

const projectSummary = [
  ["Built for", "Six longtime friends"],
  ["My role", "Product, UX, and implementation"],
  ["Goal", "Keep the ritual alive"],
] as const;

const decisions = [
  [
    "Private seats, no accounts",
    "One secure link gives each player their hand without a signup; recovery stays tied to that browser.",
  ],
  [
    "One trusted table",
    "The server owns turns, cards, declarations, and scoring, which adds backend work but keeps the game dependable.",
  ],
  [
    "Conversation stays on the call",
    "Declaration works alongside FaceTime or Discord instead of rebuilding them, so the group brings its usual call.",
  ],
  [
    "A deck that feels like ours",
    "Custom art keeps the game specific to the people who play it, though other groups cannot personalize a deck yet.",
  ],
] as const;

const metrics = [
  ["Activation", "Do all six players join?"],
  ["Time to first move", "How quickly does play begin?"],
  ["Completion", "Does the group finish the game?"],
  ["Repeat play", "Do they organize another one?"],
] as const;

export default function ProductStoryPage() {
  return (
    <div className="story-page">
      <header className="story-nav">
        <Link className="brand-lockup" href="/" aria-label="Declaration home">
          <span className="brand-lockup__mark" aria-hidden="true">D</span>
          <span>DECLARATION</span>
        </Link>
        <nav aria-label="Primary navigation">
          <Link href="/demo">Demo</Link>
          <Link href="/">Start a game</Link>
        </nav>
      </header>

      <main>
        <section className="story-hero" aria-labelledby="story-heading">
          <p className="eyebrow">Why I built Declaration</p>
          <h1 id="story-heading">We moved away. The game came with us.</h1>
          <div className="story-hero__copy">
            <p>
              Declaration was the game my high-school friends always played together. When we moved to different
              places, I built a version we could play from anywhere—private hands on our phones, conversation on
              the call we already use.
            </p>
          </div>
          <dl className="story-summary">
            {projectSummary.map(([term, detail]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{detail}</dd>
              </div>
            ))}
          </dl>
        </section>

        <figure className="story-photo">
          <Image
            src="/images/declaration-friend-group.webp"
            alt="Nine longtime friends standing together outside on a sunny day."
            width={1600}
            height={900}
            sizes="(max-width: 48rem) calc(100vw - 2rem), min(100vw - 2rem, 78rem)"
            loading="eager"
          />
          <figcaption>The original Declaration group—the people behind the deck.</figcaption>
        </figure>

        <section className="story-section story-problem" aria-labelledby="problem-heading">
          <div className="story-section__heading">
            <p className="eyebrow">The problem</p>
            <h2 id="problem-heading">Keep the game, not the logistics.</h2>
          </div>
          <div className="story-problem__copy">
            <p>
              Playing from different places meant no shared deck, no private way to hold six hands, and no trusted
              record of turns, declarations, or scoring.
            </p>
            <p>
              A generic card site could run a game, but it could not preserve the parts that made this one ours.
            </p>
          </div>
          <p className="story-problem__question">How can software preserve the ritual without replacing the interaction?</p>
        </section>

        <section className="story-section story-build" aria-labelledby="build-heading">
          <div className="story-section__heading">
            <p className="eyebrow">What I built</p>
            <h2 id="build-heading">Four choices kept the first version focused.</h2>
          </div>
          <ol className="story-decisions">
            {decisions.map(([title, detail], index) => (
              <li key={title}>
                <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="story-section story-deck" aria-labelledby="deck-heading">
          <div className="story-section__heading">
            <p className="eyebrow">The custom deck</p>
            <h2 id="deck-heading">A deck that feels like ours.</h2>
          </div>
          <div className="story-deck__content">
            <p>
              The 54 cards turn friends, memories, and inside jokes into the deck itself. That makes a remote game
              feel like our table instead of a generic card site.
            </p>
            <div className="story-deck__cards" aria-label="A selection of custom Declaration card artwork">
              <PlayingCard cardId="7H" decorative />
              <PlayingCard cardId="JD" decorative />
              <PlayingCard cardId="8S" decorative />
              <PlayingCard cardId="AC" decorative />
              <PlayingCard cardId="RED_JOKER" decorative />
            </div>
          </div>
        </section>

        <section className="story-section story-system" aria-labelledby="system-heading">
          <div className="story-section__heading">
            <p className="eyebrow">How it works</p>
            <h2 id="system-heading">One table, six private views.</h2>
          </div>
          <div className="story-system-flow" aria-label="Multiplayer information flow">
            <div><strong>PostgreSQL</strong><span>Canonical game state</span></div>
            <span aria-hidden="true">→</span>
            <div><strong>Game server</strong><span>Rules and credentials</span></div>
            <span aria-hidden="true">→</span>
            <div><strong>Six phones</strong><span>Private hand + public table</span></div>
          </div>
          <p className="story-system__note">
            The server keeps one authoritative game while each phone receives only its player’s private hand and the
            public table state.
          </p>
        </section>

        <section className="story-section story-metrics-section" aria-labelledby="metrics-heading">
          <div className="story-section__heading">
            <p className="eyebrow">What I’ll measure</p>
            <h2 id="metrics-heading">Four signals from the first tables.</h2>
          </div>
          <ul className="story-metrics" aria-label="Declaration launch measures">
            {metrics.map(([name, detail]) => (
              <li key={name}><strong>{name}</strong><span>{detail}</span></li>
            ))}
          </ul>
          <p className="story-metrics__note">These are launch measures, not claimed results.</p>
        </section>

        <section className="story-next" aria-labelledby="next-heading">
          <div>
            <p className="eyebrow">Next</p>
            <h2 id="next-heading">Test, learn, then expand.</h2>
          </div>
          <p>
            I’ll test first with the original group, fix repeated setup or gameplay problems, and only expand the
            product when the evidence supports it.
          </p>
          <div className="story-next__actions">
            <Link className="button button--primary" href="/demo">Try the playable demo</Link>
            <a className="landing-text-link" href="https://github.com/benllados/Declaration">Read the source <span aria-hidden="true">→</span></a>
          </div>
        </section>
      </main>
    </div>
  );
}
