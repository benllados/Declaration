"use client";

import { useState } from "react";

import { CANONICAL_DECK, type CardId } from "@/game/cards";

import { CardHand } from "../cards/CardHand";
import { PlayingCard } from "../cards/PlayingCard";
import { Button } from "../ui/Button";
import { PlayerToken } from "../ui/PlayerToken";
import { ScoreDisplay } from "../ui/ScoreDisplay";

const handCards: readonly CardId[] = ["3H", "7H", "9C", "JC", "KC", "8D", "QS", "AH", "BLACK_JOKER"];

const tokenColors = [
  ["Canvas", "var(--color-canvas)"],
  ["Surface", "var(--color-surface)"],
  ["Primary", "var(--color-primary)"],
  ["Declaration", "var(--color-declaration)"],
  ["Success", "var(--color-success)"],
  ["Highlight", "var(--color-highlight)"],
] as const;

export function ComponentShowcase() {
  const [selectedCardId, setSelectedCardId] = useState<CardId>("9C");

  return (
    <main className="showcase">
      <header className="showcase__masthead">
        <div className="brand-lockup" aria-label="Declaration">
          <span className="brand-lockup__mark" aria-hidden="true">✦</span>
          <span>DECLARATION</span>
        </div>
        <p>Build 09 <span aria-hidden="true">•</span> Internal component showcase</p>
      </header>

      <div className="showcase__intro">
        <p className="eyebrow">Production visual system</p>
        <h1>Custom cards, made tactile.</h1>
        <p>
          A mobile-first foundation for the frozen Declaration engine. These are presentation primitives only;
          no gameplay, card ownership, or multiplayer state is wired here.
        </p>
      </div>

      <section className="showcase-section" aria-labelledby="tokens-heading">
        <div className="section-heading">
          <p className="eyebrow">Foundation</p>
          <h2 id="tokens-heading">Colour and type</h2>
        </div>
        <div className="token-list" aria-label="Semantic color tokens">
          {tokenColors.map(([name, color]) => (
            <div className="color-token" key={name}>
              <span className="color-token__swatch" style={{ backgroundColor: color }} aria-hidden="true" />
              <span>{name}</span>
            </div>
          ))}
        </div>
        <div className="type-sample">
          <span className="type-sample__brand">DECLARATION</span>
          <span className="type-sample__interface">Friendly, legible interface text at phone scale.</span>
        </div>
      </section>

      <section className="showcase-section" aria-labelledby="buttons-heading">
        <div className="section-heading">
          <p className="eyebrow">Actions</p>
          <h2 id="buttons-heading">Button hierarchy</h2>
        </div>
        <div className="button-row">
          <Button>Ask for a card</Button>
          <Button variant="declaration">Declare a set</Button>
          <Button variant="secondary">Rules</Button>
          <Button disabled>Unavailable</Button>
        </div>
      </section>

      <section className="showcase-section" aria-labelledby="players-heading">
        <div className="section-heading">
          <p className="eyebrow">People</p>
          <h2 id="players-heading">Player tokens</h2>
        </div>
        <div className="player-token-row">
          <PlayerToken name="Avery Cole" cardCount={9} team="team" active />
          <PlayerToken name="Jordan Park" cardCount={7} team="team" selected />
          <PlayerToken name="Sage Rivers" cardCount={11} team="opponent" />
          <PlayerToken name="Nico Lane" cardCount={0} team="neutral" size="small" />
        </div>
      </section>

      <section className="showcase-section" aria-labelledby="score-heading">
        <div className="section-heading">
          <p className="eyebrow">Score</p>
          <h2 id="score-heading">At-a-glance team score</h2>
        </div>
        <ScoreDisplay teamLabel="Your Team" teamScore={2} opponentLabel="Opponents" opponentScore={1} />
      </section>

      <section className="showcase-section" aria-labelledby="cards-heading">
        <div className="section-heading">
          <p className="eyebrow">Custom deck</p>
          <h2 id="cards-heading">Card states and suits</h2>
          <p>Artwork is the complete face—interaction styling sits around it, never on top of it.</p>
        </div>
        <div className="card-sample-groups">
          <div>
            <h3>Eight across every suit</h3>
            <div className="card-row">
              {(["8H", "8D", "8C", "8S"] as const).map((cardId) => <PlayingCard key={cardId} cardId={cardId} />)}
            </div>
          </div>
          <div>
            <h3>Face-card collection</h3>
            <div className="card-row">
              {(["KH", "KD", "KC", "KS"] as const).map((cardId) => <PlayingCard key={cardId} cardId={cardId} />)}
            </div>
          </div>
          <div>
            <h3>Presentation states</h3>
            <div className="card-row">
              <PlayingCard cardId="AH" />
              <PlayingCard cardId="QC" selected />
              <PlayingCard cardId="7S" disabled />
              <PlayingCard cardId="RED_JOKER" />
              <PlayingCard cardId="BLACK_JOKER" />
            </div>
          </div>
        </div>
      </section>

      <section className="showcase-section showcase-section--hand" aria-labelledby="hand-heading">
        <div className="section-heading">
          <p className="eyebrow">Hand primitive</p>
          <h2 id="hand-heading">A nine-card fan</h2>
          <p>Tap a card to inspect the selected lift state. The order is exactly the input order.</p>
        </div>
        <CardHand
          cardIds={handCards}
          selectedCardId={selectedCardId}
          disabledCardIds={["8D"]}
          onSelectedCardChange={setSelectedCardId}
          hint="Tap a card to inspect"
        />
      </section>

      <section className="showcase-section showcase-section--deck" aria-labelledby="deck-heading">
        <div className="section-heading">
          <p className="eyebrow">Asset inspection</p>
          <h2 id="deck-heading">All 54 production card faces</h2>
          <p>Every card below is rendered through the one typed engine CardId-to-asset helper.</p>
        </div>
        <div className="deck-grid">
          {CANONICAL_DECK.map((card) => <PlayingCard cardId={card.id} size="compact" key={card.id} />)}
        </div>
      </section>
    </main>
  );
}
