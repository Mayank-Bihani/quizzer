import { useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type {
  HistoryEntry,
  LeaderboardRowView,
  QuestionReviewRow,
  WeeklyBoardRequest,
} from "../../../../src/core/api";
import type { QuizType } from "../../../../src/core/contracts";
import { api, ApiRequestError } from "../../api/client";
import { MathText } from "../../components/MathText";
import {
  EmptyState,
  ErrorState,
  LoadingCard,
  PageHeader,
  Pagination,
  SectionBadge,
  useResource,
} from "../../components/ui";
import { formatDateTime, quizTypeLabels } from "../../lib/format";
import { useAuth } from "../../auth/AuthProvider";
import { FinishCard, HoldingCard } from "./DisclosureCards";

export function HomePage() {
  const { user } = useAuth();
  const resource = useResource(
    () => Promise.all([api.openQuizzes(), api.history({ limit: 3 })]),
    [],
  );
  if (resource.loading) return <LoadingCard />;
  if (resource.error || !resource.data)
    return <ErrorState error={resource.error} retry={resource.reload} />;
  const [open, history] = resource.data;
  return (
    <>
      <PageHeader
        eyebrow={new Intl.DateTimeFormat("en-IN", {
          dateStyle: "full",
          timeZone: "Asia/Kolkata",
        }).format(Date.now())}
        title={`Welcome, ${user?.name ?? ""}`}
        subtitle={`You have ${history.total} quiz ${history.total === 1 ? "attempt" : "attempts"} in your history.`}
        actions={
          <Link className="btn" to="/join">
            Join by code
          </Link>
        }
      />
      <section className="home-section" aria-labelledby="open-heading">
        <div className="home-section__head">
          <h2 id="open-heading">Open now</h2>
          {open.quizzes.length > 0 && (
            <span className="badge b-open">● Room open</span>
          )}
        </div>
        {open.quizzes.length === 0 ? (
          <EmptyState title="No room is open">
            New rooms appear here when their admission window starts.
          </EmptyState>
        ) : (
          <div className="quiz-grid">
            {open.quizzes.map((quiz) => (
              <article className="card quiz-card" key={quiz.id}>
                <div className="quiz-card__head">
                  <div>
                    <SectionBadge type={quiz.type} />
                    <div className="quiz-card__name">{quiz.title}</div>
                  </div>
                  <span className="badge b-live">● Live</span>
                </div>
                <div className="quiz-card__facts tiny">
                  <div>
                    Quiz <b className="num">#{quiz.quizNumber}</b>
                  </div>
                  <div>
                    Admission closes{" "}
                    <b className="num">{formatDateTime(quiz.endsAt)}</b>
                  </div>
                </div>
                <div className="quiz-card__foot">
                  <span className="tiny">
                    Room <b className="num">{quiz.roomCode}</b>
                  </span>
                  <Link
                    className="btn"
                    to={`/lobby/${encodeURIComponent(quiz.roomCode)}`}
                  >
                    View lobby
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="home-section" aria-labelledby="upcoming-heading">
        <div className="home-section__head">
          <h2 id="upcoming-heading">Upcoming</h2>
        </div>
        <div className="alert a-info">
          <span aria-hidden="true">i</span>
          <span>
            Upcoming quiz details are announced in the Telegram group. The API
            currently exposes a quiz here only when its admission window opens.
          </span>
        </div>
      </section>
      <section className="home-section" aria-labelledby="recent-heading">
        <div className="home-section__head">
          <h2 id="recent-heading">Your recent quizzes</h2>
          <Link className="tiny" to="/history">
            See all {history.total}
          </Link>
        </div>
        {history.items.length === 0 ? (
          <EmptyState title="No quizzes yet">
            Your completed and held quizzes will appear here.
          </EmptyState>
        ) : (
          <div className="card stack">
            {history.items.map((entry) => (
              <HistoryRow key={entry.quizId} entry={entry} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const ready = entry.rank !== null && entry.participantCount !== null;
  return (
    <Link
      className="panel panel--link"
      to={
        ready
          ? `/quiz/${entry.quizId}/results`
          : entry.totalScore === null
            ? `/play/${entry.quizId}`
            : `/quiz/${entry.quizId}/holding`
      }
    >
      <div className="result-row">
        <div className="grow min-zero">
          <div className="rowflex compact">
            <SectionBadge type={entry.type} />
            <span className="tiny">{formatDateTime(entry.scheduledAt)}</span>
          </div>
          <div className="truncate">{entry.title}</div>
        </div>
        <div className="result-end">
          {entry.totalScore === null ? (
            <span className="badge b-open">In progress</span>
          ) : (
            <>
              <div className="result-row__score num">{entry.totalScore}</div>
              {ready ? (
                <div className="tiny">
                  Rank <b className="num">{entry.rank}</b> of{" "}
                  <b className="num">{entry.participantCount}</b>
                </div>
              ) : (
                <div className="tiny">Held</div>
              )}
            </>
          )}
        </div>
      </div>
    </Link>
  );
}

export function JoinPage() {
  const [code, setCode] = useState("");
  const navigate = useNavigate();
  const cleanCode = code
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 12);
  return (
    <>
      <PageHeader
        title="Join by room code"
        subtitle="Enter the code shared when the quiz admission window opens."
        back={{ to: "/", label: "Home" }}
      />
      <form
        className="card joincard stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (cleanCode) navigate(`/lobby/${encodeURIComponent(cleanCode)}`);
        }}
      >
        <label className="field">
          <span>Room code</span>
          <input
            className="inp code-input"
            value={cleanCode}
            autoCapitalize="characters"
            autoComplete="off"
            onChange={(event) => setCode(event.target.value)}
            placeholder="QNT-8417"
            required
          />
        </label>
        <button className="btn block" type="submit" disabled={!cleanCode}>
          Continue
        </button>
      </form>
    </>
  );
}

export function LobbyPage() {
  const { code = "" } = useParams();
  const decodedCode = decodeURIComponent(code);
  const resource = useResource(() => api.openQuizzes(), [decodedCode]);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<unknown>(null);
  const navigate = useNavigate();
  if (resource.loading) return <LoadingCard />;
  if (resource.error)
    return <ErrorState error={resource.error} retry={resource.reload} />;
  const quiz = resource.data?.quizzes.find(
    (item) => item.roomCode.toUpperCase() === decodedCode.toUpperCase(),
  );
  if (!quiz)
    return (
      <EmptyState title="No open room matches that code">
        Check the code and confirm that its admission window is still open.
        <Link className="btn sec" to="/join">
          Try another code
        </Link>
      </EmptyState>
    );
  const join = async () => {
    setJoining(true);
    setJoinError(null);
    try {
      const response = await api.joinQuiz(quiz.roomCode);
      navigate(`/play/${response.meta.quizId}`, {
        replace: true,
        state: response,
      });
    } catch (error) {
      setJoinError(error);
    } finally {
      setJoining(false);
    }
  };
  return (
    <div className="lobby">
      <Link className="phdr__back" to="/">
        <span aria-hidden="true">←</span> Home
      </Link>
      <SectionBadge type={quiz.type} />
      <h1 className="lobby__title">{quiz.title}</h1>
      <p>
        Quiz <span className="num">#{quiz.quizNumber}</span>
      </p>
      <div className="alert a-warn">
        <span aria-hidden="true">⏱</span>
        <span>
          Admission closes at{" "}
          <b className="num">{formatDateTime(quiz.endsAt)}</b>. Your personal
          quiz clock begins only after your seat is claimed.
        </span>
      </div>
      {joinError !== null && <ErrorState error={joinError} />}
      <button
        className="btn lg block"
        type="button"
        onClick={() => void join()}
        disabled={joining}
      >
        {joining ? "Claiming your seat…" : "Join and start"}
      </button>
      <p className="tiny">
        Scoring and timing details are not included in the pre-join API
        response.
      </p>
    </div>
  );
}

export function QuizDetailPage() {
  const { quizId = "" } = useParams();
  const resource = useResource(() => api.openQuizzes(), [quizId]);
  if (resource.loading) return <LoadingCard />;
  if (resource.error || !resource.data)
    return <ErrorState error={resource.error} retry={resource.reload} />;
  const quiz = resource.data.quizzes.find((item) => item.id === quizId);
  if (!quiz)
    return (
      <EmptyState title="Quiz details are unavailable">
        The student API exposes quiz metadata only while a room is accepting new
        joins. Upcoming and closed quiz detail needs a dedicated read route.
      </EmptyState>
    );
  return (
    <>
      <PageHeader
        title={quiz.title}
        subtitle={`${quizTypeLabels[quiz.type]} · Quiz #${quiz.quizNumber}`}
        back={{ to: "/", label: "Home" }}
      />
      <section className="card stack">
        <SectionBadge type={quiz.type} />
        <div className="facts">
          <div className="fact">
            <span>Admission closes</span>
            <b className="num">{formatDateTime(quiz.endsAt)}</b>
          </div>
          <div className="fact">
            <span>Room code</span>
            <b className="num">{quiz.roomCode}</b>
          </div>
        </div>
        <div className="alert a-info">
          <span aria-hidden="true">i</span>
          <span>
            Question count, timing, seat availability, and scoring are not
            fields in <code>OpenQuizSummary</code>, so they are not guessed
            here.
          </span>
        </div>
        <Link
          className="btn block"
          to={`/lobby/${encodeURIComponent(quiz.roomCode)}`}
        >
          Continue to lobby
        </Link>
      </section>
    </>
  );
}

export function HistoryPage() {
  const [offset, setOffset] = useState(0);
  const resource = useResource(
    () => api.history({ limit: 20, offset }),
    [offset],
  );
  return (
    <>
      <PageHeader
        title="Your history"
        subtitle="Finished, held, and active attempts from the server."
        back={{ to: "/", label: "Home" }}
      />
      {resource.loading ? (
        <LoadingCard />
      ) : resource.error || !resource.data ? (
        <ErrorState error={resource.error} retry={resource.reload} />
      ) : resource.data.total === 0 ? (
        <EmptyState title="No quizzes yet">
          Your first attempt will appear here.
        </EmptyState>
      ) : (
        <>
          <div className="card stack">
            {resource.data.items.map((entry) => (
              <HistoryRow key={entry.quizId} entry={entry} />
            ))}
          </div>
          <Pagination page={resource.data} onOffset={setOffset} />
        </>
      )}
    </>
  );
}

const boardTypes: Array<QuizType | "overall"> = [
  "overall",
  "verbal",
  "quant",
  "lr",
];

export function WeeklyBoardPage() {
  const [search, setSearch] = useSearchParams();
  const type = boardTypes.includes(search.get("type") as QuizType | "overall")
    ? (search.get("type") as QuizType | "overall")
    : "overall";
  const weekStart = search.get("weekStart") ?? undefined;
  const offset = Number(search.get("offset") ?? 0);
  const query: WeeklyBoardRequest = {
    type,
    limit: 50,
    offset,
    ...(weekStart ? { weekStart } : {}),
  };
  const resource = useResource(
    () => api.weeklyBoard(query),
    [type, weekStart, offset],
  );
  const update = (
    next: Partial<Record<"type" | "weekStart" | "offset", string>>,
  ) => {
    const params = new URLSearchParams(search);
    Object.entries(next).forEach(([key, value]) =>
      value ? params.set(key, value) : params.delete(key),
    );
    setSearch(params);
  };
  return (
    <>
      <PageHeader
        title="Weekly leaderboards"
        subtitle="Ranked by total score across quizzes taken—not by average."
        back={{ to: "/", label: "Home" }}
      />
      <div className="seg board-tabs" role="tablist" aria-label="Board section">
        {boardTypes.map((item) => (
          <button
            key={item}
            className={item === type ? "on" : ""}
            role="tab"
            aria-selected={item === type}
            type="button"
            onClick={() => update({ type: item, offset: "" })}
          >
            {item === "overall" ? "Overall" : quizTypeLabels[item]}
          </button>
        ))}
      </div>
      {resource.loading ? (
        <LoadingCard />
      ) : resource.error || !resource.data ? (
        <ErrorState error={resource.error} retry={resource.reload} />
      ) : (
        <>
          <div className="week-control">
            <label className="field">
              <span>Published week starting</span>
              <input
                className="inp"
                type="date"
                value={resource.data.weekStart || weekStart || ""}
                onChange={(event) =>
                  update({ weekStart: event.target.value, offset: "" })
                }
              />
            </label>
          </div>
          {resource.data.total === 0 ? (
            <EmptyState title="No published entries">
              This week and section do not have a published board yet.
            </EmptyState>
          ) : (
            <div className="ranklist" aria-label={`${type} weekly board`}>
              {resource.data.items.map((row) => (
                <div
                  className={`rankrow rankrow--list r${Math.min(row.rank, 3)}`}
                  key={row.userId}
                >
                  <span className="rankrow__rank num">{row.rank}</span>
                  <div className="namerow grow min-zero">
                    <div className="av sm" aria-hidden="true">
                      {row.name.slice(0, 2).toUpperCase()}
                    </div>
                    <span className="truncate">{row.name}</span>
                  </div>
                  <span className="rankrow__count tiny">
                    <b className="num">{row.quizzesTaken}</b> quizzes
                  </span>
                  <strong className="num">{row.totalScore} total</strong>
                </div>
              ))}
            </div>
          )}
          <Pagination
            page={resource.data}
            onOffset={(next) => update({ offset: String(next) })}
          />
        </>
      )}
    </>
  );
}

export function QuizResultsPage() {
  const { quizId = "" } = useParams();
  const resource = useResource(
    () => Promise.all([api.leaderboard(quizId), api.review(quizId)]),
    [quizId],
  );
  if (resource.loading) return <LoadingCard />;
  if (
    resource.error instanceof ApiRequestError &&
    resource.error.status === 423
  )
    return (
      <EmptyState title="Results are still locked">
        The complete board appears only after the room closes.
        <Link className="btn" to={`/quiz/${quizId}/holding`}>
          View holding status
        </Link>
      </EmptyState>
    );
  if (
    resource.error instanceof ApiRequestError &&
    resource.error.status === 403
  )
    return <DidNotTakePage />;
  if (resource.error || !resource.data)
    return <ErrorState error={resource.error} retry={resource.reload} />;
  const [board, review] = resource.data;
  const own = board.rows.find((row) => row.isOwnRow);
  const counts = review.rows.reduce(
    (all, row) => ({ ...all, [row.outcome]: all[row.outcome] + 1 }),
    { correct: 0, wrong: 0, skipped: 0, unanswered: 0, not_reached: 0 },
  );
  return (
    <>
      <PageHeader
        title="Quiz results"
        subtitle={`Published ${formatDateTime(board.boardComputedAt)} · ${board.participantCount} participants`}
        back={{ to: "/", label: "Home" }}
        actions={
          <Link className="btn sec" to={`/quiz/${quizId}/review`}>
            Review answers
          </Link>
        }
      />
      {own && (
        <section className="card rankhero">
          <div>
            <span className="wlabel">Your rank</span>
            <div>
              <span className="hero num">{own.rank}</span> · of{" "}
              <span className="num">{board.participantCount}</span>
            </div>
          </div>
          <div>
            <span className="wlabel">Your score</span>
            <div className="hero num">{own.score}</div>
          </div>
        </section>
      )}
      <section className="card" aria-labelledby="breakdown-heading">
        <h2 className="h3" id="breakdown-heading">
          Score breakdown
        </h2>
        <div className="ledger">
          <div className="ledger__row ledger__ok">
            <span>Correct</span>
            <b className="num">{counts.correct}</b>
          </div>
          <div className="ledger__row ledger__no">
            <span>Wrong</span>
            <b className="num">{counts.wrong}</b>
          </div>
          <div className="ledger__row">
            <span>Skipped / timed out / not reached</span>
            <b className="num">
              {counts.skipped + counts.unanswered + counts.not_reached}
            </b>
          </div>
        </div>
      </section>
      <BoardRows rows={board.rows} truncated={board.truncated} />
    </>
  );
}

function BoardRows({
  rows,
  truncated,
}: {
  rows: LeaderboardRowView[];
  truncated: boolean;
}) {
  return (
    <section aria-labelledby="board-heading">
      <h2 className="h3" id="board-heading">
        Leaderboard
      </h2>
      <div className="ranklist">
        {rows.map((row) => (
          <div
            className={`rankrow rankrow--list${row.isOwnRow ? " you" : ""}`}
            key={row.userId}
          >
            <span className="num">{row.rank}</span>
            <div className="namerow grow min-zero">
              <span className="truncate">{row.name}</span>
              {row.isOwnRow && <span className="badge b-you">You</span>}
            </div>
            <strong className="num">{row.score}</strong>
          </div>
        ))}
      </div>
      {truncated && (
        <p className="tiny">
          The API returns the top 10 plus your own row; the complete board is
          intentionally not exposed.
        </p>
      )}
    </section>
  );
}

export function ReviewPage() {
  const { quizId = "" } = useParams();
  const resource = useResource(() => api.review(quizId), [quizId]);
  if (resource.loading) return <LoadingCard />;
  if (
    resource.error instanceof ApiRequestError &&
    resource.error.status === 403
  )
    return <DidNotTakePage />;
  if (resource.error || !resource.data)
    return <ErrorState error={resource.error} retry={resource.reload} />;
  const timingByUnit = new Map(
    resource.data.units.map((unit) => [unit.unitPosition, unit]),
  );
  return (
    <>
      <PageHeader
        title="Review"
        subtitle="Answers and correctness are visible because results are published."
        back={{ to: `/quiz/${quizId}/results`, label: "Quiz results" }}
      />
      <div className="review-list">
        {resource.data.rows.map((row) => (
          <ReviewCard
            key={row.position}
            row={row}
            timing={timingByUnit.get(row.unitPosition)}
          />
        ))}
      </div>
    </>
  );
}

function ReviewCard({
  row,
  timing,
}: {
  row: QuestionReviewRow;
  timing?: { elapsedMs: number | null; roomAvgElapsedMs: number | null };
}) {
  const options = [
    row.question.optionA,
    row.question.optionB,
    row.question.optionC,
    row.question.optionD,
  ];
  const distribution = row.distribution;
  const passage = row.question.passage;
  const bodyContent = (
    <>
      <p className="stem">
        <MathText text={row.question.bodyMd} />
      </p>
      {row.question.imageUrl && (
        <img
          className="qfig"
          src={row.question.imageUrl}
          alt="Question illustration"
        />
      )}
      {row.question.format === "mcq" ? (
        <div className="ropts">
          {options.map((option, index) => {
            if (option === null) return null;
            const letter = String.fromCharCode(65 + index);
            const correct = letter === row.question.correctOption;
            const chosen = letter === row.yourAnswer?.chosenOption;
            return (
              <div
                className={`ropt${correct ? " correct" : ""}${chosen && !correct ? " wrong" : ""}`}
                key={letter}
              >
                <span className="k">{letter}</span>
                <span>
                  <MathText text={option} />
                </span>
                {correct && <span className="badge b-ok">Correct answer</span>}
                {chosen && <span className="badge b-you">Your answer</span>}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="panel">
          <p>
            Correct answer: <b className="num">{row.question.numericAnswer}</b>
            {row.question.numericTolerance !== null && (
              <>
                {" "}
                ± <span className="num">{row.question.numericTolerance}</span>
              </>
            )}
          </p>
          <p>
            Your answer:{" "}
            <b className="num">{row.yourAnswer?.numericValue ?? "No answer"}</b>
          </p>
        </div>
      )}
    </>
  );
  return (
    <article className="rcard" aria-labelledby={`review-${row.position}`}>
      <header className="rcard__hdr">
        <h2 className="rcard__idx" id={`review-${row.position}`}>
          Q<span className="num">{row.position}</span>
        </h2>
        <span
          className={`badge b-${row.outcome === "correct" ? "ok" : row.outcome === "wrong" ? "no" : row.outcome === "unanswered" ? "timeout" : row.outcome === "not_reached" ? "nr" : "skip"}`}
        >
          {row.outcome.replace("_", " ")}
        </span>
      </header>
      {passage ? (
        <>
          <div className="rcard__main panel">
            {passage.title && <h3 className="h3">{passage.title}</h3>}
            <MathText text={passage.bodyMd} />
            {passage.imageUrl && (
              <img
                className="qfig"
                src={passage.imageUrl}
                alt="Shared set illustration"
              />
            )}
          </div>
          <div className="rcard__aside">{bodyContent}</div>
        </>
      ) : (
        <div className="rcard__main rcard__main--full">{bodyContent}</div>
      )}
      <div className="rcard__foot rcard__main--full">
        <div className="explain">
          <strong>Explanation</strong>
          <p>
            <MathText text={row.question.explanationMd} />
          </p>
        </div>
        {distribution && (
          <div className="dist" aria-label="Answer distribution">
            {(["A", "B", "C", "D"] as const).map((letter) => (
              <div className="dist__row" key={letter}>
                <span>{letter}</span>
                <span className="pbar">
                  <span
                    className="pbar__fill"
                    style={{
                      width: `${(distribution.optionCounts[letter] / distribution.participantCount) * 100}%`,
                    }}
                  />
                </span>
                <span className="num">
                  {Math.round(
                    (distribution.optionCounts[letter] /
                      distribution.participantCount) *
                      100,
                  )}
                  %
                </span>
              </div>
            ))}
          </div>
        )}
        {timing?.elapsedMs !== null && timing?.elapsedMs !== undefined && (
          <p className="tiny">
            Set time{" "}
            <span className="num">{Math.round(timing.elapsedMs / 1000)}s</span>
            {timing.roomAvgElapsedMs !== null && (
              <>
                {" "}
                · room average{" "}
                <span className="num">
                  {Math.round(timing.roomAvgElapsedMs / 1000)}s
                </span>
              </>
            )}
          </p>
        )}
      </div>
    </article>
  );
}

export function FinishPage() {
  const { quizId = "" } = useParams();
  const resource = useResource(() => api.currentUnit(quizId), [quizId]);
  if (resource.loading) return <LoadingCard />;
  if (resource.error || !resource.data)
    return <ErrorState error={resource.error} retry={resource.reload} />;
  if (resource.data.state.status !== "finished")
    return (
      <EmptyState title="Quiz still in progress">
        Return to your active unit.
        <Link className="btn" to={`/play/${quizId}`}>
          Continue quiz
        </Link>
      </EmptyState>
    );
  return (
    <>
      <FinishCard
        totalScore={resource.data.state.totalScore}
        answeredCount={resource.data.state.answeredCount}
        questionCount={resource.data.meta.questionCount}
      />
      <div className="rowflex centre">
        <Link className="btn sec" to="/">
          Back to home
        </Link>
        <Link className="btn" to={`/quiz/${quizId}/holding`}>
          Continue
        </Link>
      </div>
    </>
  );
}

export function HoldingPage() {
  const { quizId = "" } = useParams();
  const [now, setNow] = useState(Date.now());
  const resource = useResource(
    () => Promise.all([api.currentUnit(quizId), api.playStatus(quizId)]),
    [quizId],
  );
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (resource.loading) return <LoadingCard />;
  if (resource.error || !resource.data)
    return <ErrorState error={resource.error} retry={resource.reload} />;
  const [current, status] = resource.data;
  if (current.state.status !== "finished")
    return (
      <EmptyState title="Quiz still in progress">
        Return to your active unit.
        <Link className="btn" to={`/play/${quizId}`}>
          Continue quiz
        </Link>
      </EmptyState>
    );
  return (
    <>
      <HoldingCard {...status} now={now} />
      <div className="rowflex centre">
        <Link className="btn sec" to="/">
          Back to home
        </Link>
        <Link className="btn" to={`/quiz/${quizId}/results`}>
          Check results
        </Link>
      </div>
    </>
  );
}

export function ProfilePage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <>
      <PageHeader title="Profile" back={{ to: "/", label: "Home" }} />
      <section className="card profile-card">
        <div className="namerow">
          <div className="av profile-avatar" aria-hidden="true">
            {user.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-zero">
            <h2 className="h2 truncate">{user.name}</h2>
            <p className="tiny">Role: {user.role}</p>
          </div>
        </div>
        <div className="menu profile-menu">
          {user.role !== "student" && (
            <Link to="/admin">Open admin console</Link>
          )}
          <button
            className="danger"
            type="button"
            onClick={() =>
              void signOut().then(() => navigate("/signin", { replace: true }))
            }
          >
            Sign out
          </button>
        </div>
      </section>
    </>
  );
}

export function DidNotTakePage() {
  return (
    <EmptyState title="You did not take this quiz">
      Per-quiz review and leaderboards are available only to participants.
      <Link className="btn sec" to="/history">
        Back to history
      </Link>
    </EmptyState>
  );
}

export function NotFoundPage() {
  return (
    <div className="state standalone-state">
      <img src="/assets/illustrations/shade-error.svg" alt="" />
      <h1 className="h2">Page not found</h1>
      <p>The link may be old or mistyped.</p>
      <Link className="btn" to="/">
        Back to home
      </Link>
    </div>
  );
}
