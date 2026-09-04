"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { CardHand } from "@/components/cards/CardHand";
import { PlayingCard } from "@/components/cards/PlayingCard";
import { getCardAccessibleName } from "@/components/cards/card-assets";
import { Button } from "@/components/ui/Button";
import { PlayerToken } from "@/components/ui/PlayerToken";
import { ScoreDisplay } from "@/components/ui/ScoreDisplay";
import type { CardId } from "@/game/cards";
import { getCardsInSet, getSetForCard, type SetId } from "@/game/sets";
import type { PlayerId } from "@/game/types/player";
import {
  createAskFeedback,
  createAskWorkbenchView,
  createDeclarationFeedback,
  createDeterministicLocalGame,
  createLocalAskAction,
  createPlayerGameView,
  DEFAULT_LOCAL_PLAYER_ID,
  getLocalGameNow,
  getSetLabel,
  LOCAL_PLAYER_SETUPS,
  resolveLocalAsk,
  resolveLocalDeclarationTimeout,
  selectLocalBlindDeclarer,
  startLocalDeclaration,
  submitLocalDeclaration,
  type AskFeedback,
  type AskWorkbenchView,
  type DeclarationFeedback,
  type PlayerGameView,
  type PublicActiveDeclaration,
} from "@/lib/local-game";

export type TableFeedback = AskFeedback | DeclarationFeedback;

export type TeamAssignmentPlayer = Readonly<{
  id: PlayerId;
  displayName: string;
  cardCount: number;
}>;

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

export function AskWorkbench({
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

export function FeedbackNotice({ feedback, onDismiss }: Readonly<{ feedback: TableFeedback; onDismiss: () => void }>) {
  const cardId = "cardId" in feedback ? feedback.cardId : undefined;

  return (
    <div className={`ask-feedback ask-feedback--${feedback.tone}`} role="status" aria-live="polite">
      {cardId ? (
        <div className="ask-feedback__card" aria-hidden="true">
          <PlayingCard cardId={cardId} size="compact" />
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

export type SetSelectionSheetProps = Readonly<{
  mode: "NORMAL" | "BLIND";
  unresolvedSetIds: readonly SetId[];
  selectedSetId?: SetId;
  isProcessing: boolean;
  onClose: () => void;
  onSelect: (setId: SetId) => void;
  onStart: () => void;
}>;

export function SetSelectionSheet({
  mode,
  unresolvedSetIds,
  selectedSetId,
  isProcessing,
  onClose,
  onSelect,
  onStart,
}: SetSelectionSheetProps) {
  const heading = mode === "BLIND" ? "Choose a Blind set" : "Choose a set";

  return (
    <aside className="declaration-sheet" aria-label={heading} aria-modal="true" role="dialog">
      <div className="declaration-sheet__heading">
        <div>
          <p className="eyebrow">{mode === "BLIND" ? "Blind Declaration" : "Declaration"}</p>
          <h2>{heading}</h2>
          <p>Browsing sets does not pause the table. Lock one only when you’re ready.</p>
        </div>
        <button className="ask-workbench__close" type="button" onClick={onClose} aria-label="Close set selection">
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <div className="declaration-sheet__sets" aria-label="Unresolved sets">
        {unresolvedSetIds.map((setId) => (
          <button
            aria-pressed={selectedSetId === setId}
            className={`declaration-set-option${selectedSetId === setId ? " declaration-set-option--selected" : ""}`}
            key={setId}
            onClick={() => onSelect(setId)}
            type="button"
          >
            <span className="declaration-set-option__copy">
              <strong>{getSetLabel(setId)}</strong>
              <span>6 cards</span>
            </span>
            <span className="declaration-set-option__cards" aria-hidden="true">
              {getCardsInSet(setId).map((cardId) => (
                <PlayingCard cardId={cardId} decorative key={cardId} size="compact" />
              ))}
            </span>
          </button>
        ))}
      </div>

      <Button
        className="declaration-sheet__start"
        disabled={!selectedSetId || isProcessing}
        onClick={onStart}
        variant="declaration"
      >
        {isProcessing ? "Starting…" : selectedSetId ? `Start ${getSetLabel(selectedSetId)}` : "Select a set"}
      </Button>
    </aside>
  );
}

export type DeclarationWorkbenchProps = Readonly<{
  declaration: PublicActiveDeclaration;
  declarerName: string;
  teamMembers: readonly TeamAssignmentPlayer[];
  isLocalDeclarer: boolean;
  selectedCardId?: CardId;
  assignments: Partial<Record<CardId, PlayerId>>;
  remainingSeconds: number;
  isProcessing: boolean;
  onSelectCard: (cardId: CardId) => void;
  onAssign: (playerId: PlayerId) => void;
  onSubmit: () => void;
}>;

export function DeclarationWorkbench({
  declaration,
  declarerName,
  teamMembers,
  isLocalDeclarer,
  selectedCardId,
  assignments,
  remainingSeconds,
  isProcessing,
  onSelectCard,
  onAssign,
  onSubmit,
}: DeclarationWorkbenchProps) {
  const cards = getCardsInSet(declaration.selectedSetId);
  const selectedCard = selectedCardId ?? cards[0];
  const selectedAssignment = assignments[selectedCard];
  const assignedCount = cards.filter((cardId) => assignments[cardId] !== undefined).length;
  const countdown = `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, "0")}`;

  return (
    <aside className="declaration-workbench" aria-label={`${declaration.mode === "BLIND" ? "Blind " : ""}Declaration in progress`}>
      <div className="declaration-workbench__heading">
        <div>
          <p className="eyebrow">{declaration.mode === "BLIND" ? "Blind Declaration" : "Declaration in progress"}</p>
          <h2>{getSetLabel(declaration.selectedSetId)}</h2>
          <p>{isLocalDeclarer ? "You are declaring." : `${declarerName} is declaring.`}</p>
        </div>
        <div className="declaration-countdown" aria-label={`${remainingSeconds} seconds remaining`}>
          <span>Time</span>
          <strong>{countdown}</strong>
        </div>
      </div>

      <div className="declaration-workbench__cards" aria-label="Locked Declaration cards">
        {cards.map((cardId) => {
          const assignee = teamMembers.find((member) => member.id === assignments[cardId]);
          const assignmentLabel = isLocalDeclarer
            ? assignee ? `Assigned to ${assignee.displayName}` : "Unassigned"
            : "Locked card";

          return (
            <button
              aria-label={`${getCardAccessibleName(cardId)}, ${assignmentLabel.toLowerCase()}`}
              aria-pressed={selectedCard === cardId}
              className={`declaration-card-choice${selectedCard === cardId ? " declaration-card-choice--selected" : ""}${assignee ? " declaration-card-choice--assigned" : ""}`}
              disabled={!isLocalDeclarer}
              key={cardId}
              onClick={() => onSelectCard(cardId)}
              type="button"
            >
              <PlayingCard cardId={cardId} decorative size="compact" />
              <span>{assignmentLabel}</span>
            </button>
          );
        })}
      </div>

      {isLocalDeclarer ? (
        <div className="declaration-workbench__assignment">
          <div className="declaration-workbench__assignment-copy">
            <span>Assign {getCardAccessibleName(selectedCard)}</span>
            <strong>{assignedCount} of 6 assigned</strong>
          </div>
          <div className="declaration-workbench__teammates" aria-label={`Assign ${getCardAccessibleName(selectedCard)} to a teammate`}>
            {teamMembers.map((member) => (
              <PlayerToken
                cardCount={member.cardCount}
                key={member.id}
                name={member.displayName}
                onClick={() => onAssign(member.id)}
                selected={selectedAssignment === member.id}
                size="small"
                team="team"
              />
            ))}
          </div>
          <Button className="declaration-workbench__submit" disabled={isProcessing} onClick={onSubmit} variant="declaration">
            {isProcessing ? "Submitting…" : `Submit ${assignedCount} of 6 assignments`}
          </Button>
        </div>
      ) : (
        <div className="declaration-workbench__waiting" role="status">
          <strong>Waiting for {declarerName}’s assignments.</strong>
          <span>The locked cards and timer are public; the answer remains private.</span>
        </div>
      )}
    </aside>
  );
}

export type BlindDeclarationPanelProps = Readonly<{
  view: PlayerGameView;
  teamMembers: readonly TeamAssignmentPlayer[];
  isProcessing: boolean;
  onSelectBlindDeclarer: (playerId: PlayerId) => void;
  onChooseSet: () => void;
}>;

export function BlindDeclarationPanel({
  view,
  teamMembers,
  isProcessing,
  onSelectBlindDeclarer,
  onChooseSet,
}: BlindDeclarationPanelProps) {
  const isLocalOnBlindTeam = view.localPlayer.teamId === view.blindDeclarationTeamId;
  const blindTeamLabel = view.blindDeclarationTeamId === "TEAM_A" ? "Team A" : "Team B";
  const blindDeclarerName = view.blindDeclarerId
    ? getVisiblePlayerName(view, view.blindDeclarerId)
    : null;

  if (view.blindDeclarerId !== null) {
    if (view.blindDeclarerId === view.localPlayer.id) {
      return (
        <aside className="blind-declaration-panel" aria-label="Blind Declaration ready">
          <p className="eyebrow">Blind Declaration</p>
          <h2>You’re the locked declarer.</h2>
          <p>Choose each remaining set and make the team assignments.</p>
          <Button onClick={onChooseSet} variant="declaration">Choose an unresolved set</Button>
        </aside>
      );
    }

    return (
      <aside className="blind-declaration-panel" aria-label="Blind Declaration waiting">
        <p className="eyebrow">Blind Declaration</p>
        <h2>{blindDeclarerName} is locked in.</h2>
        <p>Waiting for the Blind Declarer to choose the next unresolved set.</p>
      </aside>
    );
  }

  if (!isLocalOnBlindTeam) {
    return (
      <aside className="blind-declaration-panel" aria-label="Blind Declarer selection waiting">
        <p className="eyebrow">Blind Declaration</p>
        <h2>{blindTeamLabel} is choosing its declarer.</h2>
        <p>Waiting for the eligible team to lock one player for the remaining sets.</p>
      </aside>
    );
  }

  return (
    <aside className="blind-declaration-panel" aria-label="Choose a Blind Declarer">
      <p className="eyebrow">Blind Declaration</p>
      <h2>Choose the Blind Declarer</h2>
      <p>One player will declare every remaining set. Zero-card teammates are eligible too.</p>
      <div className="blind-declaration-panel__candidates">
        {teamMembers.map((member) => (
          <PlayerToken
            cardCount={member.cardCount}
            disabled={isProcessing}
            key={member.id}
            name={member.displayName}
            onClick={() => onSelectBlindDeclarer(member.id)}
            size="small"
            team="team"
          />
        ))}
      </div>
    </aside>
  );
}

export function GameOverPanel({ view }: Readonly<{ view: PlayerGameView }>) {
  const winningLabel = view.winnerTeamId === view.localPlayer.teamId ? "Your team wins" : "The other team wins";

  return (
    <section className="game-over-panel" aria-label="Game complete">
      <span aria-hidden="true">D</span>
      <p className="eyebrow">Game complete</p>
      <h1>{winningLabel}</h1>
      <p>All nine sets have been resolved. Final score is shown above.</p>
    </section>
  );
}

export const getVisiblePlayerName = (view: PlayerGameView, playerId: PlayerId): string => {
  if (playerId === view.localPlayer.id) return "You";
  return view.visiblePlayers.find((player) => player.id === playerId)?.displayName ?? "That player";
};

const getPhaseMessage = (view: PlayerGameView): string | null => {
  if (view.phase === "DECLARING") return "A Declaration is in progress. Normal asks are paused.";
  return null;
};

type GameplayExperienceProps = Readonly<{
  controls?: "development" | "demo";
}>;

/** The deterministic single-client integration surface used by development and the public demo. */
export function GameplayExperience({ controls = "development" }: GameplayExperienceProps = {}) {
  const [gameState, setGameState] = useState(createDeterministicLocalGame);
  const [localPlayerId, setLocalPlayerId] = useState<PlayerId>(DEFAULT_LOCAL_PLAYER_ID);
  const [selectedSourceCardId, setSelectedSourceCardId] = useState<CardId>();
  const [selectedRequestedCardId, setSelectedRequestedCardId] = useState<CardId>();
  const [selectedTargetId, setSelectedTargetId] = useState<PlayerId>();
  const [feedback, setFeedback] = useState<TableFeedback>();
  const [declarationSheetOpen, setDeclarationSheetOpen] = useState(false);
  const [selectedDeclarationSetId, setSelectedDeclarationSetId] = useState<SetId>();
  const [selectedAssignmentCardId, setSelectedAssignmentCardId] = useState<CardId>();
  const [declarationAssignments, setDeclarationAssignments] = useState<Partial<Record<CardId, PlayerId>>>({});
  const [isDeclarationProcessing, setIsDeclarationProcessing] = useState(false);
  const [clockNow, setClockNow] = useState(getLocalGameNow);
  const timeoutRequestKey = useRef<string | null>(null);

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
  const localTeamMembers = useMemo<TeamAssignmentPlayer[]>(
    () => [
      { id: view.localPlayer.id, displayName: view.localPlayer.displayName, cardCount: view.visibleHand.length },
      ...teammates.map((player) => ({ id: player.id, displayName: player.displayName, cardCount: player.cardCount })),
    ],
    [teammates, view.localPlayer.displayName, view.localPlayer.id, view.visibleHand.length],
  );
  const activeDeclaration = view.activeDeclaration;
  const isNormalDeclarationStartAvailable = view.phase === "PLAYING";
  const isBlindDeclarationStartAvailable = view.phase === "BLIND_DECLARATION"
    && activeDeclaration === null
    && view.blindDeclarerId === view.localPlayer.id;
  const activeDeclarationKey = activeDeclaration
    ? `${activeDeclaration.declarerId}:${activeDeclaration.selectedSetId}:${activeDeclaration.startedAt}`
    : null;

  useEffect(() => {
    if (!feedback) return undefined;
    const timeout = window.setTimeout(() => setFeedback(undefined), 4_500);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  useEffect(() => {
    if (activeDeclaration === null || activeDeclarationKey === null) {
      timeoutRequestKey.current = null;
      return undefined;
    }

    let cancelled = false;
    const tick = () => {
      const now = getLocalGameNow();
      setClockNow(now);

      // The display can read 0 at the exact deadline; only the engine receives a timeout intent after it.
      if (now <= activeDeclaration.deadline || timeoutRequestKey.current === activeDeclarationKey || cancelled) return;

      timeoutRequestKey.current = activeDeclarationKey;
      const resolution = resolveLocalDeclarationTimeout(gameState, localPlayerId);
      setGameState(resolution.state);
      setFeedback(createDeclarationFeedback(resolution.view, resolution.result));
      setSelectedAssignmentCardId(undefined);
      setDeclarationAssignments({});
    };

    tick();
    const interval = window.setInterval(tick, 250);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeDeclaration, activeDeclarationKey, gameState, localPlayerId]);

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

  const openNormalDeclaration = () => {
    if (!isNormalDeclarationStartAvailable) return;
    setSelectedDeclarationSetId(undefined);
    setDeclarationSheetOpen(true);
  };

  const startSelectedDeclaration = () => {
    if (
      !selectedDeclarationSetId
      || isDeclarationProcessing
      || (!isNormalDeclarationStartAvailable && !isBlindDeclarationStartAvailable)
    ) return;

    setIsDeclarationProcessing(true);
    const resolution = startLocalDeclaration(gameState, localPlayerId, selectedDeclarationSetId);
    setGameState(resolution.state);
    setFeedback(createDeclarationFeedback(resolution.view, resolution.result));
    if (resolution.result.kind === "STARTED") {
      setDeclarationSheetOpen(false);
      setSelectedAssignmentCardId(getCardsInSet(resolution.result.selectedSetId)[0]);
      setDeclarationAssignments({});
      clearAskSelection();
      setClockNow(getLocalGameNow());
    }
    setIsDeclarationProcessing(false);
  };

  const submitAssignments = () => {
    if (activeDeclaration === null || activeDeclaration.declarerId !== view.localPlayer.id || isDeclarationProcessing) return;

    setIsDeclarationProcessing(true);
    const assignments = getCardsInSet(activeDeclaration.selectedSetId).flatMap((cardId) => {
      const playerId = declarationAssignments[cardId];
      return playerId ? [{ cardId, playerId }] : [];
    });
    const resolution = submitLocalDeclaration(gameState, localPlayerId, assignments);
    setGameState(resolution.state);
    setFeedback(createDeclarationFeedback(resolution.view, resolution.result));
    if (resolution.result.kind !== "INVALID_SUBMISSION") {
      setSelectedAssignmentCardId(undefined);
      setDeclarationAssignments({});
    }
    setIsDeclarationProcessing(false);
  };

  const selectBlindDeclarer = (blindDeclarerId: PlayerId) => {
    if (view.phase !== "BLIND_DECLARATION" || view.blindDeclarerId !== null || isDeclarationProcessing) return;

    // A production server must authorize the acting player; local perspective switching is only a UI harness.
    setIsDeclarationProcessing(true);
    const resolution = selectLocalBlindDeclarer(gameState, localPlayerId, blindDeclarerId);
    setGameState(resolution.state);
    setFeedback(createDeclarationFeedback(resolution.view, resolution.result));
    setIsDeclarationProcessing(false);
  };

  const assignSelectedCard = (playerId: PlayerId) => {
    if (selectedAssignmentCardId === undefined) return;
    setDeclarationAssignments((assignments) => ({ ...assignments, [selectedAssignmentCardId]: playerId }));
  };

  const restartGame = () => {
    setGameState(createDeterministicLocalGame());
    setFeedback(undefined);
    clearAskSelection();
    setDeclarationSheetOpen(false);
    setSelectedDeclarationSetId(undefined);
    setSelectedAssignmentCardId(undefined);
    setDeclarationAssignments({});
    setClockNow(getLocalGameNow());
  };

  const changePerspective = (playerId: PlayerId) => {
    setLocalPlayerId(playerId);
    setFeedback(undefined);
    clearAskSelection();
    setDeclarationSheetOpen(false);
    setSelectedDeclarationSetId(undefined);
    setSelectedAssignmentCardId(undefined);
    setDeclarationAssignments({});
  };

  const declarationMode = isBlindDeclarationStartAvailable ? "BLIND" : "NORMAL";
  const remainingSeconds = activeDeclaration === null
    ? 0
    : Math.max(0, Math.ceil(activeDeclaration.deadline - clockNow));

  const isDemo = controls === "demo";

  return (
    <main className={`game-page${isDemo ? " game-page--demo" : ""}`}>
      <section className="game-surface" aria-label="Declaration game table">
        <header className="game-header">
          <div className="brand-lockup" aria-label="Declaration">
            <span className="brand-lockup__mark" aria-hidden="true">D</span>
            <span>DECLARATION</span>
          </div>
          <Button
            aria-expanded={declarationSheetOpen}
            disabled={!isNormalDeclarationStartAvailable || isDeclarationProcessing}
            onClick={openNormalDeclaration}
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
          {view.phase === "GAME_OVER" ? <GameOverPanel view={view} /> : (
            <>
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

              {declarationSheetOpen ? (
                <SetSelectionSheet
                  isProcessing={isDeclarationProcessing}
                  mode={declarationMode}
                  onClose={() => setDeclarationSheetOpen(false)}
                  onSelect={setSelectedDeclarationSetId}
                  onStart={startSelectedDeclaration}
                  selectedSetId={selectedDeclarationSetId}
                  unresolvedSetIds={view.unresolvedSetIds}
                />
              ) : null}

              {activeDeclaration ? (
                <DeclarationWorkbench
                  assignments={declarationAssignments}
                  declaration={activeDeclaration}
                  declarerName={getVisiblePlayerName(view, activeDeclaration.declarerId)}
                  isLocalDeclarer={activeDeclaration.declarerId === view.localPlayer.id}
                  isProcessing={isDeclarationProcessing}
                  onAssign={assignSelectedCard}
                  onSelectCard={setSelectedAssignmentCardId}
                  onSubmit={submitAssignments}
                  remainingSeconds={remainingSeconds}
                  selectedCardId={selectedAssignmentCardId}
                  teamMembers={localTeamMembers}
                />
              ) : view.phase === "BLIND_DECLARATION" ? (
                <BlindDeclarationPanel
                  isProcessing={isDeclarationProcessing}
                  onChooseSet={() => {
                    setSelectedDeclarationSetId(undefined);
                    setDeclarationSheetOpen(true);
                  }}
                  onSelectBlindDeclarer={selectBlindDeclarer}
                  teamMembers={localTeamMembers}
                  view={view}
                />
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
            </>
          )}
        </section>

        {view.phase === "GAME_OVER" ? null : (
          <section className="game-hand-area">
            <CardHand
              cardIds={view.visibleHand}
              disabledCardIds={view.canAsk ? [] : view.visibleHand}
              hint={view.canAsk ? "Choose a card to ask" : activeDeclaration ? "Declaration in progress" : `${view.currentTurnOwner.displayName}'s turn`}
              label="Your hand"
              onSelectedCardChange={view.canAsk ? selectSourceCard : undefined}
              selectedCardId={selectedSourceCardId}
            />
          </section>
        )}
      </section>

      <details className={`local-dev-controls${isDemo ? " local-dev-controls--demo" : ""}`}>
        <summary aria-label={isDemo ? "Open demo seat controls" : "Open local development controls"}>
          <span aria-hidden="true">{isDemo ? "♟" : "⌘"}</span>
          <span>{isDemo ? "Switch seat" : "Dev"}</span>
        </summary>
        <div>
          <p>{isDemo ? "This sandbox keeps all six seats on this device. Switch players when the turn moves." : "Local deterministic harness"}</p>
          <Button onClick={restartGame} variant="secondary">{isDemo ? "Restart demo" : "Restart deterministic game"}</Button>
          <label>
            {isDemo ? "Play as" : "Local perspective"}
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
