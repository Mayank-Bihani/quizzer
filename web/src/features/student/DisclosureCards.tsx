import { formatDuration } from "../../lib/format";

export function FinishCard({
  totalScore,
  answeredCount,
  questionCount,
}: {
  totalScore: number;
  answeredCount: number;
  questionCount: number;
}) {
  return (
    <section className="card finishcard" aria-labelledby="finish-heading">
      <div className="numhero numhero--lg">
        <h1 id="finish-heading" className="wlabel">
          Your score
        </h1>
        <div className="numhero__value num">{totalScore}</div>
      </div>
      <p className="num">
        {answeredCount} of {questionCount} answered
      </p>
      <p className="tiny">
        Your result is saved. Competitive results unlock after the room closes.
      </p>
    </section>
  );
}

export function HoldingCard({
  totalScore,
  answeredCount,
  finishedCount,
  participantCount,
  estimatedUnlockAt,
  now,
}: {
  totalScore: number;
  answeredCount: number;
  finishedCount: number;
  participantCount: number;
  estimatedUnlockAt: number;
  now: number;
}) {
  return (
    <section className="card holdcard" aria-labelledby="holding-heading">
      <img src="/assets/illustrations/shade-waiting.svg" alt="" />
      <h1 id="holding-heading" className="h3">
        Holding for the room
      </h1>
      <div className="numhero">
        <span className="wlabel">Your score</span>
        <span className="numhero__value num">{totalScore}</span>
      </div>
      <p className="tiny">
        <span className="num">{answeredCount}</span> answers were recorded.
      </p>
      <p className="num">
        {finishedCount} of {participantCount} participants have finished.
      </p>
      <div
        className="cd"
        aria-label={`Estimated unlock in ${formatDuration(Math.max(0, estimatedUnlockAt - now))}`}
      >
        <span className="cd-digits num">
          {formatDuration(Math.max(0, estimatedUnlockAt - now))}
        </span>
        <span className="tiny">estimated until results</span>
      </div>
    </section>
  );
}
