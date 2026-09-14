import { useState, type FormEvent } from "react";
import type {
  CreateTemplateRequest,
  TemplateSummary,
} from "../../../../src/core/api";
import type {
  Difficulty,
  QuizType,
  TimingPolicy,
  UnitKind,
} from "../../../../src/core/contracts";
import { api, ApiRequestError } from "../../api/client";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  EmptyState,
  ErrorState,
  LoadingCard,
  Pagination,
  useResource,
} from "../../components/ui";
import { quizTypeLabels } from "../../lib/format";
import { mixTotal, readMultiSelect } from "./builder-state";
import {
  buildWeeklyRrule,
  parseWeeklyRrule,
  WEEKDAY_LABELS,
  WEEKDAY_ORDER,
  type WeekdayCode,
} from "./rrule-builder";

const unitKindLabels: Record<UnitKind, string> = {
  standalone: "question",
  rc: "RC passage group",
  lrdi: "LRDI set",
};

// A grouped verbal question belongs to an rc unit; grouped quant/lr questions to an lrdi unit —
// QUIZZING.md §4's section→group-kind mapping, mirrored from src/services/templates.ts since a
// template has no drawn units to read the kind off of.
function impliedGroupKind(type: QuizType): UnitKind {
  return type === "verbal" ? "rc" : "lrdi";
}

// A template only ever stores the request (setCount/standaloneCount), never a drawn total — the
// actual question count per occurrence varies since sets are 4-5 questions each.
function describeDraw(template: TemplateSummary): string {
  if (template.type === "quant") {
    const base = `${template.standaloneCount} questions`;
    return template.topics.length > 0 ? `${base} (${template.topics.join(", ")})` : base;
  }
  if (template.type === "lr") return `${template.setCount} LRDI set${template.setCount === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (template.setCount) parts.push(`${template.setCount} RC passage${template.setCount === 1 ? "" : "s"}`);
  if (template.standaloneCount) parts.push(`${template.standaloneCount} VA question${template.standaloneCount === 1 ? "" : "s"}`);
  return parts.join(" + ") || "0 questions";
}

type TemplateFormProps = {
  initial?: TemplateSummary;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: CreateTemplateRequest) => void;
};

function TemplateForm({ initial, busy, onCancel, onSubmit }: TemplateFormProps) {
  const [type, setType] = useState<QuizType>(initial?.type ?? "quant");
  const initialSchedule = initial ? parseWeeklyRrule(initial.rrule) : null;
  const [days, setDays] = useState<Set<WeekdayCode>>(
    new Set(initialSchedule?.days ?? []),
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const groupKind = impliedGroupKind(type);
  // Fetched only when quant is selected — lr/verbal never show a topics picker (§4).
  const topicsResource = useResource(
    () => (type === "quant" ? api.topics("quant") : Promise.resolve({ topics: [] })),
    [type],
  );

  const toggleDay = (day: WeekdayCode) => {
    setDays((current) => {
      const next = new Set(current);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const difficultyMix: Partial<Record<Difficulty, number>> = {};
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      const raw = form.get(difficulty);
      // A blank field means "any difficulty" for that slice, not zero — only a difficulty the
      // admin actually typed a value for becomes an explicit constraint.
      if (raw !== null && String(raw).trim() !== "") {
        difficultyMix[difficulty] = Number(raw);
      }
    }

    // lr is always whole LRDI sets; verbal independently asks for RC passages (sets) and
    // standalone VA questions; quant is always a plain standalone count — QUIZZING.md §4.
    let setCount: number | null = null;
    let standaloneCount: number | null = null;
    if (type === "lr") {
      setCount = Number(form.get("setCount"));
    } else if (type === "verbal") {
      setCount = Number(form.get("setCount"));
      standaloneCount = Number(form.get("standaloneCount"));
      if (setCount === 0 && standaloneCount === 0) {
        setValidationError("Set at least one of RC passages or VA questions above 0.");
        return;
      }
    } else {
      standaloneCount = Number(form.get("standaloneCount"));
    }
    if (mixTotal(difficultyMix) > (standaloneCount ?? 0)) {
      setValidationError(
        type === "verbal"
          ? "Difficulty counts can't add up to more than the VA question count."
          : "Difficulty counts can't add up to more than the question count.",
      );
      return;
    }
    if (days.size === 0) {
      setValidationError("Select at least one day of the week.");
      return;
    }
    setValidationError(null);

    const groupValue = form.get(groupKind);
    const timingPolicy: TimingPolicy = {
      standalone: Number(form.get("standalone")),
      ...(groupValue !== null && groupValue !== ""
        ? { [groupKind]: Number(groupValue) }
        : {}),
    };
    const topics = type === "quant" ? readMultiSelect(form, "topics") : [];

    onSubmit({
      name: String(form.get("name")).trim(),
      type,
      setCount,
      standaloneCount,
      difficultyMix,
      topics,
      timingPolicy,
      slackSec: Number(form.get("slackSec")),
      joinWindowSec: Number(form.get("joinWindowSec")),
      marksCorrect: Number(form.get("marksCorrect")),
      marksWrong: Number(form.get("marksWrong")),
      seatCap: Number(form.get("seatCap")),
      rrule: buildWeeklyRrule(
        [...days],
        Number(form.get("hour")),
        Number(form.get("minute")),
      ),
    });
  };

  return (
    <form className="card builderform" onSubmit={submit}>
      <h2 className="h2">{initial ? "Edit template" : "New template"}</h2>
      {validationError && (
        <div className="alert a-dgr" role="alert">
          <span aria-hidden="true">!</span>
          <span>{validationError}</span>
        </div>
      )}
      <label className="field">
        <span>Name</span>
        <input className="inp" name="name" defaultValue={initial?.name} required />
      </label>
      <label className="field">
        <span>Section (quiz type)</span>
        <select
          className="inp"
          name="type"
          value={type}
          onChange={(event) => setType(event.target.value as QuizType)}
          required
        >
          <option value="verbal">Verbal</option>
          <option value="quant">Quant</option>
          <option value="lr">Logical Reasoning</option>
        </select>
      </label>
      {type === "lr" && (
        <label className="field">
          <span>Number of LRDI sets</span>
          <input
            className="inp"
            name="setCount"
            type="number"
            min="1"
            max="20"
            defaultValue={initial?.setCount ?? undefined}
            required
          />
        </label>
      )}
      {type === "verbal" && (
        <>
          <label className="field">
            <span>RC passages (sets)</span>
            <input
              className="inp"
              name="setCount"
              type="number"
              min="0"
              max="20"
              defaultValue={initial?.setCount ?? undefined}
              required
            />
          </label>
          <label className="field">
            <span>VA questions (standalone)</span>
            <input
              className="inp"
              name="standaloneCount"
              type="number"
              min="0"
              max="100"
              defaultValue={initial?.standaloneCount ?? undefined}
              required
            />
          </label>
        </>
      )}
      {type === "quant" && (
        <label className="field">
          <span>Question count</span>
          <input
            className="inp"
            name="standaloneCount"
            type="number"
            min="1"
            max="100"
            defaultValue={initial?.standaloneCount ?? undefined}
            required
          />
        </label>
      )}
      {type === "quant" && topicsResource.data && (
        <label className="field">
          <span>
            Topics (optional — leave nothing selected to draw from any topic)
          </span>
          <select
            className="inp"
            name="topics"
            multiple
            defaultValue={initial?.topics}
          >
            {topicsResource.data.topics.map((topic) => (
              <option key={topic} value={topic}>
                {topic}
              </option>
            ))}
          </select>
        </label>
      )}
      {type !== "lr" &&
        (["easy", "medium", "hard"] as const).map((difficulty) => (
          <label className="field" key={difficulty}>
            <span>
              {type === "verbal" ? "VA " : ""}
              {difficulty[0].toUpperCase() + difficulty.slice(1)} questions
              (optional — leave blank to draw from any difficulty)
            </span>
            <input
              className="inp"
              name={difficulty}
              type="number"
              min="0"
              defaultValue={initial?.difficultyMix[difficulty]}
            />
          </label>
        ))}
      <label className="field">
        <span>Time limit per question (seconds)</span>
        <input
          className="inp"
          name="standalone"
          type="number"
          min="1"
          defaultValue={initial?.timingPolicy.standalone}
          required
        />
      </label>
      <label className="field" key={groupKind}>
        <span>
          Time limit per {unitKindLabels[groupKind]} (seconds) (optional —
          only needed if this section ever draws grouped questions)
        </span>
        <input
          className="inp"
          name={groupKind}
          type="number"
          min="1"
          defaultValue={initial?.timingPolicy[groupKind]}
        />
      </label>
      <label className="field">
        <span>
          Buffer between questions/groups (seconds) — added on top of the time
          limits above
        </span>
        <input
          className="inp"
          name="slackSec"
          type="number"
          min="0"
          defaultValue={initial?.slackSec}
          required
        />
      </label>
      <label className="field">
        <span>
          Admission window (seconds) — how long after the start time students
          can still join
        </span>
        <input
          className="inp"
          name="joinWindowSec"
          type="number"
          min="1"
          defaultValue={initial?.joinWindowSec}
          required
        />
      </label>
      <label className="field">
        <span>Marks for correct answer</span>
        <input
          className="inp"
          name="marksCorrect"
          type="number"
          step="any"
          min="0.01"
          defaultValue={initial?.marksCorrect}
          required
        />
      </label>
      <label className="field">
        <span>Marks for wrong answer (must be zero or negative)</span>
        <input
          className="inp"
          name="marksWrong"
          type="number"
          step="any"
          max="0"
          defaultValue={initial?.marksWrong}
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
          defaultValue={initial?.seatCap}
          required
        />
      </label>
      <fieldset className="field">
        <legend>
          Repeats weekly on these days (not a one-time date — pick the
          weekday(s) + time this quiz should run every week)
        </legend>
        <div className="rowflex">
          {WEEKDAY_ORDER.map((day) => (
            <label className="chk" key={day}>
              <input
                type="checkbox"
                checked={days.has(day)}
                onChange={() => toggleDay(day)}
              />{" "}
              {WEEKDAY_LABELS[day]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="field">
        <span>Hour (IST)</span>
        <input
          className="inp"
          name="hour"
          type="number"
          min="0"
          max="23"
          defaultValue={initialSchedule?.hour}
          required
        />
      </label>
      <label className="field">
        <span>Minute (IST)</span>
        <input
          className="inp"
          name="minute"
          type="number"
          min="0"
          max="59"
          defaultValue={initialSchedule?.minute}
          required
        />
      </label>
      <div className="rowflex">
        <button className="btn" disabled={busy}>
          {initial ? "Save changes" : "Create template"}
        </button>
        <button
          className="btn sec"
          type="button"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function TemplatesPanel() {
  const [offset, setOffset] = useState(0);
  const [formTarget, setFormTarget] = useState<
    "closed" | "create" | TemplateSummary
  >("closed");
  const [deactivateTarget, setDeactivateTarget] =
    useState<TemplateSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [materializing, setMaterializing] = useState(false);
  const [materializeResult, setMaterializeResult] = useState<string | null>(
    null,
  );
  const resource = useResource(
    () => api.templates({ limit: 20, offset }),
    [offset],
  );

  const materializeNow = async () => {
    setMaterializing(true);
    setMaterializeResult(null);
    setError(null);
    try {
      const result = await api.materializeTemplatesNow();
      setMaterializeResult(
        result.created === 0 && result.failed === 0
          ? "Checked all active templates — no quiz was due yet."
          : `Created ${result.created} quiz${result.created === 1 ? "" : "zes"}${result.failed > 0 ? `, ${result.failed} failed (check the question bank has enough unused questions)` : ""}.`,
      );
      await resource.reload();
    } catch (caught) {
      setError(caught);
    } finally {
      setMaterializing(false);
    }
  };

  const submitForm = async (body: CreateTemplateRequest) => {
    setBusy(true);
    setError(null);
    try {
      if (formTarget === "create") {
        await api.createTemplate(body);
      } else if (formTarget !== "closed") {
        await api.updateTemplate(formTarget.id, body);
      }
      setFormTarget("closed");
      await resource.reload();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    if (!deactivateTarget) return;
    setBusy(true);
    setError(null);
    try {
      await api.deactivateTemplate(deactivateTarget.id);
      setDeactivateTarget(null);
      await resource.reload();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error && (
        <div className="alert a-dgr" role="alert">
          <span aria-hidden="true">!</span>
          <span>
            {error instanceof ApiRequestError
              ? error.message
              : "Request failed."}
          </span>
        </div>
      )}
      <div className="rowflex-between">
        <p className="tiny">
          Active templates are checked every hour and turned into real
          quizzes up to 7 days ahead. Use "Check now" below to run that check
          immediately instead of waiting for the next hourly check.
        </p>
        {formTarget === "closed" && (
          <div className="rowflex">
            <button
              className="btn sec"
              type="button"
              disabled={materializing}
              onClick={() => void materializeNow()}
            >
              {materializing ? "Checking…" : "Check now"}
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => setFormTarget("create")}
            >
              New template
            </button>
          </div>
        )}
      </div>
      {materializeResult && (
        <div className="alert a-info" role="status">
          <span>{materializeResult}</span>
        </div>
      )}
      {formTarget !== "closed" && (
        <TemplateForm
          key={formTarget === "create" ? "create" : formTarget.id}
          initial={formTarget === "create" ? undefined : formTarget}
          busy={busy}
          onCancel={() => setFormTarget("closed")}
          onSubmit={(body) => void submitForm(body)}
        />
      )}
      {resource.loading ? (
        <LoadingCard />
      ) : resource.error || !resource.data ? (
        <ErrorState error={resource.error} retry={resource.reload} />
      ) : resource.data.items.length === 0 ? (
        <EmptyState title="No recurring templates yet">
          Create one to have quizzes drawn and scheduled automatically every
          week.
        </EmptyState>
      ) : (
        <>
          <div className="schedgrid">
            {resource.data.items.map((template) => {
              const schedule = parseWeeklyRrule(template.rrule);
              return (
                <article
                  className={`card card--solid schedcard schedcard--${template.active ? "open" : "closed"}`}
                  key={template.id}
                >
                  <div className="schedcard__hdr">
                    <span
                      className={`badge b-${template.active ? "open" : "closed"}`}
                    >
                      {template.active ? "active" : "inactive"}
                    </span>
                    <span className="tiny num">
                      {quizTypeLabels[template.type]}
                    </span>
                  </div>
                  <div>
                    <h2 className="schedcard__title">{template.name}</h2>
                    <div className="schedcard__facts">
                      {describeDraw(template)} ·{" "}
                      {schedule
                        ? `${schedule.days.map((day) => WEEKDAY_LABELS[day]).join(", ")} at ${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")} IST`
                        : template.rrule}{" "}
                      · seat cap {template.seatCap}
                    </div>
                  </div>
                  <div className="schedcard__foot">
                    <button
                      className="btn sec"
                      type="button"
                      onClick={() => setFormTarget(template)}
                    >
                      Edit
                    </button>
                    {template.active && (
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() => setDeactivateTarget(template)}
                      >
                        Deactivate
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          <Pagination page={resource.data} onOffset={setOffset} />
        </>
      )}
      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        title={`Deactivate “${deactivateTarget?.name ?? "template"}”?`}
        confirmLabel="Deactivate"
        danger
        busy={busy}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={() => void deactivate()}
      >
        <p>
          Future weekly draws stop. Quizzes already scheduled from this
          template are unaffected.
        </p>
      </ConfirmDialog>
    </>
  );
}
