// QUIZZING run use cases: list/join/current/submit/status plus openRoom and the scheduler
// discovery seams. Coordinates AUTH identity, one injected clock, the runtime repository,
// BankContract.getByIds, the redacted cache, and pure grading/scoring/validation — QUIZZING.md §5.

import type { BankContract, DueCloseQuiz, OpenResult, ServedUnit, UnitContent } from "../core/contracts"
import type {
  CurrentUnitResponse,
  JoinQuizResponse,
  ListOpenQuizzesResponse,
  PlayStatusResponse,
  QuizMeta,
  SubmitUnitResponse,
} from "../core/api"
import { UNIT_SUBMISSION_TRANSPORT_MS } from "../core/config"
import { gradeAnswer } from "../core/grading"
import { computeUnitDelta, marksForOutcome, type AnswerOutcome } from "../core/scoring"
import { canonicalizeSubmission, parseSubmitUnitRequest, type UnitManifestEntry } from "../core/unit-submission"
import {
  getActiveParticipantUnit,
  getParticipant,
  getParticipantUnit,
  getRuntimeQuizMeta,
  getRuntimeQuizMetaByRoomCode,
  getStatusCounts,
  listDuePrepare,
  listDueClose,
  listOpenQuizzes,
  type ParticipantUnitRow,
  type RuntimeQuizMeta,
} from "../db/play"
import { claimSeatOrResume, publishOpen, seedSeats, startParticipant } from "../db/play-seats"
import { closeUnitAtomic, settleExpiredUnit, type AnswerWrite } from "../db/play-units"
import { getCachedUnitContent, putCachedUnitContent } from "../services/cache"

export type RunDeps = {
  db: D1Database
  kv: KVNamespace
  bank: BankContract
  now: () => number
  hash: (bytes: string) => Promise<string>
}

// ============================================================================
// Redacted unit content — shared by openRoom warming and live serving
// ============================================================================

async function getUnitContent(deps: RunDeps, meta: RuntimeQuizMeta, unitPosition: number): Promise<UnitContent> {
  const cached = await getCachedUnitContent(deps.kv, meta.id, unitPosition)
  if (cached) return cached

  const unit = meta.units.find((u) => u.unitPosition === unitPosition)
  if (!unit) throw new Error("quiz-run invariant: unknown unit position")

  const questions = await deps.bank.getByIds(unit.questionIds)
  if (questions.length !== unit.questionIds.length) throw new Error("quiz-run invariant: BANK content missing for a locked unit")

  for (const [i, question] of questions.entries()) {
    if (question.id !== unit.questionIds[i]) throw new Error("quiz-run invariant: BANK content order mismatch")
    if (question.type !== meta.type) throw new Error("quiz-run invariant: BANK content section mismatch")
    if (unit.kind === "standalone" ? question.passageId !== null : question.passageId !== unit.passageId) {
      throw new Error("quiz-run invariant: BANK content group membership mismatch")
    }
  }

  const content: UnitContent = {
    unitPosition: unit.unitPosition,
    unitCount: meta.unitCount,
    questionCount: meta.questionCount,
    kind: unit.kind,
    timeLimitSec: unit.timeLimitSec,
    passage: questions[0]?.passage ?? null,
    questions: questions.map((q, i) => ({
      position: unit.questionPositions[i] as number,
      subPosition: i + 1,
      format: q.format,
      bodyMd: q.bodyMd,
      imageUrl: q.imageUrl,
      options: q.format === "mcq" ? [q.optionA ?? "", q.optionB ?? "", q.optionC ?? "", q.optionD ?? ""] : null,
    })),
  }
  await putCachedUnitContent(deps.kv, meta.id, unitPosition, content)
  return content
}

function buildServedUnit(content: UnitContent, active: ParticipantUnitRow): ServedUnit {
  return { ...content, startedAt: active.startedAt, deadlineAt: active.deadlineAt, submitByAt: active.submitByAt }
}

// ============================================================================
// openRoom — AC-4
// ============================================================================

export async function openRoom(deps: RunDeps, quizId: string): Promise<OpenResult> {
  const now = deps.now()
  const meta = await getRuntimeQuizMeta(deps.db, quizId)
  if (!meta) return { seatsSeeded: 0, alreadyOpen: false }
  if (meta.status === "open") return { seatsSeeded: 0, alreadyOpen: true }
  if (meta.status !== "scheduled" || meta.lobbyOpensAt > now) return { seatsSeeded: 0, alreadyOpen: false }

  await seedSeats(deps.db, quizId, meta.seatCap)
  for (const unit of meta.units) {
    await getUnitContent(deps, meta, unit.unitPosition) // validates + warms; throws on invariant failure
  }

  const published = await publishOpen(deps.db, quizId, now)
  if (published) return { seatsSeeded: meta.seatCap, alreadyOpen: false }
  return { seatsSeeded: 0, alreadyOpen: true }
}

// ============================================================================
// Server-only expiry settlement — shared by `current` and late `submit` — AC-9/AC-12
// ============================================================================

function unansweredCountForClosure(meta: RuntimeQuizMeta, unitPosition: number, finish: boolean): number {
  const unit = meta.units.find((u) => u.unitPosition === unitPosition)
  if (!unit) throw new Error("quiz-run invariant: unknown unit position")
  if (!finish) return unit.questionPositions.length
  const reachedUpToHere = meta.units
    .filter((u) => u.unitPosition <= unitPosition)
    .reduce((sum, u) => sum + u.questionPositions.length, 0)
  return unit.questionPositions.length + (meta.questionCount - reachedUpToHere)
}

function computeNextUnit(
  meta: RuntimeQuizMeta,
  closingUnitPosition: number,
  now: number,
  overallDeadline: number
): { unitPosition: number; startedAt: number; deadlineAt: number; submitByAt: number } | null {
  const nextDef = meta.units.find((u) => u.unitPosition === closingUnitPosition + 1)
  if (!nextDef || now >= overallDeadline) return null
  const deadlineAt = Math.min(now + nextDef.timeLimitSec * 1000, overallDeadline)
  return { unitPosition: nextDef.unitPosition, startedAt: now, deadlineAt, submitByAt: deadlineAt + UNIT_SUBMISSION_TRANSPORT_MS }
}

async function settleIfExpired(
  deps: RunDeps,
  meta: RuntimeQuizMeta,
  quizId: string,
  userId: string,
  active: ParticipantUnitRow,
  now: number
): Promise<void> {
  if (now <= active.submitByAt) return

  const participant = await getParticipant(deps.db, quizId, userId)
  if (!participant) throw new Error("quiz-run invariant: participant missing during expiry settlement")

  const overallDeadline = participant.startedAt + meta.windowSec * 1000
  const next = computeNextUnit(meta, active.unitPosition, now, overallDeadline)
  const finish = next === null
  const elapsedMs = active.deadlineAt - active.startedAt

  await settleExpiredUnit(deps.db, {
    quizId,
    userId,
    unitPosition: active.unitPosition,
    closedAt: now,
    elapsedMs,
    unansweredCount: unansweredCountForClosure(meta, active.unitPosition, finish),
    next,
    finish,
  })
  // Outcome ignored: a lost race just means a concurrent call already settled the same unit.
}

// ============================================================================
// Shared PlayState resolution — join and current both use this — AC-7
// ============================================================================

async function resolveCurrentState(
  deps: RunDeps,
  meta: RuntimeQuizMeta,
  quizId: string,
  userId: string,
  now: number
): Promise<JoinQuizResponse["state"]> {
  let participant = await getParticipant(deps.db, quizId, userId)
  if (!participant) throw new Error("quiz-run invariant: participant missing during state resolution")
  if (participant.finishedAt !== null) {
    return { status: "finished", serverNow: now, totalScore: participant.totalScore, answeredCount: participant.correctCount + participant.wrongCount }
  }

  let active = await getActiveParticipantUnit(deps.db, quizId, userId)
  if (active && now > active.submitByAt) {
    await settleIfExpired(deps, meta, quizId, userId, active, now)
    participant = await getParticipant(deps.db, quizId, userId)
    if (!participant) throw new Error("quiz-run invariant: participant missing after expiry settlement")
    if (participant.finishedAt !== null) {
      return { status: "finished", serverNow: now, totalScore: participant.totalScore, answeredCount: participant.correctCount + participant.wrongCount }
    }
    active = await getActiveParticipantUnit(deps.db, quizId, userId)
  }
  if (!active) throw new Error("quiz-run invariant: no active unit for an unfinished participant")

  const content = await getUnitContent(deps, meta, active.unitPosition)
  return { status: "active", serverNow: now, unit: buildServedUnit(content, active) }
}

function toQuizMeta(meta: RuntimeQuizMeta, participantStartedAt: number): QuizMeta {
  return {
    quizId: meta.id,
    quizNumber: meta.quizNumber,
    title: meta.title,
    type: meta.type,
    questionCount: meta.questionCount,
    unitCount: meta.unitCount,
    endsAt: meta.endsAt,
    windowSec: meta.windowSec,
    startedAt: participantStartedAt,
    deadlineAt: participantStartedAt + meta.windowSec * 1000,
  }
}

// ============================================================================
// List — AC-5
// ============================================================================

export async function listOpen(deps: RunDeps): Promise<ListOpenQuizzesResponse> {
  return { quizzes: await listOpenQuizzes(deps.db, deps.now()) }
}

// ============================================================================
// Join — AC-6
// ============================================================================

export type JoinOutcome =
  | { kind: "ok"; response: JoinQuizResponse }
  | { kind: "not_found" }
  | { kind: "full" }
  | { kind: "unavailable" }

export async function join(deps: RunDeps, roomCode: string, userId: string): Promise<JoinOutcome> {
  const now = deps.now()
  let meta = await getRuntimeQuizMetaByRoomCode(deps.db, roomCode)
  if (!meta) return { kind: "not_found" }
  if (meta.status === "cancelled") return { kind: "unavailable" }

  let participant = await getParticipant(deps.db, meta.id, userId)
  if (!participant) {
    if (meta.status === "scheduled" && meta.lobbyOpensAt <= now) {
      await openRoom(deps, meta.id)
      meta = (await getRuntimeQuizMetaByRoomCode(deps.db, roomCode)) ?? meta
    }
    if (meta.status !== "open" || now < meta.scheduledAt || now >= meta.endsAt) return { kind: "unavailable" }

    const seatResult = await claimSeatOrResume(deps.db, meta.id, userId, now, meta.seatCap)
    if ("full" in seatResult) return { kind: "full" }

    participant = await getParticipant(deps.db, meta.id, userId)
    if (!participant) {
      const unit1 = meta.units[0]
      if (!unit1) throw new Error("quiz-run invariant: quiz has no units")
      const overallDeadline = now + meta.windowSec * 1000
      const deadlineAt = Math.min(now + unit1.timeLimitSec * 1000, overallDeadline)
      await startParticipant(deps.db, meta.id, userId, seatResult.seatNo, now, unit1.unitPosition, deadlineAt, deadlineAt + UNIT_SUBMISSION_TRANSPORT_MS)
      participant = await getParticipant(deps.db, meta.id, userId)
    }
    if (!participant) throw new Error("quiz-run invariant: participant missing after startParticipant")
  }

  const state = await resolveCurrentState(deps, meta, meta.id, userId, now)
  return { kind: "ok", response: { meta: toQuizMeta(meta, participant.startedAt), state } }
}

// ============================================================================
// Current — AC-7
// ============================================================================

export type CurrentOutcome =
  | { kind: "ok"; response: CurrentUnitResponse }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "cancelled" }

export async function current(deps: RunDeps, quizId: string, userId: string): Promise<CurrentOutcome> {
  const now = deps.now()
  const meta = await getRuntimeQuizMeta(deps.db, quizId)
  if (!meta) return { kind: "not_found" }
  if (meta.status === "cancelled") return { kind: "cancelled" }
  const participant = await getParticipant(deps.db, quizId, userId)
  if (!participant) return { kind: "forbidden" }

  const state = await resolveCurrentState(deps, meta, quizId, userId, now)
  return { kind: "ok", response: { meta: toQuizMeta(meta, participant.startedAt), state } }
}

// ============================================================================
// Submit — AC-8/9/10/11/12
// ============================================================================

export type SubmitOutcome =
  | { kind: "ok"; response: SubmitUnitResponse }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "invalid" }
  | { kind: "conflict" }
  | { kind: "late" }

export async function submit(deps: RunDeps, quizId: string, userId: string, unitPosition: number, rawBody: unknown): Promise<SubmitOutcome> {
  const now = deps.now()
  const meta = await getRuntimeQuizMeta(deps.db, quizId)
  if (!meta) return { kind: "not_found" }

  const participant = await getParticipant(deps.db, quizId, userId)
  if (!participant) return { kind: "forbidden" }

  if (!Number.isInteger(unitPosition) || unitPosition < 1) return { kind: "invalid" }
  const unitDef = meta.units.find((u) => u.unitPosition === unitPosition)
  if (!unitDef) return { kind: "invalid" }

  // Receipt-first: a closed row for THIS unit answers identical-retry/conflict before any
  // lateness or "is this the current unit" check — AC-9.
  const targetUnit = await getParticipantUnit(deps.db, quizId, userId, unitPosition)
  if (!targetUnit) return { kind: "conflict" } // never reached (a future unit)

  const questions = await deps.bank.getByIds(unitDef.questionIds)
  if (questions.length !== unitDef.questionIds.length) throw new Error("quiz-run invariant: BANK content missing for a locked unit")
  const manifest: UnitManifestEntry[] = unitDef.questionPositions.map((position, i) => {
    const format = questions[i]?.format
    if (!format) throw new Error("quiz-run invariant: BANK content missing for a locked question")
    return { position, format }
  })

  const parsed = parseSubmitUnitRequest(rawBody, manifest)
  if (!parsed.ok) return { kind: "invalid" }
  const payloadHash = await deps.hash(canonicalizeSubmission(parsed.parsed))

  if (targetUnit.closedAt !== null) {
    if (targetUnit.submissionId === parsed.parsed.submissionId && targetUnit.payloadHash === payloadHash) {
      const state = await resolveCurrentState(deps, meta, quizId, userId, now)
      return { kind: "ok", response: { closedUnit: { unitPosition, reason: targetUnit.closeReason as "completed" | "timed_out" }, state } }
    }
    return { kind: "conflict" }
  }

  // closedAt === null on this exact row implies it is the sole active unit by schema invariant.
  const active = targetUnit
  if (parsed.parsed.reason === "timeout" && now < active.deadlineAt) return { kind: "invalid" }

  if (now > active.submitByAt) {
    await settleIfExpired(deps, meta, quizId, userId, active, now)
    return { kind: "late" }
  }

  const elapsedMs = Math.min(now, active.deadlineAt) - active.startedAt
  const outcomes: AnswerOutcome[] = []
  const answerWrites: AnswerWrite[] = []
  const marksConfig = { marksCorrect: meta.marksCorrect, marksWrong: meta.marksWrong }

  for (const answer of parsed.parsed.answers) {
    const idx = unitDef.questionPositions.indexOf(answer.position)
    const question = idx >= 0 ? questions[idx] : undefined
    if (!question) throw new Error("quiz-run invariant: answer position not found among locked questions")
    if (answer.status !== "answered") {
      outcomes.push(answer.status)
      answerWrites.push({ questionId: question.id, position: answer.position, status: answer.status, chosenOption: null, numericValue: null, isCorrect: null, marks: 0 })
      continue
    }
    const correct = gradeAnswer(
      question,
      answer.format === "mcq" ? { format: "mcq", chosenOption: answer.chosenOption } : { format: "tita", numericValue: answer.numericValue }
    )
    const outcome: AnswerOutcome = correct ? "correct" : "wrong"
    outcomes.push(outcome)
    answerWrites.push({
      questionId: question.id,
      position: answer.position,
      status: "answered",
      chosenOption: answer.format === "mcq" ? answer.chosenOption : null,
      numericValue: answer.format === "tita" ? answer.numericValue : null,
      isCorrect: correct,
      marks: marksForOutcome(outcome, marksConfig),
    })
  }

  const delta = computeUnitDelta(outcomes, marksConfig, elapsedMs)
  const overallDeadline = participant.startedAt + meta.windowSec * 1000
  const next = computeNextUnit(meta, unitPosition, now, overallDeadline)
  const finish = next === null
  if (finish) {
    const extraUnanswered = unansweredCountForClosure(meta, unitPosition, true) - unitDef.questionPositions.length
    if (extraUnanswered > 0) delta.unansweredDelta += extraUnanswered
  }

  const closeReason: "completed" | "timed_out" = parsed.parsed.reason === "complete" ? "completed" : "timed_out"
  const closeOutcome = await closeUnitAtomic(deps.db, {
    quizId,
    userId,
    unitPosition,
    closedAt: now,
    closeReason,
    elapsedMs,
    submissionId: parsed.parsed.submissionId,
    payloadHash,
    answers: answerWrites,
    aggregateDelta: delta,
    next,
    finish,
  })

  if (closeOutcome === "lost_race") {
    const raced = await getParticipantUnit(deps.db, quizId, userId, unitPosition)
    const state = await resolveCurrentState(deps, meta, quizId, userId, now)
    if (raced?.closedAt !== null && raced?.submissionId === parsed.parsed.submissionId && raced?.payloadHash === payloadHash) {
      return { kind: "ok", response: { closedUnit: { unitPosition, reason: raced.closeReason as "completed" | "timed_out" }, state } }
    }
    return { kind: "conflict" }
  }

  // The winning path already knows the exact resulting state in memory — build the response
  // directly instead of re-reading participant/participant_units through resolveCurrentState.
  // (`current`/`join` still use resolveCurrentState: they have no "just computed" context.)
  let state: SubmitUnitResponse["state"]
  if (next === null) {
    state = {
      status: "finished",
      serverNow: now,
      totalScore: participant.totalScore + delta.scoreDelta,
      answeredCount: participant.correctCount + delta.correctDelta + (participant.wrongCount + delta.wrongDelta),
    }
  } else {
    const content = await getUnitContent(deps, meta, next.unitPosition)
    state = { status: "active", serverNow: now, unit: buildServedUnit(content, { ...next, closedAt: null, closeReason: null, submissionId: null, payloadHash: null }) }
  }
  return { kind: "ok", response: { closedUnit: { unitPosition, reason: closeReason }, state } }
}

// ============================================================================
// Status — AC-14
// ============================================================================

export type StatusOutcome = { kind: "ok"; response: PlayStatusResponse } | { kind: "not_found" } | { kind: "forbidden" } | { kind: "active" }

export async function status(deps: RunDeps, quizId: string, userId: string): Promise<StatusOutcome> {
  const meta = await getRuntimeQuizMeta(deps.db, quizId)
  if (!meta) return { kind: "not_found" }
  const participant = await getParticipant(deps.db, quizId, userId)
  if (!participant) return { kind: "forbidden" }
  if (participant.finishedAt === null) return { kind: "active" }

  const counts = await getStatusCounts(deps.db, quizId)
  return {
    kind: "ok",
    response: {
      totalScore: participant.totalScore,
      answeredCount: participant.correctCount + participant.wrongCount,
      finishedCount: counts.finishedCount,
      participantCount: counts.participantCount,
      estimatedUnlockAt: meta.endsAt + meta.windowSec * 1000 + UNIT_SUBMISSION_TRANSPORT_MS,
    },
  }
}

// ============================================================================
// Scheduler discovery seams — AC-17
// ============================================================================

export async function listDuePrepareIds(deps: RunDeps, now: number, limit: number): Promise<string[]> {
  return listDuePrepare(deps.db, now, limit)
}

export async function listDueCloseQuizzes(deps: RunDeps, now: number, limit: number): Promise<DueCloseQuiz[]> {
  return listDueClose(deps.db, now, limit)
}
