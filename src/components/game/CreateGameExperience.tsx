"use client";

import { useState } from "react";
import Link from "next/link";

import { PlayingCard } from "@/components/cards/PlayingCard";
import { Button } from "@/components/ui/Button";

const PLAYER_COUNT = 6;
const HERO_HAND = ["6S", "7H", "10C", "QD", "JD", "KC", "AH", "8S", "RED_JOKER"] as const;

type CreatedInvitation = Readonly<{ displayName: string; joinPath: string }>;
type CreatedGame = Readonly<{ gameId: string; invitations: readonly CreatedInvitation[] }>;
type ShareFeedback = Readonly<{ joinPath: string; label: "Copied" | "Shared" }>;

const isCreatedGame = (value: unknown): value is CreatedGame => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.gameId === "string"
    && Array.isArray(record.invitations)
    && record.invitations.every((invite) => (
      !!invite
      && typeof invite === "object"
      && typeof (invite as Record<string, unknown>).displayName === "string"
      && typeof (invite as Record<string, unknown>).joinPath === "string"
    ));
};

/** The no-account starting point for a six-seat Declaration game. */
export function CreateGameExperience() {
  const [names, setNames] = useState<string[]>(() => Array.from({ length: PLAYER_COUNT }, () => ""));
  const [created, setCreated] = useState<CreatedGame>();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string>();
  const [shareFeedback, setShareFeedback] = useState<ShareFeedback>();

  const updateName = (index: number, value: string) => {
    setNames((current) => current.map((name, currentIndex) => currentIndex === index ? value : name));
    setError(undefined);
  };

  const createGame = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    setIsCreating(true);
    try {
      const response = await fetch("/api/games", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerNames: names }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isCreatedGame(payload)) {
        setError(response.status === 400 ? "Enter six different names to start the table." : "We couldn’t create the game. Try again.");
        return;
      }
      setCreated(payload);
    } catch {
      setError("We couldn’t create the game. Check your connection and try again.");
    } finally {
      setIsCreating(false);
    }
  };

  const showShareFeedback = (feedback: ShareFeedback) => {
    setShareFeedback(feedback);
    window.setTimeout(() => {
      setShareFeedback((current) => current?.joinPath === feedback.joinPath ? undefined : current);
    }, 2_000);
  };

  const shareInvitation = async (invitation: CreatedInvitation) => {
    const url = new URL(invitation.joinPath, window.location.origin).toString();

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: "Your Declaration seat",
          text: `${invitation.displayName}, your private seat is ready.`,
          url,
        });
        showShareFeedback({ joinPath: invitation.joinPath, label: "Shared" });
        return;
      } catch (shareError) {
        if (shareError instanceof DOMException && shareError.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      showShareFeedback({ joinPath: invitation.joinPath, label: "Copied" });
    } catch {
      setError("Copying isn’t available here. Open the link, then share it from your browser.");
    }
  };

  if (created) {
    const hostInvitation = created.invitations[0];
    return (
      <main className="session-page">
        <section className="session-surface session-surface--wide" aria-labelledby="share-game-heading">
          <div className="brand-lockup"><span className="brand-lockup__mark" aria-hidden="true">D</span><span>DECLARATION</span></div>
          <p className="eyebrow">Table ready</p>
          <h1 id="share-game-heading">Send the seat links.</h1>
          <p className="session-copy">Each link opens one private hand.</p>
          <div className="invite-list" aria-label="Player invitations">
            {created.invitations.map((invitation, index) => (
              <article className="invite-card" key={invitation.joinPath}>
                <div>
                  <span>Seat {index + 1}</span>
                  <strong>{invitation.displayName}</strong>
                </div>
                <Button onClick={() => void shareInvitation(invitation)} variant="secondary">
                  {shareFeedback?.joinPath === invitation.joinPath ? shareFeedback.label : "Share seat"}
                </Button>
              </article>
            ))}
          </div>
          <a className="button button--primary session-continue" href={hostInvitation.joinPath}>Join as {hostInvitation.displayName}</a>
          <p className="session-note">Keep this page open until everyone has their link.</p>
        </section>
      </main>
    );
  }

  return (
    <div className="landing-page">
      <header className="landing-nav">
        <Link className="brand-lockup" href="/" aria-label="Declaration home">
          <span className="brand-lockup__mark" aria-hidden="true">D</span>
          <span>DECLARATION</span>
        </Link>
        <nav aria-label="Primary navigation">
          <Link href="/story">Story</Link>
          <Link href="/demo">Demo</Link>
        </nav>
      </header>

      <main>
        <section className="landing-hero" aria-labelledby="landing-heading">
          <div className="landing-hero__copy">
            <p className="eyebrow">Six friends · wherever you are</p>
            <h1 id="landing-heading">Play Declaration with friends, wherever you are.</h1>
            <p>
              Each player gets a private hand on their phone. Keep talking on the call your group already uses, share the seat links, and play.
            </p>
            <div className="landing-hero__actions">
              <a className="button button--primary" href="#create-game">Start a game</a>
              <Link className="landing-text-link" href="/demo">Try the demo <span aria-hidden="true">→</span></Link>
            </div>
            <ul className="landing-proof" aria-label="Game features">
              <li><strong>Six friends</strong><span>Two teams of three.</span></li>
              <li><strong>Private hands</strong><span>One secure link per player.</span></li>
              <li><strong>Custom deck</strong><span>54 cards based on our friend group.</span></li>
            </ul>
          </div>

          <div className="landing-card-artwork">
            <div
              className="landing-card-stage"
              role="img"
              aria-label="A fanned nine-card Declaration hand: Six of Spades, Seven of Hearts, Ten of Clubs, Queen of Diamonds, Jack of Diamonds, King of Clubs, Ace of Hearts, Eight of Spades, and Red Joker."
            >
              {HERO_HAND.map((cardId, index) => (
                <div className={`landing-card landing-card--fan-${index + 1}`} key={cardId}>
                  <PlayingCard cardId={cardId} decorative priority={cardId === "JD"} />
                </div>
              ))}
            </div>
            <p className="landing-card-caption">54 cards. All based on our friends.</p>
          </div>
        </section>

        <section className="landing-how" aria-labelledby="how-heading">
          <div>
            <p className="eyebrow">How it works</p>
            <h2 id="how-heading">Start in three steps.</h2>
          </div>
          <ol>
            <li><span>01</span><strong>Add six players</strong><p>Enter three names for each team.</p></li>
            <li><span>02</span><strong>Send the links</strong><p>Each player gets a private seat.</p></li>
            <li><span>03</span><strong>Stay on your usual call</strong><p>Ask for cards and make declarations.</p></li>
          </ol>
        </section>

        <section className="session-surface landing-create" id="create-game" aria-labelledby="start-game-heading">
          <p className="eyebrow">Start a game</p>
          <h2 id="start-game-heading">Create a game</h2>
          <p className="session-copy">Enter three players per team.</p>
          <form className="create-game-form" onSubmit={(event) => void createGame(event)}>
            <fieldset disabled={isCreating}>
              <legend>Team A</legend>
              {names.slice(0, 3).map((name, index) => (
                <label key={index}>
                  <span>Player {index + 1}</span>
                  <input autoComplete="name" maxLength={32} onChange={(event) => updateName(index, event.target.value)} placeholder={`Player ${index + 1}`} required value={name} />
                </label>
              ))}
            </fieldset>
            <fieldset disabled={isCreating}>
              <legend>Team B</legend>
              {names.slice(3).map((name, offset) => {
                const index = offset + 3;
                return (
                  <label key={index}>
                    <span>Player {index + 1}</span>
                    <input autoComplete="name" maxLength={32} onChange={(event) => updateName(index, event.target.value)} placeholder={`Player ${index + 1}`} required value={name} />
                  </label>
                );
              })}
            </fieldset>
            {error ? <p className="session-error" role="alert">{error}</p> : null}
            <Button className="create-game-form__submit" disabled={isCreating} type="submit">
              {isCreating ? "Dealing…" : "Create game"}
            </Button>
          </form>
        </section>
      </main>

      <footer className="landing-footer">
        <span>For six friends, wherever they are.</span>
        <div><Link href="/demo">Demo</Link><Link href="/story">Story</Link><a href="https://github.com/benllados/Declaration">GitHub</a></div>
      </footer>
    </div>
  );
}
