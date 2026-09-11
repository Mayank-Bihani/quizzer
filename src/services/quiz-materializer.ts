// Unattended recurring-template materialization: expand each active template's rrule, draw and
// build each new occurrence exactly like admin lock, and reuse (never duplicate) Sprint 3's
// reserve/claim/publish primitive — SCHEDULER.md §4.2; QUIZZING.md §7.

import type { BankContract, MaterializationFailure, MaterializeResult, QuizUnitDefinition, UnitKind } from "../core/contracts"
import { expandRrule } from "../core/schedule"
import { selectExactDraw } from "../core/selection"
import { applySettingsUpdate, deleteUnpublishedDraft, getActiveTemplates, insertDraft, occurrenceExists, type TemplateRow } from "../db/quizzes"
import { reserveClaimAndPublish } from "./quiz-creation"

export type MaterializerDeps = { db: D1Database; bank: BankContract; random: () => number }

function computeUnitTimeLimits(units: QuizUnitDefinition[], timingPolicy: Partial<Record<UnitKind, number>>): { unitPosition: number; timeLimitSec: number }[] | null {
  const usedKinds = new Set(units.map((u) => u.kind))
  for (const kind of usedKinds) {
    const value = timingPolicy[kind]
    if (value === undefined || !Number.isInteger(value) || value <= 0) return null
  }
  return units.map((u) => ({ unitPosition: u.unitPosition, timeLimitSec: timingPolicy[u.kind] as number }))
}

async function materializeOccurrence(
  deps: MaterializerDeps,
  template: TemplateRow,
  scheduledAt: number,
  now: number
): Promise<{ quizId: string } | { failure: MaterializationFailure }> {
  const candidates = await deps.bank.listUnused({ type: template.type, difficultyMix: template.difficultyMix, count: template.questionCount })
  const draw = selectExactDraw(candidates, template.difficultyMix, template.questionCount, deps.random)
  if (!draw.ok) {
    return { failure: { templateId: template.id, scheduledAt, code: "pool_exhausted" } }
  }

  const unitTimeLimits = computeUnitTimeLimits(draw.units, template.timingPolicy)
  if (!unitTimeLimits) {
    return { failure: { templateId: template.id, scheduledAt, code: "missing_timing_configuration" } }
  }
  const windowSec = unitTimeLimits.reduce((sum, u) => sum + u.timeLimitSec, 0) + template.slackSec

  const quizId = crypto.randomUUID()
  await insertDraft(deps.db, {
    id: quizId,
    title: template.name,
    type: template.type,
    scheduledAt,
    questionCount: template.questionCount,
    difficultyMix: template.difficultyMix,
    createdBy: template.createdBy,
    createdAt: now,
    units: draw.units,
    questionIds: draw.questions.map((q) => q.id),
    templateId: template.id,
    seatCap: template.seatCap,
  })
  await applySettingsUpdate(
    deps.db,
    quizId,
    {
      joinWindowSec: template.joinWindowSec,
      endsAt: scheduledAt + template.joinWindowSec * 1000,
      slackSec: template.slackSec,
      marksCorrect: template.marksCorrect,
      marksWrong: template.marksWrong,
      timingPolicy: template.timingPolicy,
      windowSec,
    },
    unitTimeLimits
  )

  const outcome = await reserveClaimAndPublish(deps, quizId, template.type, draw.questions.map((q) => q.id))
  if (outcome.kind === "locked") return { quizId }

  // A short claim or reservation conflict here is an essentially-impossible single-admin-
  // deployment race (no other writer targets this brand-new draft id) — clean up defensively so
  // AC-6's "writes nothing" holds even in that case, and report it the same as any other
  // materialize failure rather than inventing a third failure code.
  await deleteUnpublishedDraft(deps.db, quizId)
  return { failure: { templateId: template.id, scheduledAt, code: "pool_exhausted" } }
}

export async function materializeTemplates(deps: MaterializerDeps, days: number, now: number): Promise<MaterializeResult> {
  const templates = await getActiveTemplates(deps.db)
  const quizIds: string[] = []
  const failures: MaterializationFailure[] = []

  for (const template of templates) {
    const expansion = expandRrule(template.rrule, now, now + days * 24 * 60 * 60 * 1000)
    if (!expansion.ok) continue // an invalid seeded rrule has no safe failure code to report — skip, never guess

    for (const scheduledAt of expansion.timestampsMs) {
      if (await occurrenceExists(deps.db, template.id, scheduledAt)) continue

      const result = await materializeOccurrence(deps, template, scheduledAt, now)
      if ("quizId" in result) quizIds.push(result.quizId)
      else failures.push(result.failure)
    }
  }

  return { quizIds, failures }
}
