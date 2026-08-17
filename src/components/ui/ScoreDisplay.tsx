type ScoreDisplayProps = Readonly<{
  teamLabel: string;
  teamScore: number;
  opponentLabel: string;
  opponentScore: number;
}>;

export function ScoreDisplay({
  teamLabel,
  teamScore,
  opponentLabel,
  opponentScore,
}: ScoreDisplayProps) {
  return (
    <dl className="score-display" aria-label={`${teamLabel} ${teamScore}, ${opponentLabel} ${opponentScore}`}>
      <div className="score-display__team">
        <dt><span className="score-display__dot score-display__dot--team" aria-hidden="true" />{teamLabel}</dt>
        <dd>{teamScore}</dd>
      </div>
      <span className="score-display__divider" aria-hidden="true">—</span>
      <div className="score-display__team score-display__team--opponent">
        <dd>{opponentScore}</dd>
        <dt>{opponentLabel}<span className="score-display__dot score-display__dot--opponent" aria-hidden="true" /></dt>
      </div>
    </dl>
  );
}
