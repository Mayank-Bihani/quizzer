import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type {
  CurrentUnitResponse,
  JoinQuizResponse,
  SubmitUnitRequest,
} from "../../../../src/core/api";
import type {
  ServedQuestion,
  ServedUnit,
} from "../../../../src/core/contracts";
import { api, ApiRequestError } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { MathText } from "../../components/MathText";
import {
  EmptyState,
  ErrorState,
  LoadingCard,
  SectionBadge,
  useResource,
} from "../../components/ui";
import { formatDuration } from "../../lib/format";
import {
  buildSubmissionAnswers,
  draftStorageKey,
  isUnitResolved,
  remainingSeconds,
  type AnswerDraft,
} from "./run-state";

type PendingBatch = SubmitUnitRequest & { unitPosition: number };

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function RunPage() {
  const { quizId = "" } = useParams();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const joined = location.state as JoinQuizResponse | null;
  const consumedJoinedSnapshot = useRef(false);
  const resource = useResource<CurrentUnitResponse>(
    () => {
      if (!consumedJoinedSnapshot.current && joined?.meta.quizId === quizId) {
        consumedJoinedSnapshot.current = true;
        return Promise.resolve(joined);
      }
      return api.currentUnit(quizId);
    },
    [quizId],
  );

  if (resource.loading)
    return (
      <main className="runpage">
        <LoadingCard />
      </main>
    );
  if (
    resource.error instanceof ApiRequestError &&
    resource.error.status === 401
  ) {
    navigate(`/signin?returnTo=${encodeURIComponent(`/play/${quizId}`)}`, {
      replace: true,
    });
    return null;
  }
  if (
    resource.error instanceof ApiRequestError &&
    resource.error.status === 409
  )
    return (
      <main className="runpage">
        <EmptyState title="This quiz was cancelled">
          {resource.error.message}
          <Link className="btn" to="/">
            Back to home
          </Link>
        </EmptyState>
      </main>
    );
  if (resource.error || !resource.data || !user)
    return (
      <main className="runpage">
        <ErrorState error={resource.error} retry={resource.reload} />
      </main>
    );
  if (resource.data.state.status === "finished") {
    navigate(`/quiz/${quizId}/finish`, { replace: true });
    return null;
  }
  const activeCurrent = {
    meta: resource.data.meta,
    state: resource.data.state,
  };
  return (
    <Runner
      key={`${quizId}:${activeCurrent.state.unit.unitPosition}`}
      current={activeCurrent}
      userId={user.id}
      onState={(state) => resource.setData({ meta: activeCurrent.meta, state })}
      onFinished={() => navigate(`/quiz/${quizId}/finish`, { replace: true })}
      onReload={resource.reload}
    />
  );
}

function Runner({
  current,
  userId,
  onState,
  onFinished,
  onReload,
}: {
  current: CurrentUnitResponse & {
    state: Extract<CurrentUnitResponse["state"], { status: "active" }>;
  };
  userId: string;
  onState: (state: CurrentUnitResponse["state"]) => void;
  onFinished: () => void;
  onReload: () => Promise<void>;
}) {
  const { meta, state } = current;
  const unit = state.unit;
  const storageKey = draftStorageKey(userId, meta.quizId, unit.unitPosition);
  const pendingKey = `${storageKey}:pending`;
  const [drafts, setDrafts] = useState<Record<number, AnswerDraft>>(() =>
    readStored(storageKey, {}),
  );
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selection, setSelection] = useState<string>("");
  const [numericValue, setNumericValue] = useState("");
  const [pending, setPending] = useState<PendingBatch | null>(() =>
    readStored<PendingBatch | null>(pendingKey, null),
  );
  const [error, setError] = useState<unknown>(null);
  const [connection, setConnection] = useState<
    "online" | "offline" | "retrying"
  >(navigator.onLine ? "online" : "offline");
  const [clockNow, setClockNow] = useState(Date.now());
  const receivedAt = useRef(Date.now());
  const submitting = useRef(false);
  const question = unit.questions[questionIndex] ?? unit.questions[0];
  const authoritativeNow = state.serverNow + (clockNow - receivedAt.current);
  const unitSeconds = remainingSeconds(unit.deadlineAt, authoritativeNow);
  const windowSeconds = remainingSeconds(meta.deadlineAt, authoritativeNow);

  useEffect(() => {
    const tick = window.setInterval(() => setClockNow(Date.now()), 250);
    const offline = () => setConnection("offline");
    const online = () => setConnection("online");
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(drafts));
  }, [drafts, storageKey]);

  useEffect(() => {
    if (!question) return;
    const draft = drafts[question.position];
    setSelection(
      draft?.status === "answered" && draft.format === "mcq"
        ? draft.chosenOption
        : "",
    );
    setNumericValue(
      draft?.status === "answered" && draft.format === "tita"
        ? String(draft.numericValue)
        : "",
    );
  }, [drafts, question]);

  const submit = async (batch: PendingBatch) => {
    if (submitting.current) return;
    submitting.current = true;
    setPending(batch);
    window.localStorage.setItem(pendingKey, JSON.stringify(batch));
    setConnection(navigator.onLine ? "retrying" : "offline");
    setError(null);
    try {
      const { submissionId, reason, answers } = batch;
      const response = await api.submitUnit(meta.quizId, batch.unitPosition, {
        submissionId,
        reason,
        answers,
      });
      window.localStorage.removeItem(pendingKey);
      window.localStorage.removeItem(storageKey);
      setPending(null);
      setConnection("online");
      onState(response.state);
      if (response.state.status === "finished") onFinished();
    } catch (submissionError) {
      setError(submissionError);
      setConnection(navigator.onLine ? "retrying" : "offline");
      if (
        submissionError instanceof ApiRequestError &&
        submissionError.status === 410
      )
        await onReload();
    } finally {
      submitting.current = false;
    }
  };

  useEffect(() => {
    if (pending) void submit(pending);
    // Retry the exact persisted batch once on mount; later retries are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (unitSeconds > 0 || pending || submitting.current) return;
    const timeoutBatch: PendingBatch = {
      submissionId: crypto.randomUUID(),
      reason: "timeout",
      answers: buildSubmissionAnswers(unit.questions, drafts, "timeout"),
      unitPosition: unit.unitPosition,
    };
    void submit(timeoutBatch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitSeconds]);

  const commit = (draft: AnswerDraft) => {
    if (!question || pending || unitSeconds === 0) return;
    const nextDrafts = { ...drafts, [question.position]: draft };
    setDrafts(nextDrafts);
    setSelection("");
    setNumericValue("");
    if (isUnitResolved(unit.questions, nextDrafts)) {
      void submit({
        submissionId: crypto.randomUUID(),
        reason: "complete",
        answers: buildSubmissionAnswers(unit.questions, nextDrafts, "complete"),
        unitPosition: unit.unitPosition,
      });
      return;
    }
    const nextIndex = unit.questions.findIndex(
      (candidate, index) =>
        index > questionIndex && !nextDrafts[candidate.position],
    );
    setQuestionIndex(
      nextIndex >= 0
        ? nextIndex
        : unit.questions.findIndex(
            (candidate) => !nextDrafts[candidate.position],
          ),
    );
  };

  if (!question)
    return (
      <main className="runpage">
        <ErrorState
          error={new Error("The active unit has no questions.")}
          retry={onReload}
        />
      </main>
    );

  return (
    <main className={`runpage${unit.passage ? " runpage--passage" : ""}`}>
      <div
        className={`strip ${connection === "online" ? "a-ok" : "a-warn"}${connection === "online" ? " strip-hidden" : ""}`}
        role="status"
      >
        <span className="dot" aria-hidden="true" />
        <span>
          {connection === "offline"
            ? "You are offline. Your local answers are saved and the clock is still running."
            : "Reconnecting. Retrying the same frozen submission…"}
        </span>
      </div>
      <div
        className="rotate-lock"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rotate-title"
      >
        <span className="rotate-lock__phone" aria-hidden="true">
          ▯
        </span>
        <h1 className="rotate-lock__t" id="rotate-title">
          Turn your phone back to portrait
        </h1>
        <p>The quiz clock continues while this message is shown.</p>
      </div>
      <section className="qcard" aria-label={`Question ${question.position}`}>
        <h1 className="sr-only">
          Question {question.position} of {meta.questionCount} — {meta.title}
        </h1>
        <header className="qcard__hdr">
          <div className="qcard__idrow">
            <span className="qidx">
              Q<span className="num">{question.position}</span> of{" "}
              <span className="num">{meta.questionCount}</span>
            </span>
            <SectionBadge type={meta.type} />
            <span className="grow" />
            <span
              className={`clock-win${windowSeconds <= 60 ? " clock-win--final" : ""}`}
            >
              <span aria-hidden="true">⌛</span>
              <span className="num">
                {formatDuration(windowSeconds * 1000)}
              </span>
              <span className="clock-win__note">left in your window</span>
            </span>
          </div>
          <div className="progress">
            <span className="pbar" aria-hidden="true">
              <span
                className="pbar__fill dynamic-progress"
                style={
                  {
                    "--progress": `${Math.round(((question.position - 1) / meta.questionCount) * 100)}%`,
                  } as CSSProperties
                }
              />
            </span>
            <span className="tiny num">
              Unit {unit.unitPosition} of {unit.unitCount}
            </span>
          </div>
          <div className="qtimer">
            <div className="qtimer__row">
              <span className="qtimer__zone">
                Shared time for this{" "}
                {unit.kind === "standalone" ? "question" : "set"}
              </span>
              <span
                className={`clock-q${unitSeconds <= 10 ? " clock-q--urgent" : ""}`}
              >
                <span aria-hidden="true">◷</span>
                <span className="num">
                  {formatDuration(unitSeconds * 1000)}
                </span>
              </span>
            </div>
            <div className={`tbar${unitSeconds === 0 ? " tbar--expired" : ""}`}>
              <span
                className="tbar__fill dynamic-timer"
                style={
                  {
                    "--remaining": `${unit.timeLimitSec > 0 ? (unitSeconds / unit.timeLimitSec) * 100 : 0}%`,
                  } as CSSProperties
                }
              />
            </div>
          </div>
        </header>
        <div className={`qcard__body${unit.passage ? " passage-layout" : ""}`}>
          {unit.passage && (
            <aside className="passage">
              <span className="eyebrow">Shared material</span>
              {unit.passage.title && (
                <h2 className="h2">{unit.passage.title}</h2>
              )}
              <div className="passage__body">
                <MathText text={unit.passage.bodyMd} />
              </div>
              {unit.passage.imageUrl && (
                <img
                  className="qfig"
                  src={unit.passage.imageUrl}
                  alt="Shared set illustration"
                />
              )}
            </aside>
          )}
          <div className="question-pane">
            <p className="tiny">
              Question <span className="num">{question.subPosition}</span> of{" "}
              <span className="num">{unit.questions.length}</span> in this set
            </p>
            <p className="stem">
              <MathText text={question.bodyMd} />
            </p>
            {question.imageUrl && (
              <img
                className="qfig"
                src={question.imageUrl}
                alt="Question illustration"
              />
            )}
            {question.format === "mcq" ? (
              <McqAnswer
                question={question}
                value={selection}
                disabled={Boolean(pending) || unitSeconds === 0}
                onChange={setSelection}
              />
            ) : (
              <TitaAnswer
                value={numericValue}
                disabled={Boolean(pending) || unitSeconds === 0}
                onChange={setNumericValue}
              />
            )}
          </div>
        </div>
        <footer className="qcard__foot">
          <div className="set-nav">
            {unit.questions.length > 1 && (
              <button
                className="btn sec"
                type="button"
                disabled={questionIndex === 0 || Boolean(pending)}
                onClick={() =>
                  setQuestionIndex((index) => Math.max(0, index - 1))
                }
              >
                Back
              </button>
            )}
            <span className="grow" />
            {unit.questions.length > 1 && (
              <button
                className="btn sec"
                type="button"
                disabled={
                  questionIndex >= unit.questions.length - 1 || Boolean(pending)
                }
                onClick={() =>
                  setQuestionIndex((index) =>
                    Math.min(unit.questions.length - 1, index + 1),
                  )
                }
              >
                Next
              </button>
            )}
          </div>
          <div className="qact">
            <div className="qact__skip">
              <button
                className="btn sec"
                type="button"
                disabled={Boolean(pending) || unitSeconds === 0}
                onClick={() => commit({ status: "skipped" })}
              >
                {isLastUnresolved(unit, drafts, question.position)
                  ? "Skip & finish set"
                  : "Skip this question"}{" "}
                <span aria-hidden="true">→</span>
              </button>
              <p className="qact__note">
                Scores <span className="num">0</span>. You may revisit it until
                this set closes.
              </p>
            </div>
            <button
              className="btn lg block"
              type="button"
              disabled={
                Boolean(pending) ||
                unitSeconds === 0 ||
                (question.format === "mcq"
                  ? !selection
                  : !isFiniteNumber(numericValue))
              }
              onClick={() =>
                commit(
                  question.format === "mcq"
                    ? {
                        status: "answered",
                        format: "mcq",
                        chosenOption: selection as "A" | "B" | "C" | "D",
                      }
                    : {
                        status: "answered",
                        format: "tita",
                        numericValue: Number(numericValue),
                      },
                )
              }
            >
              {pending
                ? "Submitting frozen set…"
                : isLastUnresolved(unit, drafts, question.position)
                  ? "Answer & finish set"
                  : "Save answer & continue"}
            </button>
          </div>
          {error !== null && (
            <div className="alert a-dgr" role="alert">
              <span aria-hidden="true">!</span>
              <span>
                {error instanceof Error ? error.message : "Submission failed."}{" "}
                <button
                  className="link-button"
                  type="button"
                  onClick={() => pending && void submit(pending)}
                >
                  Retry
                </button>
              </span>
            </div>
          )}
        </footer>
      </section>
    </main>
  );
}

function isLastUnresolved(
  unit: ServedUnit,
  drafts: Record<number, AnswerDraft>,
  currentPosition: number,
): boolean {
  return (
    unit.questions.filter(
      (question) =>
        question.position === currentPosition || !drafts[question.position],
    ).length === 1
  );
}

function isFiniteNumber(value: string): boolean {
  return value.trim() !== "" && Number.isFinite(Number(value));
}

function McqAnswer({
  question,
  value,
  disabled,
  onChange,
}: {
  question: ServedQuestion;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="opts" disabled={disabled}>
      <legend className="sr-only">Choose one option</legend>
      {question.options?.map((option, index) => {
        const letter = String.fromCharCode(65 + index);
        const id = `q${question.position}-${letter}`;
        return (
          <div key={letter}>
            <input
              className="sr-only"
              type="radio"
              name={`q${question.position}`}
              id={id}
              checked={value === letter}
              onChange={() => onChange(letter)}
            />
            <label className="opt" htmlFor={id}>
              <span className="k" aria-hidden="true">
                {letter}
              </span>
              <span className="opt__txt">
                <MathText text={option} />
              </span>
            </label>
          </div>
        );
      })}
    </fieldset>
  );
}

function TitaAnswer({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="stack">
      <label className="field">
        <span>Your numeric answer</span>
        <input
          className={`answerbox${value ? " answerbox--filled" : ""}`}
          type="text"
          inputMode="decimal"
          value={value}
          disabled={disabled}
          onChange={(event) =>
            onChange(event.target.value.replace(/[^0-9+-.]/g, ""))
          }
        />
      </label>
      <div className="keypad" aria-label="Numeric keypad">
        {["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "⌫"].map(
          (key) => (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() =>
                onChange(key === "⌫" ? value.slice(0, -1) : `${value}${key}`)
              }
            >
              {key}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
