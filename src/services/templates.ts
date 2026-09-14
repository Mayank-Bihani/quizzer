// Recurring template CRUD: validate + persist quiz_templates rows that Sprint 7's unattended
// materializeTemplates already reads via getActiveTemplates — QUIZZING.md §4.4; API.md
// "QUIZZING — templates". Never edits quiz-materializer.ts, getActiveTemplates or TemplateRow.

import type { Difficulty, QuizType, TimingPolicy, UnitKind } from "../core/contracts"
import type { CreateTemplateRequest, TemplateSummary, UpdateTemplateRequest } from "../core/api"
import { MAX_GRADED_QUESTION_COUNT, MAX_SEAT_CAP } from "../core/config"
import { expandRrule } from "../core/schedule"
import {
  deactivateTemplateRow,
  getTemplateSummaryById,
  insertTemplateRow,
  listTemplatesPage,
  updateTemplateRow,
} from "../db/quizzes"

export type TemplateDeps = { db: D1Database; now: () => number }

const VALID_TYPES: readonly QuizType[] = ["verbal", "quant", "lr"]
const VALID_DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"]

// A grouped verbal question belongs to an rc unit; grouped quant/lr questions to an lrdi unit —
// QUIZZING.md §4's section→group-kind mapping. A template has no drawn units yet, so this is the
// implied pair every future draw for its type can produce.
function impliedGroupKind(type: QuizType): UnitKind {
  return type === "verbal" ? "rc" : "lrdi"
}

// setCount/standaloneCount are type-conditional (QUIZZING.md §4, revised 2026-09-12): quant sets
// standaloneCount only (its exact draw target, unchanged from the old questionCount semantics); lr
// sets setCount only (whole lrdi sets — a "count" for lr always means sets, never questions); verbal
// sets both (RC passages + standalone VA questions), each independently. difficultyMix scopes
// standaloneCount only — a set's members keep whatever difficulty they were authored with.
function isValidCoreFields(input: {
  name: string
  type: QuizType
  setCount: number | null
  standaloneCount: number | null
  difficultyMix: Partial<Record<Difficulty, number>>
  topics: string[]
}): boolean {
  if (input.name.trim().length === 0) return false
  if (!VALID_TYPES.includes(input.type)) return false

  const wantsSetCount = input.type === "lr" || input.type === "verbal"
  const wantsStandaloneCount = input.type === "quant" || input.type === "verbal"
  const wantsTopics = input.type === "quant"
  if (!wantsTopics && input.topics.length > 0) return false
  // lr is always fully grouped, so its setCount must be at least 1 (a quiz needs questions).
  // verbal's setCount/standaloneCount are independent asks — either may legitimately be 0 (all VA,
  // or all RC), but QUIZZING.md §4 requires at least one to be positive, checked below.
  const setCountMin = input.type === "lr" ? 1 : 0
  const standaloneCountMin = input.type === "quant" ? 1 : 0
  if (wantsSetCount) {
    if (!Number.isInteger(input.setCount) || (input.setCount as number) < setCountMin || (input.setCount as number) > MAX_GRADED_QUESTION_COUNT) {
      return false
    }
  } else if (input.setCount !== null) return false

  if (wantsStandaloneCount) {
    if (
      !Number.isInteger(input.standaloneCount) ||
      (input.standaloneCount as number) < standaloneCountMin ||
      (input.standaloneCount as number) > MAX_GRADED_QUESTION_COUNT
    ) {
      return false
    }
  } else if (input.standaloneCount !== null) return false

  if (input.type === "verbal" && input.setCount === 0 && input.standaloneCount === 0) return false

  let sum = 0
  for (const [key, value] of Object.entries(input.difficultyMix)) {
    if (!VALID_DIFFICULTIES.includes(key as Difficulty)) return false
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return false
    sum += value
  }
  // An omitted difficulty is filled from any difficulty at draw time (src/core/selection.ts's
  // `any` bucket) rather than excluded, so only an over-specified mix is rejected. A type with no
  // standalone portion (lr) has nothing for difficultyMix to scope, so it must be empty.
  if (!wantsStandaloneCount) return sum === 0
  return sum <= (input.standaloneCount as number)
}

function isValidScalarFields(input: {
  slackSec: number
  joinWindowSec: number
  marksCorrect: number
  marksWrong: number
  seatCap: number
}): boolean {
  if (!Number.isInteger(input.slackSec) || input.slackSec < 0) return false
  if (!Number.isInteger(input.joinWindowSec) || input.joinWindowSec <= 0) return false
  if (!Number.isFinite(input.marksCorrect) || input.marksCorrect <= 0) return false
  if (!Number.isFinite(input.marksWrong) || input.marksWrong > 0) return false
  if (!Number.isInteger(input.seatCap) || input.seatCap < 1 || input.seatCap > MAX_SEAT_CAP) return false
  return true
}

// Every future draw for `type` can produce a standalone unit or a group unit of its implied kind,
// so only those two keys are ever allowed. `standalone` must always be set — nearly every draw
// includes one — but the group kind may be left unset: if a future occurrence happens to draw a
// grouped unit anyway, quiz-materializer's computeUnitTimeLimits already reports that single
// occurrence as a "missing_timing_configuration" failure rather than crashing, so omitting it here
// is safe, not just tolerated.
function isValidTimingPolicyForType(timingPolicy: TimingPolicy, type: QuizType): boolean {
  const allowedKinds: UnitKind[] = ["standalone", impliedGroupKind(type)]
  const keys = Object.keys(timingPolicy) as UnitKind[]
  if (keys.some((k) => !allowedKinds.includes(k))) return false
  if (!keys.includes("standalone")) return false
  return keys.every((kind) => {
    const value = timingPolicy[kind]
    return value !== undefined && Number.isInteger(value) && value > 0
  })
}

// Reuses the existing rrule parser rather than re-implementing its grammar — a zero-width
// [now, now) window is sufficient to validate structure alone (core/schedule.ts's grammar check
// runs before any window-expansion loop).
function isValidRrule(rrule: string, now: number): boolean {
  return expandRrule(rrule, now, now).ok
}

export type CreateOutcome = { kind: "ok"; summary: TemplateSummary } | { kind: "invalid" }

export async function createTemplate(deps: TemplateDeps, adminId: string, input: CreateTemplateRequest): Promise<CreateOutcome> {
  if (!isValidCoreFields(input)) return { kind: "invalid" }
  if (!isValidScalarFields(input)) return { kind: "invalid" }
  if (!isValidTimingPolicyForType(input.timingPolicy, input.type)) return { kind: "invalid" }
  if (!isValidRrule(input.rrule, deps.now())) return { kind: "invalid" }

  const id = crypto.randomUUID()
  await insertTemplateRow(deps.db, { id, createdBy: adminId, ...input })
  const summary = await getTemplateSummaryById(deps.db, id)
  return { kind: "ok", summary: summary! }
}

export async function listTemplates(
  deps: Pick<TemplateDeps, "db">,
  limit: number,
  offset: number
): Promise<{ items: TemplateSummary[]; total: number }> {
  return listTemplatesPage(deps.db, limit, offset)
}

export type PatchOutcome = { kind: "ok"; summary: TemplateSummary } | { kind: "not_found" } | { kind: "invalid" }

export async function patchTemplate(deps: TemplateDeps, id: string, patch: UpdateTemplateRequest): Promise<PatchOutcome> {
  const current = await getTemplateSummaryById(deps.db, id)
  if (!current) return { kind: "not_found" }

  const touchesCoreFields =
    patch.name !== undefined ||
    patch.type !== undefined ||
    patch.setCount !== undefined ||
    patch.standaloneCount !== undefined ||
    patch.difficultyMix !== undefined ||
    patch.topics !== undefined
  if (touchesCoreFields) {
    const effective = {
      name: patch.name ?? current.name,
      type: patch.type ?? current.type,
      // `??` would wrongly fall back to `current` when the admin explicitly sends null to clear
      // the field that no longer applies after a type change (e.g. lr has no standaloneCount).
      setCount: patch.setCount !== undefined ? patch.setCount : current.setCount,
      standaloneCount: patch.standaloneCount !== undefined ? patch.standaloneCount : current.standaloneCount,
      difficultyMix: patch.difficultyMix ?? current.difficultyMix,
      topics: patch.topics ?? current.topics,
    }
    if (!isValidCoreFields(effective)) return { kind: "invalid" }
  }

  const touchesScalarFields =
    patch.slackSec !== undefined ||
    patch.joinWindowSec !== undefined ||
    patch.marksCorrect !== undefined ||
    patch.marksWrong !== undefined ||
    patch.seatCap !== undefined
  if (touchesScalarFields) {
    const effective = {
      slackSec: patch.slackSec ?? current.slackSec,
      joinWindowSec: patch.joinWindowSec ?? current.joinWindowSec,
      marksCorrect: patch.marksCorrect ?? current.marksCorrect,
      marksWrong: patch.marksWrong ?? current.marksWrong,
      seatCap: patch.seatCap ?? current.seatCap,
    }
    if (!isValidScalarFields(effective)) return { kind: "invalid" }
  }

  // A patch touching only `type` must still be rejected if the *stored* timingPolicy lacks the
  // new type's implied kind — otherwise a type edit alone could silently create a template
  // guaranteed to fail every future materialization. A patch touching neither field never
  // re-validates the already-stored, already-validated-at-write-time combination.
  if (patch.type !== undefined || patch.timingPolicy !== undefined) {
    const effectiveType = patch.type ?? current.type
    const effectiveTimingPolicy = patch.timingPolicy ?? current.timingPolicy
    if (!isValidTimingPolicyForType(effectiveTimingPolicy, effectiveType)) return { kind: "invalid" }
  }

  if (patch.rrule !== undefined && !isValidRrule(patch.rrule, deps.now())) return { kind: "invalid" }

  await updateTemplateRow(deps.db, id, patch)
  const summary = await getTemplateSummaryById(deps.db, id)
  return { kind: "ok", summary: summary! }
}

export type DeactivateOutcome = { kind: "ok"; summary: TemplateSummary } | { kind: "not_found" } | { kind: "conflict" }

export async function deactivateTemplate(deps: Pick<TemplateDeps, "db">, id: string): Promise<DeactivateOutcome> {
  const changed = await deactivateTemplateRow(deps.db, id)
  if (changed) {
    const summary = await getTemplateSummaryById(deps.db, id)
    return { kind: "ok", summary: summary! }
  }
  const existing = await getTemplateSummaryById(deps.db, id)
  return existing ? { kind: "conflict" } : { kind: "not_found" }
}
