import { Fragment, useMemo, useState, type FormEvent } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type {
  AdminReportParticipantRow,
  CreateQuizDraftResponse,
  QuizAdminSummary,
  UpdateQuestionRequest,
} from "../../../../src/core/api";
import type {
  Difficulty,
  QuestionFull,
  QuizStatus,
  QuizType,
  Role,
  TimingPolicy,
  UnitKind,
} from "../../../../src/core/contracts";
import { api, ApiRequestError } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { ConfirmDialog } from "../../components/ConfirmDialog";
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
import {
  formatDateTime,
  formatDuration,
  quizTypeLabels,
} from "../../lib/format";
import {
  derivedWindowSeconds,
  groupIntoPickUnits,
  mixTotal,
  tallyByDifficulty,
  toggleSelection,
  type PickUnit,
} from "./builder-state";
import { TemplatesPanel } from "./TemplatesPanel";

export function AdminHomePage() {
  const { user } = useAuth();
  const resource = useResource(
    () =>
      Promise.all([
        api.questions({ limit: 1 }),
        fetchAllQuizzes(),
        api.users(),
      ]),
    [],
  );
  if (resource.loading) return <LoadingCard />;
  if (resource.error || !resource.data)
    return <ErrorState error={resource.error} retry={resource.reload} />;
  const [questions, quizzes, users] = resource.data;
  const statusCount = (status: QuizStatus) =>
    quizzes.filter((quiz) => quiz.status === status).length;
  return (
    <>
      <PageHeader
        eyebrow={new Intl.DateTimeFormat("en-IN", {
          dateStyle: "full",
          timeZone: "Asia/Kolkata",
        }).format(Date.now())}
        title="Console home"
        subtitle={`Signed in as ${user?.role} · ${user?.name}`}
      />
      <div className="dashgrid">
        <Link className="card panel--link dashcard" to="/admin/bank">
          <span className="eyebrow">Bank</span>
          <span className="dashcard__stat">
            <span className="num">{questions.total}</span> questions
          </span>
          <span className="tiny">Browse, filter, edit, and import</span>
        </Link>
        <Link className="card panel--link dashcard" to="/admin/schedule">
          <span className="eyebrow">Quizzes</span>
          <span className="dashcard__stat">
            <span className="num">{statusCount("open")}</span> open now
          </span>
          <span className="tiny">
            <span className="num">{statusCount("scheduled")}</span> scheduled ·{" "}
            <span className="num">{statusCount("draft")}</span> drafts
          </span>
        </Link>
        <Link className="card panel--link dashcard" to="/admin/reports">
          <span className="eyebrow">Reports</span>
          <span className="dashcard__stat">
            <span className="num">{statusCount("ended")}</span> ended quizzes
          </span>
          <span className="tiny">Open a completed report</span>
        </Link>
        <Link className="card panel--link dashcard" to="/admin/users">
          <span className="eyebrow">Admins</span>
          <span className="dashcard__stat">
            <span className="num">
              {users.users.filter((member) => member.role !== "student").length}
            </span>{" "}
            elevated accounts
          </span>
          <span className="tiny">Role controls are superadmin-only</span>
        </Link>
      </div>
    </>
  );
}

const sectionAbbrev: Record<QuizType, string> = {
  verbal: "VA",
  quant: "QA",
  lr: "LR",
};

const difficultyBadgeClass: Record<Difficulty, string> = {
  easy: "b-easy",
  medium: "b-med",
  hard: "b-hard",
};

const unitKindLabels: Record<UnitKind, string> = {
  standalone: "Standalone unit seconds",
  rc: "RC unit seconds",
  lrdi: "LRDI unit seconds",
};

export function BankPage() {
  const [search, setSearch] = useSearchParams();
  const [deleteQuestion, setDeleteQuestion] = useState<QuestionFull | null>(
    null,
  );
  const [mutationError, setMutationError] = useState<unknown>(null);
  const type = (search.get("type") || undefined) as QuizType | undefined;
  const difficulty = (search.get("difficulty") || undefined) as
    Difficulty | undefined;
  const usedValue = search.get("used");
  const used =
    usedValue === "true" ? true : usedValue === "false" ? false : undefined;
  const offset = Number(search.get("offset") ?? 0);
  const topic = search.get("topic") || undefined;
  const resource = useResource(
    () => api.questions({ limit: 25, offset, type, difficulty, used, topic }),
    [offset, type, difficulty, used, topic],
  );
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(search);
    value ? next.set(key, value) : next.delete(key);
    if (key !== "offset") next.delete("offset");
    setSearch(next);
  };
  return (
    <>
      <PageHeader
        title="Question bank"
        subtitle="Every result comes from the paginated bank route."
        back={{ to: "/admin", label: "Console home" }}
        actions={
          <div className="rowflex">
            <Link className="btn sec" to="/admin/bank/passages">
              Passage groups
            </Link>
            <Link className="btn" to="/admin/import/upload">
              Import CSV
            </Link>
          </div>
        }
      />
      <section className="card">
        <div className="rowflex">
          <label className="field">
            <span>Section</span>
            <select
              className="inp"
              value={type ?? ""}
              onChange={(event) => update("type", event.target.value)}
            >
              <option value="">All</option>
              <option value="verbal">Verbal</option>
              <option value="quant">Quant</option>
              <option value="lr">Logical Reasoning</option>
            </select>
          </label>
          <label className="field">
            <span>Difficulty</span>
            <select
              className="inp"
              value={difficulty ?? ""}
              onChange={(event) => update("difficulty", event.target.value)}
            >
              <option value="">All</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </label>
          <label className="field">
            <span>Use</span>
            <select
              className="inp"
              value={usedValue ?? ""}
              onChange={(event) => update("used", event.target.value)}
            >
              <option value="">All</option>
              <option value="false">Unused</option>
              <option value="true">Used</option>
            </select>
          </label>
          <label className="field grow">
            <span>Topic</span>
            <input
              className="inp"
              value={topic ?? ""}
              onChange={(event) => update("topic", event.target.value)}
            />
          </label>
        </div>
      </section>
      {mutationError && <ErrorState error={mutationError} />}
      {resource.loading ? (
        <LoadingCard />
      ) : resource.error || !resource.data ? (
        <ErrorState error={resource.error} retry={resource.reload} />
      ) : resource.data.total === 0 ? (
        <EmptyState title="No matching questions">
          Adjust the filters or import new questions.
        </EmptyState>
      ) : (
        <>
          <div className="tablewrap">
            <table className="dt">
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Section</th>
                  <th>Diff</th>
                  <th>Format</th>
                  <th>Use</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {resource.data.items.map((question) => (
                  <tr key={question.id}>
                    <td>
                      <Link
                        className="qlink"
                        to={`/admin/bank/questions/${question.id}`}
                      >
                        {question.topic}
                        <span className="qlink__arrow" aria-hidden="true">
                          →
                        </span>
                      </Link>
                      {question.subtopic ? (
                        <div className="tiny">{question.subtopic}</div>
                      ) : null}
                    </td>
                    <td>
                      <span
                        className={`badge sq b-sec b-${question.type}`}
                      >
                        {sectionAbbrev[question.type]}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge sq ${difficultyBadgeClass[question.difficulty]}`}
                      >
                        {question.difficulty[0].toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <span className="tiny">
                        {question.format.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge ${question.usedInQuizId ? "b-used" : "b-unused"}`}
                      >
                        {question.usedInQuizId ? "Used" : "Unused"}
                      </span>
                    </td>
                    <td>
                      <div className="rowflex">
                        <Link
                          className="btn sm sec"
                          to={`/admin/bank/questions/${question.id}`}
                        >
                          Edit
                        </Link>
                        <button
                          className="btn sm ghost"
                          type="button"
                          onClick={() => setDeleteQuestion(question)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bankcards">
            {resource.data.items.map((question) => (
              <article className="bankcard" key={question.id}>
                <div className="rowflex-between">
                  <SectionBadge type={question.type} />
                  <div className="rowflex">
                    <span
                      className={`badge sq ${difficultyBadgeClass[question.difficulty]}`}
                    >
                      {question.difficulty[0].toUpperCase()}
                    </span>
                    <span
                      className={`badge ${question.usedInQuizId ? "b-used" : "b-unused"}`}
                    >
                      {question.usedInQuizId ? "Used" : "Unused"}
                    </span>
                  </div>
                </div>
                <Link
                  className="qlink bankcard__stem"
                  to={`/admin/bank/questions/${question.id}`}
                >
                  {question.topic}
                  <span className="qlink__arrow" aria-hidden="true">
                    →
                  </span>
                </Link>
                {question.subtopic ? (
                  <div className="tiny">{question.subtopic}</div>
                ) : null}
                <div className="rowflex">
                  <Link
                    className="btn sec"
                    to={`/admin/bank/questions/${question.id}`}
                  >
                    Edit question
                  </Link>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => setDeleteQuestion(question)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
          <Pagination
            page={resource.data}
            onOffset={(next) => update("offset", String(next))}
          />
        </>
      )}
      <ConfirmDialog
        open={Boolean(deleteQuestion)}
        title="Delete this question?"
        confirmLabel="Delete question"
        danger
        onClose={() => setDeleteQuestion(null)}
        onConfirm={() => {
          if (!deleteQuestion) return;
          void api
            .deleteQuestion(deleteQuestion.id)
            .then(() => {
              setDeleteQuestion(null);
              void resource.reload();
            })
            .catch(setMutationError);
        }}
      >
        The response DTO does not expose whether this question is used. The
        backend refuses used-question deletion with 409 and deletes an unused
        passage group atomically.
      </ConfirmDialog>
    </>
  );
}

export function QuestionEditorPage() {
  const { questionId = "" } = useParams();
  const resource = useResource(() => api.question(questionId), [questionId]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  if (resource.loading) return <LoadingCard />;
  if (resource.error || !resource.data)
    return <ErrorState error={resource.error} retry={resource.reload} />;
  const question = resource.data;
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const body: UpdateQuestionRequest = {
      topic: String(form.get("topic") ?? ""),
      subtopic: nullable(form.get("subtopic")),
      difficulty: String(form.get("difficulty")) as Difficulty,
      bodyMd: String(form.get("bodyMd") ?? ""),
      explanationMd: String(form.get("explanationMd") ?? ""),
      source: nullable(form.get("source")),
      ...(question.format === "mcq"
        ? {
            optionA: nullable(form.get("optionA")),
            optionB: nullable(form.get("optionB")),
            optionC: nullable(form.get("optionC")),
            optionD: nullable(form.get("optionD")),
          }
        : { numericTolerance: Number(form.get("numericTolerance")) }),
    };
    try {
      resource.setData(await api.updateQuestion(question.id, body));
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };
  const optionValues = {
    A: question.optionA,
    B: question.optionB,
    C: question.optionC,
    D: question.optionD,
  };
  return (
    <>
      <PageHeader
        title="Edit question"
        subtitle={`${quizTypeLabels[question.type]} · ${question.format.toUpperCase()} · use/freeze status is not present in QuestionFull`}
        back={{ to: "/admin/bank", label: "Question bank" }}
      />
      <div className="editorgrid">
        <form className="card stack" onSubmit={(event) => void save(event)}>
          <label className="field">
            <span>Topic</span>
            <input
              className="inp"
              name="topic"
              defaultValue={question.topic}
              required
            />
          </label>
          <label className="field">
            <span>Subtopic</span>
            <input
              className="inp"
              name="subtopic"
              defaultValue={question.subtopic ?? ""}
            />
          </label>
          <label className="field">
            <span>Difficulty</span>
            <select
              className="inp"
              name="difficulty"
              defaultValue={question.difficulty}
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </label>
          <label className="field">
            <span>Question body · Markdown + LaTeX</span>
            <textarea
              className="inp textarea"
              name="bodyMd"
              defaultValue={question.bodyMd}
              required
            />
          </label>
          {question.format === "mcq" ? (
            (["A", "B", "C", "D"] as const).map((letter) => (
              <label className="field" key={letter}>
                <span>
                  Option {letter}
                  {question.correctOption === letter ? " · correct" : ""}
                </span>
                <input
                  className="inp"
                  name={`option${letter}`}
                  defaultValue={optionValues[letter] ?? ""}
                  required
                />
              </label>
            ))
          ) : (
            <>
              <label className="field">
                <span>Correct numeric answer · read-only contract field</span>
                <input
                  className="inp"
                  value={question.numericAnswer ?? ""}
                  readOnly
                />
              </label>
              <label className="field">
                <span>Tolerance</span>
                <input
                  className="inp"
                  name="numericTolerance"
                  type="number"
                  min="0"
                  step="any"
                  defaultValue={question.numericTolerance ?? 0}
                />
              </label>
            </>
          )}
          <label className="field">
            <span>Explanation</span>
            <textarea
              className="inp textarea"
              name="explanationMd"
              defaultValue={question.explanationMd}
              required
            />
          </label>
          <label className="field">
            <span>Source</span>
            <input
              className="inp"
              name="source"
              defaultValue={question.source ?? ""}
            />
          </label>
          <button className="btn" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
          {message && <p role="status">{message}</p>}
        </form>
        <aside className="card editor-preview">
          <span className="eyebrow">Preview</span>
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
          <div className="explain">
            <MathText text={question.explanationMd} />
          </div>
        </aside>
      </div>
    </>
  );
}

function nullable(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

export function PassagePage() {
  const { passageId } = useParams();
  const resource = useResource(() => api.passages(), []);
  if (resource.loading) return <LoadingCard />;
  if (resource.error || !resource.data)
    return <ErrorState error={resource.error} retry={resource.reload} />;
  if (!passageId)
    return (
      <>
        <PageHeader
          title="Passage groups"
          subtitle="Shared RC and LRDI material."
          back={{ to: "/admin/bank", label: "Question bank" }}
        />
        {resource.data.passages.length === 0 ? (
          <EmptyState title="No passage groups">
            Import a CSV containing passage rows and 4–5 matching questions.
          </EmptyState>
        ) : (
          <div className="stack">
            {resource.data.passages.map((passage) => (
              <Link
                className="card panel--link"
                to={`/admin/bank/passages/${passage.id}`}
                key={passage.id}
              >
                <div className="rowflex-between">
                  <div>
                    <SectionBadge type={passage.type} />
                    <h2 className="h3">
                      {passage.title ?? "Untitled shared material"}
                    </h2>
                    <p className="tiny">{passage.topic}</p>
                  </div>
                  <span>Open →</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </>
    );
  const passage = resource.data.passages.find((item) => item.id === passageId);
  if (!passage)
    return (
      <EmptyState title="Passage not found">
        It may have been removed.
      </EmptyState>
    );
  return (
    <>
      <PageHeader
        title={passage.title ?? "Untitled shared material"}
        subtitle={`${quizTypeLabels[passage.type]} · ${passage.topic}`}
        back={{ to: "/admin/bank/passages", label: "Passage groups" }}
      />
      <article className="card pgroup">
        <MathText text={passage.bodyMd} />
        {passage.imageUrl && (
          <img
            className="qfig"
            src={passage.imageUrl}
            alt="Passage illustration"
          />
        )}
        <p className="tiny">{passage.source ?? "No source recorded"}</p>
      </article>
      <div className="alert a-info">
        <span aria-hidden="true">i</span>
        <span>
          The API has no passage-id question filter, so this page does not guess
          or show a potentially incomplete child-question list.
        </span>
      </div>
    </>
  );
}

type ImportFiles = { csv: File | null; images: File | null };

export function ImportPage() {
  const { step = "upload" } = useParams();
  const navigate = useNavigate();
  const [files, setFiles] = useState<ImportFiles>({ csv: null, images: null });
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof api.importPreview>
  > | null>(null);
  const [commit, setCommit] = useState<Awaited<
    ReturnType<typeof api.importCommit>
  > | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const form = () => {
    const body = new FormData();
    if (files.csv) body.set("csv", files.csv);
    if (files.images) body.set("images", files.images);
    return body;
  };
  const previewFiles = async () => {
    if (!files.csv) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(await api.importPreview(form()));
      navigate("/admin/import/preview");
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  const commitFiles = async () => {
    if (!files.csv) return;
    setBusy(true);
    setError(null);
    try {
      setCommit(await api.importCommit(form()));
      navigate("/admin/import/commit");
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  if (step === "preview" && !preview)
    return (
      <EmptyState title="Upload files first">
        Browser file handles cannot be restored after a reload.
        <Link className="btn" to="/admin/import/upload">
          Choose files
        </Link>
      </EmptyState>
    );
  if (step === "commit" && !commit)
    return (
      <EmptyState title="No committed import in this tab">
        Start with a validation preview.
        <Link className="btn" to="/admin/import/upload">
          Import questions
        </Link>
      </EmptyState>
    );
  return (
    <>
      <PageHeader
        title={
          step === "upload"
            ? "Import questions"
            : step === "preview"
              ? "Validation preview"
              : "Import result"
        }
        subtitle="CSV is required; an image ZIP is optional."
        back={
          step === "upload"
            ? { to: "/admin/bank", label: "Question bank" }
            : step === "preview"
              ? { to: "/admin/import/upload", label: "Upload" }
              : { to: "/admin/import/preview", label: "Validation preview" }
        }
      />
      {error && <ErrorState error={error} />}
      {step === "upload" && (
        <section className="card dz stack">
          <label className="field">
            <span>Question CSV · maximum 5 MB</span>
            <input
              className="inp"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) =>
                setFiles((current) => ({
                  ...current,
                  csv: event.target.files?.[0] ?? null,
                }))
              }
            />
          </label>
          <label className="field">
            <span>Companion image ZIP · maximum 20 MB</span>
            <input
              className="inp"
              type="file"
              accept=".zip,application/zip"
              onChange={(event) =>
                setFiles((current) => ({
                  ...current,
                  images: event.target.files?.[0] ?? null,
                }))
              }
            />
          </label>
          <button
            className="btn"
            disabled={!files.csv || busy}
            onClick={() => void previewFiles()}
          >
            {busy ? "Validating…" : "Validate files"}
          </button>
        </section>
      )}
      {step === "preview" && preview && (
        <>
          <div className={`alert ${preview.errors.length ? "a-dgr" : "a-ok"}`}>
            <span aria-hidden="true">{preview.errors.length ? "!" : "✓"}</span>
            <span>
              <b className="num">{preview.counts.questions}</b> questions and{" "}
              <b className="num">{preview.counts.passages}</b> passages parsed ·{" "}
              <b className="num">{preview.errors.length}</b> errors
            </span>
          </div>
          {preview.errors.length > 0 && (
            <div className="card stack" role="alert">
              {preview.errors.map((item, index) => (
                <p key={`${item.line}:${index}`}>
                  <b className="num">Line {item.line}</b> · {item.message}
                </p>
              ))}
            </div>
          )}
          <div className="commitbar">
            <Link className="btn sec" to="/admin/import/upload">
              Choose different files
            </Link>
            <button
              className="btn"
              type="button"
              disabled={preview.errors.length > 0 || busy}
              onClick={() => void commitFiles()}
            >
              {busy ? "Committing…" : "Commit import"}
            </button>
          </div>
        </>
      )}
      {step === "commit" && commit && (
        <div className="state">
          <img src="/assets/illustrations/shade-finished.svg" alt="" />
          <h2 className="h2">
            {commit.importId ? "Import complete" : "Nothing was imported"}
          </h2>
          <p>
            <span className="num">{commit.counts.questions}</span> questions ·{" "}
            <span className="num">{commit.counts.passages}</span> passages ·{" "}
            <span className="num">{commit.errors.length}</span> errors
          </p>
          {commit.errors.length > 0 && (
            <div className="alert a-dgr">
              A failed import writes nothing. Import id: none.
            </div>
          )}
          <Link className="btn" to="/admin/bank">
            Return to bank
          </Link>
        </div>
      )}
    </>
  );
}

const BUILDER_KEY = "quizzer:builder";
// Manual mode has no draw to persist until the pick step submits — quizId/status/questionCount/
// unitCount/units/questions only exist from that point on, hence Partial<CreateQuizDraftResponse>.
type BuilderSession = Partial<CreateQuizDraftResponse> & {
  title: string;
  type: QuizType;
  scheduledAt: number;
  mode: "auto" | "manual";
  difficultyMix?: Partial<Record<Difficulty, number>>;
  summary?: QuizAdminSummary;
};

function getBuilder(): BuilderSession | null {
  try {
    const raw = sessionStorage.getItem(BUILDER_KEY);
    return raw ? (JSON.parse(raw) as BuilderSession) : null;
  } catch {
    return null;
  }
}

function saveBuilder(builder: BuilderSession) {
  sessionStorage.setItem(BUILDER_KEY, JSON.stringify(builder));
}

export function QuizBuilderPage() {
  const { step = "define" } = useParams();
  const navigate = useNavigate();
  const [builder, setBuilder] = useState<BuilderSession | null>(() =>
    getBuilder(),
  );
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [defineMode, setDefineMode] = useState<"auto" | "manual">("auto");
  const [pickedQuestions, setPickedQuestions] = useState<QuestionFull[]>([]);
  const mode = builder?.mode ?? defineMode;
  const setAndSave = (next: BuilderSession) => {
    setBuilder(next);
    saveBuilder(next);
  };
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title"));
    const type = String(form.get("type")) as QuizType;
    const scheduledAt = new Date(String(form.get("scheduledAt"))).getTime();

    if (defineMode === "manual") {
      setPickedQuestions([]);
      setAndSave({ title, type, scheduledAt, mode: "manual" });
      navigate("/admin/quizzes/new/pick");
      return;
    }

    const difficultyMix = {
      easy: Number(form.get("easy")),
      medium: Number(form.get("medium")),
      hard: Number(form.get("hard")),
    };
    const count = Number(form.get("count"));
    if (mixTotal(difficultyMix) !== count) {
      setError(
        new Error("Difficulty counts must add up to the question count."),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await api.createQuiz({
        mode: "auto",
        title,
        type,
        scheduledAt,
        count,
        difficultyMix,
      });
      const next: BuilderSession = {
        ...response,
        title,
        type,
        scheduledAt,
        mode: "auto",
        difficultyMix,
      };
      setAndSave(next);
      navigate("/admin/quizzes/new/draw");
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  if (step !== "define" && !builder)
    return (
      <EmptyState title="Start with the quiz definition">
        The API can recover draft summaries, but not the full drawn question
        content needed by this browser step.
        <Link className="btn" to="/admin/quizzes/new/define">
          Define a quiz
        </Link>
      </EmptyState>
    );
  // A manual builder has no quizId until the pick step submits — every later step needs it.
  if (step !== "define" && step !== "pick" && builder && !builder.quizId)
    return (
      <EmptyState title="Finish selecting questions first">
        This manual draft has not been created yet.
        <Link className="btn" to="/admin/quizzes/new/pick">
          Back to the picker
        </Link>
      </EmptyState>
    );
  const submitManualPick = async () => {
    if (!builder || pickedQuestions.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api.createQuiz({
        mode: "manual",
        title: builder.title,
        type: builder.type,
        scheduledAt: builder.scheduledAt,
        questionIds: pickedQuestions.map((question) => question.id),
      });
      const next: BuilderSession = {
        ...response,
        title: builder.title,
        type: builder.type,
        scheduledAt: builder.scheduledAt,
        mode: "manual",
      };
      setAndSave(next);
      navigate("/admin/quizzes/new/draw");
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  const reshuffle = async () => {
    if (!builder || !builder.quizId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.reshuffleQuiz(builder.quizId);
      setAndSave({ ...builder, ...result });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  const updateParams = async (
    event: FormEvent<HTMLFormElement>,
    nextStep: string,
  ) => {
    event.preventDefault();
    if (!builder || !builder.quizId || !builder.units) return;
    const form = new FormData(event.currentTarget);
    const usedKinds = new Set(builder.units.map((unit) => unit.kind));
    const timingPolicy: TimingPolicy = {};
    for (const kind of usedKinds) {
      timingPolicy[kind] = Number(form.get(kind));
    }
    setBusy(true);
    setError(null);
    try {
      const summary = await api.updateQuiz(builder.quizId, {
        timingPolicy,
        slackSec: Number(form.get("slackSec")),
        marksCorrect: Number(form.get("marksCorrect")),
        marksWrong: Number(form.get("marksWrong")),
        seatCap: Number(form.get("seatCap")),
      });
      setAndSave({ ...builder, summary });
      navigate(nextStep);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  const schedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!builder || !builder.quizId) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api.updateQuiz(builder.quizId, {
        scheduledAt: new Date(String(form.get("scheduledAt"))).getTime(),
        joinWindowSec: Number(form.get("joinWindowSec")),
      });
      navigate("/admin/quizzes/new/lock");
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  const lock = async () => {
    if (!builder || !builder.quizId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.lockQuiz(builder.quizId);
      if (!result.locked)
        throw new Error(
          `Only ${result.claimedCount} of ${result.requestedCount} questions could be retired. The quiz remains unlocked.`,
        );
      sessionStorage.removeItem(BUILDER_KEY);
      setLockOpen(false);
      navigate("/admin/schedule");
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title={step === "define" ? "New quiz" : (builder?.title ?? "New quiz")}
        subtitle={`Builder · ${step}`}
        back={
          step === "define"
            ? { to: "/admin", label: "Console home" }
            : step === "pick"
              ? { to: "/admin/quizzes/new/define", label: "Define" }
              : step === "draw"
                ? mode === "manual"
                  ? { to: "/admin/quizzes/new/pick", label: "Pick" }
                  : { to: "/admin/quizzes/new/define", label: "Define" }
                : step === "scoring"
                  ? { to: "/admin/quizzes/new/draw", label: "Draw" }
                  : step === "schedule"
                    ? { to: "/admin/quizzes/new/scoring", label: "Scoring" }
                    : { to: "/admin/quizzes/new/schedule", label: "Schedule" }
        }
      />
      {error && (
        <div className="alert a-dgr" role="alert">
          <span aria-hidden="true">!</span>
          <span>
            {error instanceof ApiRequestError && error.status === 409
              ? `Draw failed: ${error.message} Adjust the difficulty mix or question count; no questions were reused.`
              : error instanceof Error
                ? error.message
                : "Request failed."}
          </span>
        </div>
      )}
      <BuilderSteps current={step} mode={mode} />
      {step === "define" && (
        <form
          className="card builderform"
          onSubmit={(event) => void create(event)}
        >
          <label className="field">
            <span>Title</span>
            <input className="inp" name="title" required />
          </label>
          <label className="field">
            <span>Section</span>
            <select className="inp" name="type" defaultValue="" required>
              <option value="" disabled>
                Choose a section
              </option>
              <option value="verbal">Verbal</option>
              <option value="quant">Quant</option>
              <option value="lr">Logical Reasoning</option>
            </select>
          </label>
          <fieldset className="field">
            <legend>Selection mode</legend>
            <div className="rowflex">
              <label>
                <input
                  type="radio"
                  name="selectionMode"
                  value="auto"
                  checked={defineMode === "auto"}
                  onChange={() => setDefineMode("auto")}
                />{" "}
                Auto draw
              </label>
              <label>
                <input
                  type="radio"
                  name="selectionMode"
                  value="manual"
                  checked={defineMode === "manual"}
                  onChange={() => setDefineMode("manual")}
                />{" "}
                Select manually
              </label>
            </div>
          </fieldset>
          {defineMode === "auto" && (
            <>
              <label className="field">
                <span>Question count</span>
                <input
                  className="inp"
                  name="count"
                  type="number"
                  min="1"
                  max="100"
                  required
                />
              </label>
              {(["easy", "medium", "hard"] as const).map((difficulty) => (
                <label className="field" key={difficulty}>
                  <span>{difficulty} (optional, defaults to 0)</span>
                  <input
                    className="inp"
                    name={difficulty}
                    type="number"
                    min="0"
                  />
                </label>
              ))}
            </>
          )}
          <label className="field">
            <span>Provisional scheduled time</span>
            <input
              className="inp"
              name="scheduledAt"
              type="datetime-local"
              required
            />
          </label>
          <button className="btn" disabled={busy}>
            {busy
              ? "Drawing…"
              : defineMode === "manual"
                ? "Continue to picker"
                : "Draw questions"}
          </button>
        </form>
      )}
      {step === "pick" && builder && builder.mode === "manual" && (
        <QuizPickStep
          type={builder.type}
          selected={pickedQuestions}
          onToggleGroup={(group) =>
            setPickedQuestions((previous) => toggleSelection(previous, group))
          }
          onSubmit={() => void submitManualPick()}
          busy={busy}
        />
      )}
      {step === "draw" &&
        builder &&
        builder.questions &&
        builder.units &&
        builder.questionCount !== undefined &&
        builder.unitCount !== undefined && (
        <div className="drawgrid">
          <section className="card">
            <div className="rowflex-between">
              <h2 className="h2">Drawn questions</h2>
              {builder.mode !== "manual" && (
                <button
                  className="btn sec"
                  disabled={busy}
                  onClick={() => void reshuffle()}
                >
                  Reshuffle
                </button>
              )}
            </div>
            <div className="drawlist">
              {builder.questions.map((question, index) => (
                <div className="drawrow" key={question.id}>
                  <span className="num">{index + 1}</span>
                  <span className="grow truncate">
                    <MathText text={question.bodyMd} />
                  </span>
                  <span className="badge b-draft">{question.difficulty}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="card">
            <h2 className="h2">Composition</h2>
            <p>
              <b className="num">{builder.questionCount}</b> questions in{" "}
              <b className="num">{builder.unitCount}</b> timed units.
            </p>
            {builder.units.map((unit) => (
              <div className="panel" key={unit.unitPosition}>
                Unit <span className="num">{unit.unitPosition}</span> ·{" "}
                {unit.kind} ·{" "}
                <span className="num">{unit.questionPositions.length}</span>{" "}
                questions
              </div>
            ))}
            <Link className="btn block" to="/admin/quizzes/new/scoring">
              Continue to timing & scoring
            </Link>
          </section>
        </div>
      )}
      {step === "scoring" && builder && builder.units && (
        <form
          className="card builderform"
          onSubmit={(event) =>
            void updateParams(event, "/admin/quizzes/new/schedule")
          }
        >
          <h2 className="h2">Timing and scoring</h2>
          {(() => {
            const usedKinds = new Set(builder.units.map((unit) => unit.kind));
            return (["standalone", "rc", "lrdi"] as const)
              .filter((kind) => usedKinds.has(kind))
              .map((kind) => (
                <label className="field" key={kind}>
                  <span>{unitKindLabels[kind]}</span>
                  <input className="inp" name={kind} type="number" min="1" required />
                </label>
              ));
          })()}
          <label className="field">
            <span>Buffer time between units (seconds)</span>
            <input
              className="inp"
              name="slackSec"
              type="number"
              min="0"
              required
            />
          </label>
          <label className="field">
            <span>Marks for correct</span>
            <input
              className="inp"
              name="marksCorrect"
              type="number"
              step="any"
              min="0.01"
              required
            />
          </label>
          <label className="field">
            <span>Marks for wrong</span>
            <input
              className="inp"
              name="marksWrong"
              type="number"
              step="any"
              max="0"
              required
            />
          </label>
          <label className="field">
            <span>Seat cap</span>
            <input
              className="inp"
              name="seatCap"
              type="number"
              min="1"
              max="120"
              required
            />
          </label>
          <button className="btn" disabled={busy}>
            Save and continue
          </button>
        </form>
      )}
      {step === "schedule" && builder && (
        <form
          className="card builderform"
          onSubmit={(event) => void schedule(event)}
        >
          <h2 className="h2">Schedule</h2>
          <label className="field">
            <span>Scheduled time</span>
            <input
              className="inp"
              name="scheduledAt"
              type="datetime-local"
              required
            />
          </label>
          <label className="field">
            <span>Admission window seconds</span>
            <input
              className="inp"
              name="joinWindowSec"
              type="number"
              min="1"
              required
            />
          </label>
          <div className="alert a-info">
            <span aria-hidden="true">i</span>
            <span>
              The participant duration is derived from the actual per-unit
              allowances plus the buffer time between units. Admission
              length is an independent API field.
            </span>
          </div>
          {builder.summary && (
            <div className="panel">
              Actual participant duration:{" "}
              <b className="num">
                {formatDuration(
                  (derivedWindowSeconds(
                    builder.summary.units,
                    builder.summary.slackSec ?? 0,
                  ) ??
                    builder.summary.windowSec ??
                    0) * 1000,
                )}
              </b>
              . This is the sum of each drawn unit allowance plus{" "}
              <b className="num">{builder.summary.slackSec ?? 0}s</b> of
              buffer time.
            </div>
          )}
          <button className="btn" disabled={busy}>
            Save schedule
          </button>
        </form>
      )}
      {step === "lock" && builder && (
        <section className="card lock-summary">
          <h2 className="h2">Lock this quiz?</h2>
          <p>
            Locking retires the drawn questions permanently and assigns the room
            identity. They are never returned to the pool, even if the quiz is
            later cancelled.
          </p>
          <button className="btn danger" onClick={() => setLockOpen(true)}>
            Review and lock
          </button>
        </section>
      )}
      <ConfirmDialog
        open={lockOpen}
        title={`Lock “${builder?.title ?? "quiz"}”?`}
        confirmLabel="Lock quiz"
        danger
        busy={busy}
        onClose={() => setLockOpen(false)}
        onConfirm={() => void lock()}
      >
        <p>
          Locking retires the drawn questions permanently. This cannot be
          undone.
        </p>
      </ConfirmDialog>
    </>
  );
}

function BuilderSteps({
  current,
  mode,
}: {
  current: string;
  mode: "auto" | "manual";
}) {
  const steps =
    mode === "manual"
      ? ["define", "pick", "draw", "scoring", "schedule", "lock"]
      : ["define", "draw", "scoring", "schedule", "lock"];
  return (
    <ol className="steps" aria-label="Quiz builder steps">
      {steps.map((step, index) => (
        <li className={step === current ? "on" : ""} key={step}>
          <span className="num">{index + 1}</span>
          {step}
        </li>
      ))}
    </ol>
  );
}

function QuizPickStep({
  type,
  selected,
  onToggleGroup,
  onSubmit,
  busy,
}: {
  type: QuizType;
  selected: QuestionFull[];
  onToggleGroup: (group: QuestionFull[]) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const resource = useResource(
    () => api.questions({ type, used: false, limit: 50, offset }),
    [type, offset],
  );
  const selectedIds = new Set(selected.map((question) => question.id));
  const tally = tallyByDifficulty(selected);
  const units = resource.data ? groupIntoPickUnits(resource.data.items) : [];
  const unitKindLabel = type === "verbal" ? "RC" : "LRDI";

  const toggleUnit = async (unit: PickUnit) => {
    if (unit.passageId === null) {
      onToggleGroup(unit.members);
      return;
    }
    // Re-fetch the full group by passageId rather than trusting the current page's members —
    // a group can straddle a page boundary, and this is what actually decides what gets locked.
    const group = await api.questions({ type, passageId: unit.passageId });
    onToggleGroup(
      [...group.items].sort(
        (a, b) => (a.groupPosition ?? 0) - (b.groupPosition ?? 0),
      ),
    );
  };

  return (
    <section className="card">
      <h2 className="h2">Select questions</h2>
      <p>
        <b className="num">{selected.length}</b> selected ·{" "}
        {(["easy", "medium", "hard"] as const)
          .map((difficulty) => `${tally[difficulty] ?? 0} ${difficulty}`)
          .join(" · ")}
      </p>
      {resource.loading ? (
        <LoadingCard />
      ) : resource.error || !resource.data ? (
        <ErrorState error={resource.error} retry={resource.reload} />
      ) : resource.data.total === 0 ? (
        <EmptyState title="No unused questions in this section">
          Import more questions to the bank first.
        </EmptyState>
      ) : (
        <>
          <div className="tablewrap">
            <table className="dt">
              <thead>
                <tr>
                  <th></th>
                  <th>Topic</th>
                  <th>Kind</th>
                  <th>Difficulty</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {units.map((unit) => {
                  const representative = unit.members[0]!;
                  const label =
                    representative.passage?.title ?? representative.topic;
                  const diffTally = tallyByDifficulty(unit.members);
                  const checked = unit.members.every((question) =>
                    selectedIds.has(question.id),
                  );
                  const expanded = expandedKey === unit.key;
                  return (
                    <Fragment key={unit.key}>
                      <tr>
                        <td>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => void toggleUnit(unit)}
                            aria-label={`Select ${label}`}
                          />
                        </td>
                        <td>{label}</td>
                        <td>
                          {unit.passageId === null
                            ? "Standalone"
                            : `${unitKindLabel} · ${unit.members.length}Q`}
                        </td>
                        <td>
                          {(["easy", "medium", "hard"] as const)
                            .filter((difficulty) => diffTally[difficulty])
                            .map((difficulty) => (
                              <span
                                key={difficulty}
                                className={`badge sq ${difficultyBadgeClass[difficulty]}`}
                              >
                                {difficulty[0].toUpperCase()}
                                {diffTally[difficulty]! > 1
                                  ? `×${diffTally[difficulty]}`
                                  : ""}
                              </span>
                            ))}
                        </td>
                        <td>
                          <button
                            className="btn sm ghost"
                            type="button"
                            aria-expanded={expanded}
                            aria-label={
                              expanded
                                ? `Hide preview of ${label}`
                                : `Preview ${label}`
                            }
                            onClick={() =>
                              setExpandedKey(expanded ? null : unit.key)
                            }
                          >
                            {expanded ? "▾" : "▸"}
                          </button>
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={5}>
                            <div className="panel stack">
                              {representative.passage && (
                                <div className="stack">
                                  <p className="tiny">
                                    <MathText
                                      text={representative.passage.bodyMd}
                                    />
                                  </p>
                                  {representative.passage.imageUrl && (
                                    <img
                                      className="qfig"
                                      src={representative.passage.imageUrl}
                                      alt="Passage illustration"
                                    />
                                  )}
                                </div>
                              )}
                              {unit.members.map((question) => (
                                <div className="stack" key={question.id}>
                                  <p>
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
                                    <ul className="tiny">
                                      {(["A", "B", "C", "D"] as const).map(
                                        (letter) => {
                                          const value = {
                                            A: question.optionA,
                                            B: question.optionB,
                                            C: question.optionC,
                                            D: question.optionD,
                                          }[letter];
                                          return (
                                            <li key={letter}>
                                              {letter}. {value}
                                              {question.correctOption ===
                                              letter
                                                ? " · correct"
                                                : ""}
                                            </li>
                                          );
                                        },
                                      )}
                                    </ul>
                                  ) : (
                                    <p className="tiny">
                                      Correct answer: {question.numericAnswer}{" "}
                                      ± {question.numericTolerance}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={resource.data} onOffset={setOffset} />
        </>
      )}
      <button
        className="btn"
        disabled={busy || selected.length === 0}
        onClick={onSubmit}
      >
        {busy ? "Creating…" : "Create quiz"}
      </button>
    </section>
  );
}

export function SchedulePage() {
  const [offset, setOffset] = useState(0);
  const [templates, setTemplates] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<QuizAdminSummary | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const resource = useResource(
    () => api.quizzes({ limit: 20, offset }),
    [offset],
  );
  const cancel = async () => {
    if (!cancelTarget) return;
    setBusy(true);
    setError(null);
    try {
      await api.cancelQuiz(cancelTarget.id);
      setCancelTarget(null);
      await resource.reload();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title="Schedule"
        subtitle="Every quiz from draft through cancelled or ended."
        back={{ to: "/admin", label: "Console home" }}
        actions={
          <Link className="btn" to="/admin/quizzes/new/define">
            New quiz
          </Link>
        }
      />
      <div className="seg schedule-tabs" role="tablist">
        <button
          className={!templates ? "on" : ""}
          role="tab"
          aria-selected={!templates}
          onClick={() => setTemplates(false)}
        >
          Quizzes
        </button>
        <button
          className={templates ? "on" : ""}
          role="tab"
          aria-selected={templates}
          onClick={() => setTemplates(true)}
        >
          Templates
        </button>
      </div>
      {templates ? (
        <TemplatesPanel />
      ) : (
        <>
          {error && <ErrorState error={error} />}
          {resource.loading ? (
            <LoadingCard />
          ) : resource.error || !resource.data ? (
            <ErrorState error={resource.error} retry={resource.reload} />
          ) : (
            <>
              <div className="schedgrid">
                {resource.data.items.map((quiz) => (
                  <article
                    className={`card card--solid schedcard schedcard--${quiz.status}`}
                    key={quiz.id}
                  >
                    <div className="schedcard__hdr">
                      <span
                        className={`badge b-${quiz.status === "ended" ? "closed" : quiz.status}`}
                      >
                        {quiz.status}
                      </span>
                      <span className="tiny num">
                        {formatDateTime(quiz.scheduledAt)}
                      </span>
                    </div>
                    <div>
                      <h2 className="schedcard__title">{quiz.title}</h2>
                      <div className="schedcard__facts">
                        {quizTypeLabels[quiz.type]} ·{" "}
                        {quiz.questionCount ?? "—"} questions ·{" "}
                        {quiz.windowSec === null
                          ? "duration pending"
                          : formatDuration(quiz.windowSec * 1000)}
                        {quiz.roomCode ? (
                          <>
                            {" "}
                            · room <b className="num">{quiz.roomCode}</b>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="schedcard__foot">
                      {quiz.status === "draft" && (
                        <Link
                          className="btn sec"
                          to="/admin/quizzes/new/define"
                        >
                          Continue building
                        </Link>
                      )}
                      {quiz.status === "ended" && (
                        <Link
                          className="btn sec"
                          to={`/admin/quizzes/${quiz.id}/report`}
                        >
                          Open report
                        </Link>
                      )}
                      {(
                        ["draft", "scheduled", "open"] as QuizStatus[]
                      ).includes(quiz.status) && (
                        <button
                          className="btn ghost"
                          type="button"
                          onClick={() => setCancelTarget(quiz)}
                        >
                          Cancel quiz
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              <Pagination page={resource.data} onOffset={setOffset} />
            </>
          )}
        </>
      )}
      <ConfirmDialog
        open={Boolean(cancelTarget)}
        title={`Cancel “${cancelTarget?.title ?? "quiz"}”?`}
        confirmLabel="Cancel quiz"
        danger
        busy={busy}
        onClose={() => setCancelTarget(null)}
        onConfirm={() => void cancel()}
      >
        <p>
          Students will be notified. Used questions stay retired and the quiz
          cannot be resumed.
        </p>
      </ConfirmDialog>
    </>
  );
}

export function ReportsIndexPage() {
  const resource = useResource(() => fetchAllQuizzes("ended"), []);
  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Completed quizzes only; no live or partial reporting."
        back={{ to: "/admin", label: "Console home" }}
      />
      {resource.loading ? (
        <LoadingCard />
      ) : resource.error || !resource.data ? (
        <ErrorState error={resource.error} retry={resource.reload} />
      ) : resource.data.length === 0 ? (
        <EmptyState title="No completed reports">
          Reports unlock after board publication.
        </EmptyState>
      ) : (
        <div className="schedgrid">
          {resource.data.map((quiz) => (
            <Link
              className="card panel--link schedcard"
              to={`/admin/quizzes/${quiz.id}/report`}
              key={quiz.id}
            >
              <SectionBadge type={quiz.type} />
              <h2 className="h3">{quiz.title}</h2>
              <span className="tiny">{formatDateTime(quiz.scheduledAt)}</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

async function fetchAllQuizzes(
  status?: QuizStatus,
): Promise<QuizAdminSummary[]> {
  const items: QuizAdminSummary[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await api.quizzes({
      limit: 100,
      offset,
      ...(status ? { status } : {}),
    });
    items.push(...page.items);
    if (items.length >= page.total || page.items.length === 0) return items;
  }
}

export function ReportPage() {
  const { quizId = "" } = useParams();
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState(false);
  const resource = useResource(
    () => api.adminReport(quizId, { limit: 50, offset }),
    [quizId, offset],
  );
  if (resource.loading) return <LoadingCard />;
  if (
    resource.error instanceof ApiRequestError &&
    resource.error.status === 423
  )
    return (
      <EmptyState title="Report is still locked">
        The backend publishes this report only with the complete result board.
      </EmptyState>
    );
  if (resource.error || !resource.data)
    return <ErrorState error={resource.error} retry={resource.reload} />;
  const report = resource.data;
  const exportCsv = async () => {
    setExporting(true);
    try {
      const rows: AdminReportParticipantRow[] = [];
      for (
        let exportOffset = 0;
        exportOffset < report.participants.total;
        exportOffset += 100
      ) {
        const page = await api.adminReport(quizId, {
          limit: 100,
          offset: exportOffset,
        });
        rows.push(...page.participants.items);
      }
      downloadParticipants(rows, `quiz-${report.quizId}-participants.csv`);
    } finally {
      setExporting(false);
    }
  };
  const totals = report.participants.items.reduce(
    (sum, participant) => ({
      score: sum.score + participant.totalScore,
      time: sum.time + participant.totalTimeMs,
    }),
    { score: 0, time: 0 },
  );
  const count = report.participants.items.length;
  return (
    <>
      <PageHeader
        title="Quiz report"
        subtitle={`Quiz ${report.quizId} · published aggregates only`}
        back={{ to: "/admin/reports", label: "Reports" }}
        actions={
          <button
            className="btn sec"
            disabled={exporting}
            onClick={() => void exportCsv()}
          >
            {exporting ? "Preparing export…" : "Export all participants"}
          </button>
        }
      />
      <section className="tiles" aria-labelledby="summary-heading">
        <h2 className="sr-only" id="summary-heading">
          Summary
        </h2>
        <div className="tile">
          <span className="eyebrow">Participants</span>
          <b className="hero num">{report.participants.total}</b>
        </div>
        <div className="tile">
          <span className="eyebrow">Average score on this page</span>
          <b className="hero num">
            {count ? (totals.score / count).toFixed(2) : "—"}
          </b>
        </div>
        <div className="tile">
          <span className="eyebrow">Average time on this page</span>
          <b className="hero num">
            {count ? formatDuration(totals.time / count) : "—"}
          </b>
        </div>
      </section>
      <section className="card">
        <div className="rowflex-between">
          <h2 className="h2">Participants</h2>
          <span className="tiny">Paginated server data</span>
        </div>
        <div className="tablewrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Seat</th>
                <th>Name</th>
                <th>Score</th>
                <th>Correct</th>
                <th>Wrong</th>
                <th>Skipped</th>
                <th>Unanswered</th>
                <th>Time</th>
                <th>Rank</th>
              </tr>
            </thead>
            <tbody>
              {report.participants.items.map((row) => (
                <tr key={row.userId}>
                  <td className="num">{row.seatNo}</td>
                  <td>{row.name}</td>
                  <td className="num">{row.totalScore}</td>
                  <td className="num">{row.correctCount}</td>
                  <td className="num">{row.wrongCount}</td>
                  <td className="num">{row.skippedCount}</td>
                  <td className="num">{row.unansweredCount}</td>
                  <td className="num">{formatDuration(row.totalTimeMs)}</td>
                  <td className="num">{row.rank ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={report.participants} onOffset={setOffset} />
      </section>
      <section className="card">
        <h2 className="h2">Per-question aggregates</h2>
        <div className="alert a-info">
          <span aria-hidden="true">TODO</span>
          <span>
            <b>TODO — product confirmation:</b> full item-analysis framing is
            deferred. This minimal table exposes only the aggregate fields
            already returned by the report DTO.
          </span>
        </div>
        <div className="tablewrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Question</th>
                <th>Unit</th>
                <th>Correct</th>
                <th>Wrong</th>
                <th>Skipped</th>
                <th>Unanswered</th>
              </tr>
            </thead>
            <tbody>
              {report.questions.map((question) => (
                <tr key={question.questionId}>
                  <td className="num">{question.position}</td>
                  <td className="num">
                    {question.unitPosition}.{question.subPosition}
                  </td>
                  <td className="num">{question.correctCount}</td>
                  <td className="num">{question.wrongCount}</td>
                  <td className="num">{question.skippedCount}</td>
                  <td className="num">{question.unansweredCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <h2 className="h2">Unit timing</h2>
        {report.units.map((unit) => (
          <div className="ledger__row" key={unit.unitPosition}>
            <span>
              Unit <b className="num">{unit.unitPosition}</b>
            </span>
            <span>
              <b className="num">{unit.completedCount}</b> completed ·{" "}
              <b className="num">{unit.timedOutCount}</b> timed out · average{" "}
              <b className="num">
                {unit.avgElapsedMs === null
                  ? "—"
                  : formatDuration(unit.avgElapsedMs)}
              </b>
            </span>
          </div>
        ))}
      </section>
    </>
  );
}

function downloadParticipants(
  rows: AdminReportParticipantRow[],
  filename: string,
) {
  const cell = (value: string | number | null) =>
    `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [
    [
      "userId",
      "name",
      "seatNo",
      "totalScore",
      "correctCount",
      "wrongCount",
      "skippedCount",
      "unansweredCount",
      "totalTimeMs",
      "rank",
    ],
    ...rows.map((row) => [
      row.userId,
      row.name,
      row.seatNo,
      row.totalScore,
      row.correctCount,
      row.wrongCount,
      row.skippedCount,
      row.unansweredCount,
      row.totalTimeMs,
      row.rank,
    ]),
  ]
    .map((line) => line.map(cell).join(","))
    .join("\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function UsersPage() {
  const { user } = useAuth();
  const resource = useResource(() => api.users(), []);
  const [target, setTarget] = useState<{
    id: string;
    name: string;
    role: Role;
  } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const change = async () => {
    if (!target) return;
    try {
      await api.setUserRole(target.id, { role: target.role });
      setTarget(null);
      await resource.reload();
    } catch (caught) {
      setError(caught);
    }
  };
  return (
    <>
      <PageHeader
        title="Manage admins"
        subtitle={
          user?.role === "superadmin"
            ? "You can promote and demote accounts."
            : "Only a superadmin can change roles."
        }
        back={{ to: "/admin", label: "Console home" }}
      />
      {error && <ErrorState error={error} />}
      {resource.loading ? (
        <LoadingCard />
      ) : resource.error || !resource.data ? (
        <ErrorState error={resource.error} retry={resource.reload} />
      ) : (
        <div className="rolegroup">
          {resource.data.users.map((member) => (
            <div className="card rowflex-between" key={member.id}>
              <div className="namerow min-zero">
                <div className="av sm" aria-hidden="true">
                  {member.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-zero">
                  <b className="truncate">{member.name}</b>
                  <div className="tiny truncate">
                    {member.email} · joined {formatDateTime(member.createdAt)}
                  </div>
                </div>
              </div>
              <div className="rowflex">
                <span className="badge b-draft">{member.role}</span>
                {member.role !== "superadmin" && (
                  <button
                    className="btn sm sec"
                    disabled={user?.role !== "superadmin"}
                    onClick={() =>
                      setTarget({
                        id: member.id,
                        name: member.name,
                        role: member.role === "admin" ? "student" : "admin",
                      })
                    }
                  >
                    {member.role === "admin" ? "Demote" : "Promote"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={Boolean(target)}
        title={`${target?.role === "admin" ? "Promote" : "Demote"} ${target?.name ?? "account"}?`}
        confirmLabel="Change role"
        danger={target?.role === "student"}
        onClose={() => setTarget(null)}
        onConfirm={() => void change()}
      >
        Access changes propagate through the backend role cache within about 60
        seconds.
      </ConfirmDialog>
    </>
  );
}

export function AdminForbiddenPage() {
  return (
    <EmptyState title="Not authorised">
      This account does not have access to the admin console.
      <Link className="btn" to="/">
        Return to Quizzer
      </Link>
    </EmptyState>
  );
}
