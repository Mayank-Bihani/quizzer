// Cross-module lifecycle sequencing for QUIZZING creation: reserve -> claim/confirm -> publish,
// plus draft/reshuffle/settings/cancel orchestration over the pure selector, the QUIZZING
// repository, and the injected BankContract — QUIZZING.md §4.

import type { BankContract, Difficulty, QuizType, TimingPolicy } from "../core/contracts"
import type {
  CreateQuizDraftResponse,
  LockQuizResponse,
  QuizAdminSummary,
  ReshuffleQuizResponse,
  UpdateQuizParamsRequest,
} from "../core/api"
import { MAX_SEAT_CAP, ROOM_CODE_DIGIT_LENGTH, ROOM_CODE_MAX_COLLISION_RETRIES, ROOM_CODE_PREFIX_BY_TYPE } from "../core/config"
import { selectExactDraw } from "../core/selection"
import {
  applySettingsUpdate,
  cancelQuiz,
  getDraftForReshuffle,
  getLockSnapshot,
  getQuizAdminSummary,
  getQuizForPatch,
  insertDraft,
  publishSchedule,
  replaceMembership,
  reserveQuizNumber,
} from "../db/quizzes"

export type CreationDeps = {
  db: D1Database
  bank: BankContract
  now: () => number
  random: () => number
}

function computeWindowSec(unitLimits: (number | null)[], slackSec: number | null): number | null {
  if (slackSec === null) return null
  if (unitLimits.length === 0) return null
  if (unitLimits.some((v) => v === null)) return null
  return (unitLimits as number[]).reduce((sum, v) => sum + v, 0) + slackSec
}

function generateRoomCode(type: QuizType, random: () => number): string {
  let digits = ""
  for (let i = 0; i < ROOM_CODE_DIGIT_LENGTH; i++) digits += Math.floor(random() * 10)
  return `${ROOM_CODE_PREFIX_BY_TYPE[type]}-${digits}`
}

// ============================================================================
// Create
// ============================================================================

export type CreateInput = {
  title: string
  scheduledAt: number
  type: QuizType
  difficultyMix: Partial<Record<Difficulty, number>>
  count: number
}
export type CreateOutcome = { kind: "ok"; response: CreateQuizDraftResponse } | { kind: "pool_exhausted" }

export async function createDraft(deps: CreationDeps, adminId: string, input: CreateInput): Promise<CreateOutcome> {
  const candidates = await deps.bank.listUnused({ type: input.type, difficultyMix: input.difficultyMix, count: input.count })
  const draw = selectExactDraw(candidates, input.difficultyMix, input.count, deps.random)
  if (!draw.ok) return { kind: "pool_exhausted" }

  const id = crypto.randomUUID()
  await insertDraft(deps.db, {
    id,
    title: input.title,
    type: input.type,
    scheduledAt: input.scheduledAt,
    questionCount: input.count,
    difficultyMix: input.difficultyMix,
    createdBy: adminId,
    createdAt: deps.now(),
    units: draw.units,
    questionIds: draw.questions.map((q) => q.id),
  })

  return {
    kind: "ok",
    response: {
      quizId: id,
      status: "draft",
      questionCount: input.count,
      unitCount: draw.units.length,
      units: draw.units,
      questions: draw.questions,
    },
  }
}

// ============================================================================
// Reshuffle
// ============================================================================

export type ReshuffleOutcome =
  | { kind: "ok"; response: ReshuffleQuizResponse }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "pool_exhausted" }

export async function reshuffleDraft(deps: CreationDeps, id: string): Promise<ReshuffleOutcome> {
  const draft = await getDraftForReshuffle(deps.db, id)
  if (!draft) return { kind: "not_found" }
  if (draft.status !== "draft") return { kind: "conflict" }

  const candidates = await deps.bank.listUnused({ type: draft.type, difficultyMix: draft.difficultyMix, count: draft.questionCount })
  const draw = selectExactDraw(candidates, draft.difficultyMix, draft.questionCount, deps.random)
  if (!draw.ok) return { kind: "pool_exhausted" }

  // Reshuffle always discards prior overrides and reapplies the stored policy's defaults.
  const units = draw.units.map((u) => ({ ...u, timeLimitSec: draft.timingPolicy?.[u.kind] ?? null }))
  const windowSec = computeWindowSec(
    units.map((u) => u.timeLimitSec),
    draft.slackSec
  )
  await replaceMembership(deps.db, id, units, draw.questions.map((q) => q.id), windowSec)

  return { kind: "ok", response: { questions: draw.questions, units, unitCount: units.length, windowSec } }
}

// ============================================================================
// Patch settings
// ============================================================================

export type PatchOutcome =
  | { kind: "ok"; summary: QuizAdminSummary }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "invalid" }

export async function patchSettings(deps: CreationDeps, id: string, patch: UpdateQuizParamsRequest): Promise<PatchOutcome> {
  const current = await getQuizForPatch(deps.db, id)
  if (!current) return { kind: "not_found" }
  if (current.status !== "draft" && current.status !== "scheduled") return { kind: "conflict" }

  if (patch.title !== undefined && patch.title.trim().length === 0) return { kind: "invalid" }
  if (patch.scheduledAt !== undefined && !Number.isInteger(patch.scheduledAt)) return { kind: "invalid" }
  if (patch.joinWindowSec !== undefined && (!Number.isInteger(patch.joinWindowSec) || patch.joinWindowSec <= 0)) {
    return { kind: "invalid" }
  }
  if (patch.slackSec !== undefined && (!Number.isInteger(patch.slackSec) || patch.slackSec < 0)) return { kind: "invalid" }
  if (patch.marksCorrect !== undefined && (!Number.isFinite(patch.marksCorrect) || patch.marksCorrect <= 0)) {
    return { kind: "invalid" }
  }
  if (patch.marksWrong !== undefined && (!Number.isFinite(patch.marksWrong) || patch.marksWrong > 0)) return { kind: "invalid" }
  if (patch.seatCap !== undefined && (!Number.isInteger(patch.seatCap) || patch.seatCap < 1 || patch.seatCap > MAX_SEAT_CAP)) {
    return { kind: "invalid" }
  }

  const usedKinds = new Set(current.units.map((u) => u.kind))
  if (patch.timingPolicy !== undefined) {
    for (const kind of usedKinds) {
      const value = patch.timingPolicy[kind]
      if (value === undefined || !Number.isInteger(value) || value <= 0) return { kind: "invalid" }
    }
  }
  if (patch.unitTimeLimits !== undefined) {
    const seenPositions = new Set<number>()
    for (const override of patch.unitTimeLimits) {
      if (seenPositions.has(override.unitPosition)) return { kind: "invalid" }
      seenPositions.add(override.unitPosition)
      if (!current.units.some((u) => u.unitPosition === override.unitPosition)) return { kind: "invalid" }
      if (!Number.isInteger(override.timeLimitSec) || override.timeLimitSec <= 0) return { kind: "invalid" }
    }
  }

  // Effective per-unit time limit after this patch: policy reset first, then explicit overrides.
  const effectiveLimits = new Map(current.units.map((u) => [u.unitPosition, u.timeLimitSec]))
  const dbUnitWrites = new Map<number, number>()
  if (patch.timingPolicy !== undefined) {
    for (const u of current.units) {
      const value = patch.timingPolicy[u.kind] as number
      effectiveLimits.set(u.unitPosition, value)
      dbUnitWrites.set(u.unitPosition, value)
    }
  }
  if (patch.unitTimeLimits !== undefined) {
    for (const override of patch.unitTimeLimits) {
      effectiveLimits.set(override.unitPosition, override.timeLimitSec)
      dbUnitWrites.set(override.unitPosition, override.timeLimitSec)
    }
  }

  const newScheduledAt = patch.scheduledAt ?? current.scheduledAt
  const newJoinWindowSec = patch.joinWindowSec ?? current.joinWindowSec
  const newSlackSec = patch.slackSec ?? current.slackSec
  const windowSec = computeWindowSec([...effectiveLimits.values()], newSlackSec)

  await applySettingsUpdate(
    deps.db,
    id,
    {
      title: patch.title,
      scheduledAt: patch.scheduledAt !== undefined ? newScheduledAt : undefined,
      lobbyOpensAt: patch.scheduledAt !== undefined ? newScheduledAt - 300_000 : undefined,
      joinWindowSec: patch.joinWindowSec,
      endsAt:
        patch.scheduledAt !== undefined || patch.joinWindowSec !== undefined
          ? newJoinWindowSec !== null
            ? newScheduledAt + newJoinWindowSec * 1000
            : null
          : undefined,
      slackSec: patch.slackSec,
      marksCorrect: patch.marksCorrect,
      marksWrong: patch.marksWrong,
      seatCap: patch.seatCap,
      timingPolicy: patch.timingPolicy as TimingPolicy | undefined,
      windowSec,
    },
    [...dbUnitWrites.entries()].map(([unitPosition, timeLimitSec]) => ({ unitPosition, timeLimitSec }))
  )

  const summary = await getQuizAdminSummary(deps.db, id)
  return { kind: "ok", summary: summary! }
}

// ============================================================================
// Lock
// ============================================================================

export type LockOutcome =
  | { kind: "ok"; response: LockQuizResponse }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "invalid" }

function validateLockSnapshot(snapshot: Awaited<ReturnType<typeof getLockSnapshot>>): boolean {
  if (!snapshot) return false
  if (!snapshot.questionCount || !snapshot.unitCount || snapshot.units.length === 0) return false

  const unitPositions = snapshot.units.map((u) => u.unitPosition).sort((a, b) => a - b)
  for (let i = 0; i < unitPositions.length; i++) if (unitPositions[i] !== i + 1) return false

  for (const unit of snapshot.units) {
    if (unit.timeLimitSec === null || !Number.isInteger(unit.timeLimitSec) || unit.timeLimitSec <= 0) return false
    if (unit.kind === "standalone") {
      if (unit.questionPositions.length !== 1 || unit.passageId !== null) return false
    } else {
      if (unit.questionPositions.length < 4 || unit.questionPositions.length > 5) return false
      if (unit.passageId === null) return false
    }
  }

  const allFlat = snapshot.units.flatMap((u) => u.questionPositions).sort((a, b) => a - b)
  if (allFlat.length !== snapshot.questionCount) return false
  for (let i = 0; i < allFlat.length; i++) if (allFlat[i] !== i + 1) return false
  if (new Set(snapshot.questionIds).size !== snapshot.questionIds.length) return false

  if (snapshot.slackSec === null || !Number.isInteger(snapshot.slackSec) || snapshot.slackSec < 0) return false
  if (snapshot.joinWindowSec === null || !Number.isInteger(snapshot.joinWindowSec) || snapshot.joinWindowSec <= 0) {
    return false
  }
  if (snapshot.marksCorrect === null || !Number.isFinite(snapshot.marksCorrect) || snapshot.marksCorrect <= 0) return false
  if (snapshot.marksWrong === null || !Number.isFinite(snapshot.marksWrong) || snapshot.marksWrong > 0) return false
  if (snapshot.seatCap < 1 || snapshot.seatCap > MAX_SEAT_CAP) return false

  return true
}

export async function lockQuiz(deps: CreationDeps, id: string): Promise<LockOutcome> {
  const snapshot = await getLockSnapshot(deps.db, id)
  if (!snapshot) return { kind: "not_found" }
  if (snapshot.status !== "draft") return { kind: "conflict" }
  if (!validateLockSnapshot(snapshot)) return { kind: "invalid" }

  // Re-check group/section integrity against fresh BANK content before spending the claim.
  const fresh = await deps.bank.getByIds(snapshot.questionIds)
  if (fresh.length !== snapshot.questionIds.length) return { kind: "invalid" }
  const freshById = new Map(fresh.map((q) => [q.id, q]))
  for (const unit of snapshot.units) {
    if (unit.kind === "standalone") continue
    for (const position of unit.questionPositions) {
      const questionId = snapshot.questionIds[position - 1]
      const freshQuestion = questionId ? freshById.get(questionId) : undefined
      if (!freshQuestion || freshQuestion.passageId !== unit.passageId || freshQuestion.type !== snapshot.type) {
        return { kind: "invalid" }
      }
    }
  }

  const reserved = await reserveQuizNumber(deps.db, id)
  if (reserved === "not_draft") return { kind: "conflict" }
  const quizNumber = reserved

  const confirmed = new Set(await deps.bank.claimUnused(snapshot.questionIds, id, quizNumber))
  const allConfirmed = snapshot.questionIds.every((qid) => confirmed.has(qid))
  if (!allConfirmed) {
    return {
      kind: "ok",
      response: { locked: false, requestedCount: snapshot.questionIds.length, claimedCount: confirmed.size },
    }
  }

  for (let attempt = 0; attempt < ROOM_CODE_MAX_COLLISION_RETRIES; attempt++) {
    const roomCode = generateRoomCode(snapshot.type, deps.random)
    try {
      const published = await publishSchedule(deps.db, id, quizNumber, roomCode)
      if (published) return { kind: "ok", response: { locked: true, roomCode, quizNumber } }
    } catch {
      continue // room_code UNIQUE collision — try another code
    }
    const recheck = await getQuizAdminSummary(deps.db, id)
    if (recheck?.status === "scheduled" && recheck.roomCode && recheck.quizNumber) {
      return { kind: "ok", response: { locked: true, roomCode: recheck.roomCode, quizNumber: recheck.quizNumber } }
    }
    return { kind: "conflict" }
  }
  throw new Error("room code allocation exhausted retries")
}

// ============================================================================
// Cancel
// ============================================================================

export type CancelOutcome = { kind: "ok"; summary: QuizAdminSummary } | { kind: "not_found" } | { kind: "conflict" }

export async function cancel(deps: CreationDeps, id: string): Promise<CancelOutcome> {
  const result = await cancelQuiz(deps.db, id)
  if (!result.ok) return { kind: result.reason === "not_found" ? "not_found" : "conflict" }
  const summary = await getQuizAdminSummary(deps.db, id)
  return { kind: "ok", summary: summary! }
}
