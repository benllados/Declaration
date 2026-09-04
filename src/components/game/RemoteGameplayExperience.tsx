"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AskWorkbench,
  BlindDeclarationPanel,
  DeclarationWorkbench,
  FeedbackNotice,
  GameOverPanel,
  getVisiblePlayerName,
  SetSelectionSheet,
  type TableFeedback,
  type TeamAssignmentPlayer,
} from "@/components/game/GameplayExperience";
import { CardHand } from "@/components/cards/CardHand";
import { Button } from "@/components/ui/Button";
import { PlayerToken } from "@/components/ui/PlayerToken";
import { ScoreDisplay } from "@/components/ui/ScoreDisplay";
import {
  extendRateLimitPause,
  nextPollingDelayMilliseconds,
  rateLimitPauseMilliseconds,
} from "@/components/game/rate-limit-backoff";
import type { CardId } from "@/game/cards";
import { getCardsInSet, getSetForCard, type SetId } from "@/game/sets";
import type { PlayerId } from "@/game/types/player";
import {
  createAskFeedback,
  createAskWorkbenchView,
  createDeclarationFeedback,
  type DeclarationFeedbackResult,
  getSetLabel,
  type PlayerGameView,
} from "@/lib/local-game";
import type {
  PublicActionResponse,
  PublicActionType,
  PublicGameAction,
  SafeActionOutcome,
  ScopedGameView,
} from "@/lib/multiplayer/contracts";

type LoadState = "LOADING" | "READY" | "RATE_LIMITED" | "UNAVAILABLE" | "ERROR";

const POLL_INTERVAL_MS = 1_500;
const CLOCK_INTERVAL_MS = 250;

const actionId = (): string => `action-${crypto.randomUUID().replaceAll("-", "")}`;

const isScopedView = (value: unknown): value is ScopedGameView => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.revision === "number" && Number.isSafeInteger(record.revision) && record.revision >= 0 && !!record.view && typeof record.view === "object";
};

const isActionResponse = (value: unknown): value is PublicActionResponse => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.status === "string" && typeof record.revision === "number" && Number.isSafeInteger(record.revision) && record.revision >= 0;
};

const feedbackFor = (
  view: PlayerGameView,
  actionType: PublicActionType,
  outcome: SafeActionOutcome,
): TableFeedback => {
  if (actionType === "ASK") return createAskFeedback(view, outcome as Parameters<typeof createAskFeedback>[1]);
  if (outcome.kind === "ACTION_NOT_AUTHORIZED") {
    return {
      tone: "warning",
      title: "That choice is no longer available.",
      detail: "The eligible team chooses the Blind Declarer.",
    };
  }
  return createDeclarationFeedback(view, outcome as DeclarationFeedbackResult);
};

const getPhaseMessage = (view: PlayerGameView): string | null =>
  view.phase === "DECLARING" ? "A Declaration is in progress. Normal asks are paused." : null;

/** Production player table. State arrives only through the credential-scoped API. */
export function RemoteGameplayExperience({ gameId }: Readonly<{ gameId: string }>) {
  const [scoped, setScoped] = useState<ScopedGameView>();
  const [loadState, setLoadState] = useState<LoadState>("LOADING");
  const [feedback, setFeedback] = useState<TableFeedback>();
  const [selectedSourceCardId, setSelectedSourceCardId] = useState<CardId>();
  const [selectedRequestedCardId, setSelectedRequestedCardId] = useState<CardId>();
  const [selectedTargetId, setSelectedTargetId] = useState<PlayerId>();
  const [declarationSheetOpen, setDeclarationSheetOpen] = useState(false);
  const [selectedDeclarationSetId, setSelectedDeclarationSetId] = useState<SetId>();
  const [selectedAssignmentCardId, setSelectedAssignmentCardId] = useState<CardId>();
  const [declarationAssignments, setDeclarationAssignments] = useState<Partial<Record<CardId, PlayerId>>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now() / 1_000);
  const initialLoadRequested = useRef(false);
  const unavailableRef = useRef(false);
  const rateLimitedUntilRef = useRef(0);

  const pauseForRateLimit = useCallback((retryAfter: string | null) => {
    rateLimitedUntilRef.current = extendRateLimitPause(
      rateLimitedUntilRef.current,
      Date.now(),
      retryAfter,
    );
    setLoadState("RATE_LIMITED");
  }, []);

  useEffect(() => {
    unavailableRef.current = loadState === "UNAVAILABLE";
  }, [loadState]);

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(`/api/games/${gameId}`, { cache: "no-store", credentials: "same-origin" });
      if (response.status === 404) {
        unavailableRef.current = true;
        setLoadState("UNAVAILABLE");
        return;
      }
      if (response.status === 429) {
        pauseForRateLimit(response.headers.get("retry-after"));
        return;
      }
      if (!response.ok) {
        setLoadState("ERROR");
        return;
      }
      const payload: unknown = await response.json();
      if (!isScopedView(payload)) {
        setLoadState("ERROR");
        return;
      }
      setScoped(payload);
      setLoadState("READY");
    } catch {
      setLoadState("ERROR");
    }
  }, [gameId, pauseForRateLimit]);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const schedule = (delay: number) => {
      timer = window.setTimeout(() => void refresh(), delay);
    };
    const refresh = async () => {
      if (stopped || unavailableRef.current) return;
      const pauseRemaining = rateLimitedUntilRef.current - Date.now();
      if (pauseRemaining > 0) {
        schedule(pauseRemaining);
        return;
      }
      await load();
      if (stopped || unavailableRef.current) return;
      schedule(nextPollingDelayMilliseconds(rateLimitedUntilRef.current, Date.now()));
    };
    if (!initialLoadRequested.current) {
      initialLoadRequested.current = true;
      void refresh();
    } else if (!unavailableRef.current) {
      schedule(Math.max(0, rateLimitedUntilRef.current - Date.now()));
    }
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [load]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timeout = window.setTimeout(() => setFeedback(undefined), 4_500);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  useEffect(() => {
    const interval = window.setInterval(() => setClockNow(Date.now() / 1_000), CLOCK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  const clearAskSelection = () => {
    setSelectedSourceCardId(undefined);
    setSelectedRequestedCardId(undefined);
    setSelectedTargetId(undefined);
  };

  const clearDeclarationDraft = () => {
    setSelectedAssignmentCardId(undefined);
    setDeclarationAssignments({});
  };

  const dispatch = async <Type extends PublicActionType>(
    type: Type,
    payload: Extract<PublicGameAction, { type: Type }>["payload"],
  ): Promise<PublicActionResponse | undefined> => {
    if (!scoped || isProcessing) return undefined;
    setIsProcessing(true);
    try {
      const body: PublicGameAction = {
        gameId,
        actionId: actionId(),
        expectedRevision: scoped.revision,
        type,
        payload,
      } as PublicGameAction;
      const response = await fetch(`/api/games/${gameId}/actions`, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 404) {
        unavailableRef.current = true;
        setLoadState("UNAVAILABLE");
        return undefined;
      }
      if (response.status === 429) {
        pauseForRateLimit(response.headers.get("retry-after"));
        setFeedback({
          tone: "quiet",
          title: "The table is taking a short pause.",
          detail: "We’ll reconnect automatically in a moment.",
        });
        return undefined;
      }
      const result: unknown = await response.json();
      if (!isActionResponse(result)) {
        setLoadState("ERROR");
        return undefined;
      }
      if (result.view) setScoped({ revision: result.revision, view: result.view });
      if (result.status === "CONFLICT") {
        setFeedback({ tone: "quiet", title: "The table changed.", detail: "Your view has been refreshed—choose again if needed." });
      } else if (result.outcome && result.view) {
        setFeedback(feedbackFor(result.view, type, result.outcome));
      } else if (result.status === "VALIDATION_ERROR") {
        setFeedback({ tone: "warning", title: "That action wasn’t accepted.", detail: "Refresh the table and try again." });
      }
      return result;
    } catch {
      setLoadState("ERROR");
      return undefined;
    } finally {
      setIsProcessing(false);
    }
  };

  const view = scoped?.view;
  const selectedSetId = selectedSourceCardId ? getSetForCard(selectedSourceCardId) : undefined;
  const workbench = useMemo(
    () => view && selectedSetId ? createAskWorkbenchView(view, selectedSetId, selectedRequestedCardId) : undefined,
    [selectedRequestedCardId, selectedSetId, view],
  );

  if (loadState !== "READY" || !view || !scoped) {
    const content = loadState === "UNAVAILABLE"
      ? ["This game seat isn’t available.", "Use the original invitation link or ask the host for a new one."]
      : loadState === "RATE_LIMITED"
        ? ["The table is taking a short pause.", "We’ll reconnect automatically in a moment."]
      : loadState === "ERROR"
        ? ["We couldn’t reach the game table.", "Check your connection, then try again."]
        : ["Loading your seat…", "Connecting you to the table."];
    return (
      <main className="game-page">
        <section className="game-surface game-surface--message" aria-live="polite">
          <div className="game-over-panel">
            <span aria-hidden="true">D</span>
            <p className="eyebrow">Declaration</p>
            <h1>{content[0]}</h1>
            <p>{content[1]}</p>
            {loadState === "ERROR" ? <Button onClick={() => void load()}>Try again</Button> : null}
          </div>
        </section>
      </main>
    );
  }

  const opponents = view.visiblePlayers.filter((player) => player.relationship === "opponent");
  const teammates = view.visiblePlayers.filter((player) => player.relationship === "team");
  const localTeamMembers = [
    { id: view.localPlayer.id, displayName: view.localPlayer.displayName, cardCount: view.visibleHand.length },
    ...teammates.map((player) => ({ id: player.id, displayName: player.displayName, cardCount: player.cardCount })),
  ] satisfies TeamAssignmentPlayer[];
  const activeDeclaration = view.activeDeclaration;
  const normalDeclarationAvailable = view.phase === "PLAYING";
  const blindDeclarationAvailable = view.phase === "BLIND_DECLARATION"
    && activeDeclaration === null
    && view.blindDeclarerId === view.localPlayer.id;
  const declarationMode = blindDeclarationAvailable ? "BLIND" : "NORMAL";
  const remainingSeconds = activeDeclaration === null
    ? 0
    : Math.max(0, Math.ceil(activeDeclaration.deadline - clockNow));
  const phaseMessage = getPhaseMessage(view);

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

  const submitAsk = async () => {
    if (!selectedRequestedCardId || !selectedTargetId) return;
    const response = await dispatch("ASK", { targetPlayerId: selectedTargetId, requestedCardId: selectedRequestedCardId });
    if (response?.status !== "CONFLICT") clearAskSelection();
  };

  const startSelectedDeclaration = async () => {
    if (!selectedDeclarationSetId || (!normalDeclarationAvailable && !blindDeclarationAvailable)) return;
    const response = await dispatch("START_DECLARATION", { selectedSetId: selectedDeclarationSetId });
    if (response?.outcome?.kind === "STARTED") {
      setDeclarationSheetOpen(false);
      setSelectedAssignmentCardId(getCardsInSet(selectedDeclarationSetId)[0]);
      setDeclarationAssignments({});
      clearAskSelection();
    }
  };

  const submitAssignments = async () => {
    if (activeDeclaration === null || activeDeclaration.declarerId !== view.localPlayer.id) return;
    const assignments = getCardsInSet(activeDeclaration.selectedSetId).flatMap((cardId) => {
      const playerId = declarationAssignments[cardId];
      return playerId ? [{ cardId, playerId }] : [];
    });
    const response = await dispatch("SUBMIT_DECLARATION", { assignments });
    if (response?.outcome?.kind !== "INVALID_SUBMISSION") clearDeclarationDraft();
  };

  const selectBlindDeclarer = async (blindDeclarerId: PlayerId) => {
    const response = await dispatch("SELECT_BLIND_DECLARER", { blindDeclarerId });
    if (response?.status === "CONFLICT") clearDeclarationDraft();
  };

  return (
    <main className="game-page">
      <section className="game-surface" aria-label="Declaration game table">
        <header className="game-header">
          <div className="brand-lockup" aria-label="Declaration">
            <span className="brand-lockup__mark" aria-hidden="true">D</span>
            <span>DECLARATION</span>
          </div>
          <Button
            aria-expanded={declarationSheetOpen}
            disabled={!normalDeclarationAvailable || isProcessing}
            onClick={() => {
              setSelectedDeclarationSetId(undefined);
              setDeclarationSheetOpen(true);
            }}
            variant="declaration"
          >
            Declare
          </Button>
        </header>

        <div className="game-score-area">
          <ScoreDisplay opponentLabel="Them" opponentScore={view.opponentScore} teamLabel="Your Team" teamScore={view.teamScore} />
          <p>{view.resolvedSetIds.length} of 9 sets resolved</p>
        </div>

        <section className="game-table" aria-label="Tabletop">
          {view.phase === "GAME_OVER" ? <GameOverPanel view={view} /> : (
            <>
              <div className="game-table__opponents">
                {opponents.map((opponent) => (
                  <PlayerToken cardCount={opponent.cardCount} key={opponent.id} name={opponent.displayName} active={opponent.isCurrentTurn} size="small" team="opponent" />
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
                  <PlayerToken cardCount={teammate.cardCount} key={teammate.id} name={teammate.displayName} active={teammate.isCurrentTurn} size="small" team="team" />
                ))}
              </div>

              {declarationSheetOpen ? (
                <SetSelectionSheet
                  isProcessing={isProcessing}
                  mode={declarationMode}
                  onClose={() => setDeclarationSheetOpen(false)}
                  onSelect={setSelectedDeclarationSetId}
                  onStart={() => void startSelectedDeclaration()}
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
                  isProcessing={isProcessing}
                  onAssign={(playerId) => setDeclarationAssignments((assignments) => selectedAssignmentCardId ? { ...assignments, [selectedAssignmentCardId]: playerId } : assignments)}
                  onSelectCard={setSelectedAssignmentCardId}
                  onSubmit={() => void submitAssignments()}
                  remainingSeconds={remainingSeconds}
                  selectedCardId={selectedAssignmentCardId}
                  teamMembers={localTeamMembers}
                />
              ) : view.phase === "BLIND_DECLARATION" ? (
                <BlindDeclarationPanel
                  isProcessing={isProcessing}
                  onChooseSet={() => {
                    setSelectedDeclarationSetId(undefined);
                    setDeclarationSheetOpen(true);
                  }}
                  onSelectBlindDeclarer={(playerId) => void selectBlindDeclarer(playerId)}
                  teamMembers={localTeamMembers}
                  view={view}
                />
              ) : null}

              {workbench ? (
                <AskWorkbench
                  onClose={clearAskSelection}
                  onRequestCardChange={setSelectedRequestedCardId}
                  onSubmit={() => void submitAsk()}
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
    </main>
  );
}
