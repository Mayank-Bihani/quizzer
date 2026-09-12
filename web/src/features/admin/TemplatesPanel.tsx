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
import { mixTotal } from "./builder-state";
import {
  buildWeeklyRrule,
  parseWeeklyRrule,
  WEEKDAY_LABELS,
  WEEKDAY_ORDER,
  type WeekdayCode,
} from "./rrule-builder";

const unitKindLabels: Record<UnitKind, string> = {
  standalone: "Standalone unit seconds",
  rc: "RC unit seconds",
  lrdi: "LRDI unit seconds",
};

// A grouped verbal question belongs to an rc unit; grouped quant/lr questions to an lrdi unit —
// QUIZZING.md §4's section→group-kind mapping, mirrored from src/services/templates.ts since a
// template has no drawn units to read the kind off of.
function impliedGroupKind(type: QuizType): UnitKind {
  return type === "verbal" ? "rc" : "lrdi";
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
    const difficultyMix: Partial<Record<Difficulty, number>> = {
      easy: Number(form.get("easy")),
      medium: Number(form.get("medium")),
      hard: Number(form.get("hard")),
    };
    const questionCount = Number(form.get("questionCount"));
    if (mixTotal(difficultyMix) !== questionCount) {
      setValidationError(
        "Difficulty counts must add up to the question count.",
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

    onSubmit({
      name: String(form.get("name")).trim(),
      type,
      questionCount,
      difficultyMix,
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
        <span>Section</span>
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
      <label className="field">
        <span>Question count</span>
        <input
          className="inp"
          name="questionCount"
          type="number"
          min="1"
          max="100"
          defaultValue={initial?.questionCount}
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
            defaultValue={initial ? (initial.difficultyMix[difficulty] ?? 0) : undefined}
          />
        </label>
      ))}
      <label className="field">
        <span>{unitKindLabels.standalone}</span>
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
          {unitKindLabels[groupKind]} (optional — only needed if this section
          ever draws grouped questions)
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
        <span>Buffer time between units (seconds)</span>
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
        <span>Admission window seconds</span>
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
        <span>Marks for correct</span>
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
        <span>Marks for wrong</span>
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
        <legend>Days of the week</legend>
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
        <span>Minute</span>
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
  const resource = useResource(
    () => api.templates({ limit: 20, offset }),
    [offset],
  );

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
          Recurring templates are drawn and scheduled automatically every
          week.
        </p>
        {formTarget === "closed" && (
          <button
            className="btn"
            type="button"
            onClick={() => setFormTarget("create")}
          >
            New template
          </button>
        )}
      </div>
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
                      {template.questionCount} questions ·{" "}
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
