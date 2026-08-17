"use client";

import { useEffect, useMemo, useState } from "react";

import { CardHand } from "@/components/cards/CardHand";
import { PlayingCard } from "@/components/cards/PlayingCard";
import { getCardAccessibleName } from "@/components/cards/card-assets";
import { Button } from "@/components/ui/Button";
import { PlayerToken } from "@/components/ui/PlayerToken";
import { ScoreDisplay } from "@/components/ui/ScoreDisplay";
import type { CardId } from "@/game/cards";
import { getSetForCard, type SetId } from "@/game/sets";
import {
  createAskFeedback,
  createAskWorkbenchView,
  createDeterministicLocalGame,
  createLocalAskAction,
  createPlayerGameView,
  DEFAULT_LOCAL_PLAYER_ID,
  LOCAL_PLAYER_SETUPS,
  resolveLocalAsk,
  type AskFeedback,
  type AskWorkbenchView,
  type PlayerGameView,
} from "@/lib/local-game";
import type { PlayerId } from "@/game/types/player";

type AskWorkbenchProps = Readonly<{
  view: PlayerGameView;
  workbench: AskWorkbenchView;
  selectedRequestedCardId?: CardId;
  selectedTargetId?: PlayerId;
  onClose: () => void;
  onRequestCardChange: (cardId: CardId) => void;
  onTargetChange: (playerId: PlayerId) => void;
  onSubmit: () => void;
}>;

function AskWorkbench({
  view,
  workbench,
  selectedRequestedCardId,
  selectedTargetId,
  onClose,
  onRequestCardChange,
  onTargetChange,
  onSubmit,
}: AskWorkbenchProps) {
  const opponents = view.visiblePlayers.filter((player) => player.relationship === "opponent");
  const selectedTarget = opponents.find((player) => player.id === selectedTargetId);
  const canSubmit = view.canAsk && selectedRequestedCardId !== undefined && selectedTarget !== undefined;
  const actionLabel = canSubmit
    ? `Ask ${selectedTarget.displayName} for ${getCardAccessibleName(selectedRequestedCardId)}`
    : "Choose a card and opponent";

  return (
    <aside className="ask-workbench" aria-label={`Ask from ${workbench.setLabel}`}>
      <div className="ask-workbench__heading">
        <div>
          <p className="eyebrow">Ask from</p>
          <h2>{workbench.setLabel}</h2>
        </div>
        <button className="ask-workbench__close" type="button" onClick={onClose} aria-label="Close ask workbench">
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <div className="ask-workbench__cards" aria-label={`${workbench.setLabel} cards`}>
        {workbench.cards.map((card) => (
          <div className="ask-workbench__card" key={card.cardId}>
            <PlayingCard
              cardId={card.cardId}
              size="compact"
              selected={card.isSelected}
              disabled={!card.isRequestable || !view.canAsk}
              onClick={card.isRequestable && view.canAsk ? () => onRequestCardChange(card.cardId) : undefined}
            />
            {card.isInHand ? <span className="ask-workbench__card-note">In hand</span> : null}
          </div>
        ))}
      </div>

      <div className="ask-workbench__target-section">
        <p>Choose an opponent</p>
        <div className="ask-workbench__targets" aria-label="Choose an opponent">
          {opponents.map((opponent) => (
            <PlayerToken
              cardCount={opponent.cardCount}
              disabled={!view.canAsk || opponent.cardCount === 0}
              key={opponent.id}
              name={opponent.displayName}
              selected={opponent.id === selectedTargetId}
              active={opponent.isCurrentTurn}
              onClick={() => onTargetChange(opponent.id)}
              size="small"
              team="opponent"
            />
          ))}
        </div>
      </div>

      <Button className="ask-workbench__submit" disabled={!canSubmit} onClick={onSubmit}>
        {actionLabel}
      </Button>
    </aside>
  );
}

function FeedbackNotice({ feedback, onDismiss }: Readonly<{ feedback: AskFeedback; onDismiss: () => void }>) {
  return (
    <div className={`ask-feedback ask-feedback--${feedback.tone}`} role="status" aria-live="polite">
      {feedback.cardId ? (
        <div className="ask-feedback__card" aria-hidden="true">
          <PlayingCard cardId={feedback.cardId} size="compact" />
        </div>
      ) : null}
      <div>
        <strong>{feedback.title}</strong>
        <span>{feedback.detail}</span>
      </div>
      <button className="ask-feedback__dismiss" type="button" onClick={onDismiss} aria-label="Dismiss update">
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

const getPhaseMessage = (view: PlayerGameView): string | null => {
  if (view.phase === "DECLARING") return "A declaration is in progress. Normal asks are paused.";
  if (view.phase === "BLIND_DECLARATION") return "Blind Declaration is ready. Its flow arrives in Build 11.";
  if (view.phase === "GAME_OVER") return view.winnerLabel ?? "This game is complete.";
  return null;
};

/** The production root's local single-client integration surface. */
export function GameplayExperience() {
  const [gameState, setGameState] = useState(createDeterministicLocalGame);
  const [localPlayerId, setLocalPlayerId] = useState<PlayerId>(DEFAULT_LOCAL_PLAYER_ID);
  const [selectedSourceCardId, setSelectedSourceCardId] = useState<CardId>();
  const [selectedRequestedCardId, setSelectedRequestedCardId] = useState<CardId>();
  const [selectedTargetId, setSelectedTargetId] = useState<PlayerId>();
  const [feedback, setFeedback] = useState<AskFeedback>();
  const [declarationNoticeOpen, setDeclarationNoticeOpen] = useState(false);

  const view = useMemo(
    () => createPlayerGameView(gameState, localPlayerId),
    [gameState, localPlayerId],
  );
  const selectedSetId = selectedSourceCardId ? getSetForCard(selectedSourceCardId) : undefined;
  const workbench = useMemo(
    () => selectedSetId ? createAskWorkbenchView(view, selectedSetId, selectedRequestedCardId) : undefined,
    [selectedRequestedCardId, selectedSetId, view],
  );
  const phaseMessage = getPhaseMessage(view);
  const opponents = view.visiblePlayers.filter((player) => player.relationship === "opponent");
  const teammates = view.visiblePlayers.filter((player) => player.relationship === "team");

  useEffect(() => {
    if (!feedback) return undefined;
    const timeout = window.setTimeout(() => setFeedback(undefined), 4_500);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  const clearAskSelection = () => {
    setSelectedSourceCardId(undefined);
    setSelectedRequestedCardId(undefined);
    setSelectedTargetId(undefined);
  };

  const selectSourceCard = (cardId: CardId) => {
    if (!view.canAsk) return;
    if (cardId === selectedSourceCardId) {
      clearAskSelection();
      return;
    }
    setSelectedSourceCardId(cardId);
    setSelectedRequestedCardId(undefined);
    setSelectedTargetId(undefined);
  };

  const submitAsk = () => {
    if (!view.canAsk || !selectedRequestedCardId || !selectedTargetId) return;

    const resolution = resolveLocalAsk(
      gameState,
      createLocalAskAction(view.localPlayer.id, selectedTargetId, selectedRequestedCardId),
    );
    const nextView = createPlayerGameView(resolution.state, localPlayerId);

    setGameState(resolution.state);
    setFeedback(createAskFeedback(nextView, resolution.result));
    clearAskSelection();
  };

  const restartGame = () => {
    setGameState(createDeterministicLocalGame());
    setFeedback(undefined);
    clearAskSelection();
    setDeclarationNoticeOpen(false);
  };

  const changePerspective = (playerId: PlayerId) => {
    setLocalPlayerId(playerId);
    setFeedback(undefined);
    clearAskSelection();
  };

  return (
    <main className="game-page">
      <section className="game-surface" aria-label="Declaration game table">
        <header className="game-header">
          <div className="brand-lockup" aria-label="Declaration">
            <span className="brand-lockup__mark" aria-hidden="true">✦</span>
            <span>DECLARATION</span>
          </div>
          <Button
            aria-expanded={declarationNoticeOpen}
            onClick={() => setDeclarationNoticeOpen((isOpen) => !isOpen)}
            variant="declaration"
          >
            Declare
          </Button>
        </header>

        <div className="game-score-area">
          <ScoreDisplay
            opponentLabel="Them"
            opponentScore={view.opponentScore}
            teamLabel="Your Team"
            teamScore={view.teamScore}
          />
          <p>{view.resolvedSetIds.length} of 9 sets resolved</p>
        </div>

        <section className="game-table" aria-label="Tabletop">
          <div className="game-table__opponents">
            {opponents.map((opponent) => (
              <PlayerToken
                cardCount={opponent.cardCount}
                key={opponent.id}
                name={opponent.displayName}
                active={opponent.isCurrentTurn}
                size="small"
                team="opponent"
              />
            ))}
          </div>

          <div className="game-table__turn" aria-live="polite">
            <span className="game-table__turn-dot" aria-hidden="true" />
            {view.currentTurnOwner.isLocal ? "Your turn" : `${view.currentTurnOwner.displayName}'s turn`}
          </div>

          {phaseMessage ? <p className="game-table__phase-message">{phaseMessage}</p> : null}
          {feedback ? <FeedbackNotice feedback={feedback} onDismiss={() => setFeedback(undefined)} /> : null}

          <div className="game-table__teammates">
            {teammates.map((teammate) => (
              <PlayerToken
                cardCount={teammate.cardCount}
                key={teammate.id}
                name={teammate.displayName}
                active={teammate.isCurrentTurn}
                size="small"
                team="team"
              />
            ))}
          </div>

          {declarationNoticeOpen ? (
            <aside className="declaration-notice" role="status">
              <strong>Declaration flow arrives in Build 11.</strong>
              <span>The complete assignment workflow is not available yet.</span>
            </aside>
          ) : null}

          {workbench ? (
            <AskWorkbench
              onClose={clearAskSelection}
              onRequestCardChange={setSelectedRequestedCardId}
              onSubmit={submitAsk}
              onTargetChange={setSelectedTargetId}
              selectedRequestedCardId={selectedRequestedCardId}
              selectedTargetId={selectedTargetId}
              view={view}
              workbench={workbench}
            />
          ) : null}
        </section>

        <section className="game-hand-area">
          <CardHand
            cardIds={view.visibleHand}
            disabledCardIds={view.canAsk ? [] : view.visibleHand}
            hint={view.canAsk ? "Choose a card to ask" : `${view.currentTurnOwner.displayName}'s turn`}
            label="Your hand"
            onSelectedCardChange={view.canAsk ? selectSourceCard : undefined}
            selectedCardId={selectedSourceCardId}
          />
        </section>
      </section>

      <details className="local-dev-controls">
        <summary aria-label="Open local development controls">
          <span aria-hidden="true">⌘</span>
          <span>Dev</span>
        </summary>
        <div>
          <Button onClick={restartGame} variant="secondary">Restart deterministic game</Button>
          <label>
            Local perspective
            <select
              onChange={(event) => changePerspective(event.target.value as PlayerId)}
              value={localPlayerId}
            >
              {LOCAL_PLAYER_SETUPS.map((player) => (
                <option key={player.id} value={player.id}>{player.displayName}</option>
              ))}
            </select>
          </label>
        </div>
      </details>
    </main>
  );
}
