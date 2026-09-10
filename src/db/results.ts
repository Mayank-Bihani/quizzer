// QUIZZING results: finalize expired runs via the runtime closure path, rank stored totals and publish board atomically, participant review with separate unit timings, history and report queries. No duplicate answer-write path — QUIZZING.md §6-7.

import type { CloseResult, LeaderboardRow, QuizStatus, QuizType, UnitCloseReason } from "../core/contracts"
import { assignDenseRanks, type RankableParticipant } from "../core/leaderboard"
import { getRuntimeQuizMeta, type RuntimeQuizMeta } from "./play"
import { settleExpiredUnit } from "./play-units"
import { unansweredCountForClosure } from "../services/quiz-run"

// ============================================================================
// Lifecycle / eligibility
// ============================================================================

export type QuizLifecycle = { status: QuizStatus; endsAt: number | null; windowSec: number | null; boardComputedAt: number | null }

export async function getQuizLifecycle(db: D1Database, quizId: string): Promise<QuizLifecycle | null> {
  const row = await db
    .prepare("SELECT status, ends_at, window_sec, board_computed_at FROM quizzes WHERE id = ?")
    .bind(quizId)
    .first<{ status: QuizStatus; ends_at: number | null; window_sec: number | null; board_computed_at: number | null }>()
  if (!row) return null
  return { status: row.status, endsAt: row.ends_at, windowSec: row.window_sec, boardComputedAt: row.board_computed_at }
}

export function safeCloseAtFor(lifecycle: Pick<QuizLifecycle, "endsAt" | "windowSec">): number | null {
  if (lifecycle.endsAt === null || lifecycle.windowSec === null) return null
  return lifecycle.endsAt + lifecycle.windowSec * 1000 + 5000
}

// ============================================================================
// Committed board reconstruction — used both by closeQuiz's own idempotent path and by readers
// ============================================================================

export type FullRankedBoard = { participantCount: number; boardComputedAt: number; ranked: (RankableParticipant & { rank: number })[] }

// The full board (every participant, not just top 10) — needed to locate the viewer's own row
// when they're outside the top 10, and to warm the board cache with something selectTopAndOwn
// can page through without a D1 round trip on every leaderboard read.
export async function getFullRankedBoard(db: D1Database, quizId: string, boardComputedAt: number): Promise<FullRankedBoard> {
  const { results } = await db
    .prepare(
      `SELECT p.user_id, u.name, p.total_score, p.total_time_ms, p.rank FROM participants p
       JOIN users u ON u.id = p.user_id
       WHERE p.quiz_id = ? AND p.rank IS NOT NULL
       ORDER BY p.rank ASC, p.user_id ASC`
    )
    .bind(quizId)
    .all<{ user_id: string; name: string; total_score: number; total_time_ms: number; rank: number }>()
  const ranked = results.map((r) => ({ userId: r.user_id, name: r.name, totalScore: r.total_score, totalTimeMs: r.total_time_ms, rank: r.rank }))
  return { participantCount: ranked.length, boardComputedAt, ranked }
}

async function readCommittedBoard(db: D1Database, quizId: string, boardComputedAt: number): Promise<CloseResult> {
  const countRow = await db.prepare("SELECT COUNT(*) AS n FROM participants WHERE quiz_id = ?").bind(quizId).first<{ n: number }>()
  const { results } = await db
    .prepare(
      `SELECT p.user_id, u.name, p.total_score, p.rank FROM participants p
       JOIN users u ON u.id = p.user_id
       WHERE p.quiz_id = ? AND p.rank IS NOT NULL
       ORDER BY p.rank ASC, p.user_id ASC LIMIT 10`
    )
    .bind(quizId)
    .all<{ user_id: string; name: string; total_score: number; rank: number }>()
  const top10: LeaderboardRow[] = results.map((r) => ({ rank: r.rank, userId: r.user_id, name: r.name, score: r.total_score }))
  return { participantCount: countRow?.n ?? 0, top10, boardComputedAt }
}

// ============================================================================
// closeQuiz transaction
// ============================================================================

type ParticipantSnapshotRow = {
  userId: string
  name: string
  totalScore: number
  totalTimeMs: number
  finished: boolean
  openUnit: { unitPosition: number; unitStartedAt: number; deadlineAt: number } | null
}

// One query, not two: reading "unfinished" and "already finished" as separate SELECTs leaves a
// window where a participant who transitions between them (settled by a concurrent racing close)
// would be captured by BOTH reads and double-counted in the in-memory ranking. A single LEFT JOIN
// snapshot can't straddle that window.
async function getParticipantsSnapshot(db: D1Database, quizId: string): Promise<ParticipantSnapshotRow[]> {
  const { results } = await db
    .prepare(
      `SELECT p.user_id, u.name, p.total_score, p.total_time_ms, p.finished_at,
              pu.unit_position, pu.started_at AS unit_started_at, pu.deadline_at
       FROM participants p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN participant_units pu ON pu.quiz_id = p.quiz_id AND pu.user_id = p.user_id AND pu.closed_at IS NULL
       WHERE p.quiz_id = ?`
    )
    .bind(quizId)
    .all<{
      user_id: string
      name: string
      total_score: number
      total_time_ms: number
      finished_at: number | null
      unit_position: number | null
      unit_started_at: number | null
      deadline_at: number | null
    }>()
  return results.map((r) => ({
    userId: r.user_id,
    name: r.name,
    totalScore: r.total_score,
    totalTimeMs: r.total_time_ms,
    finished: r.finished_at !== null,
    openUnit:
      r.unit_position !== null && r.unit_started_at !== null && r.deadline_at !== null
        ? { unitPosition: r.unit_position, unitStartedAt: r.unit_started_at, deadlineAt: r.deadline_at }
        : null,
  }))
}

export type CloseOutcome = { kind: "ok"; result: CloseResult } | { kind: "not_found" } | { kind: "not_eligible" }

// Strict `now > safeCloseAt`; reuses Sprint 4's settleExpiredUnit (idempotent/guarded) for every
// unfinished participant, then ranks and publishes as one final conditional UPDATE — the only
// statement any reader's gate (`board_computed_at`) actually depends on. total_score never
// changes during abandonment settlement (unanswered is always zero marks), so ranks are computed
// from data already read, with no intermediate re-read needed between settlement and ranking.
export async function closeQuizTransaction(db: D1Database, quizId: string, now: number): Promise<CloseOutcome> {
  const lifecycle = await getQuizLifecycle(db, quizId)
  if (!lifecycle) return { kind: "not_found" }
  if (lifecycle.boardComputedAt !== null) {
    return { kind: "ok", result: await readCommittedBoard(db, quizId, lifecycle.boardComputedAt) }
  }

  const safeCloseAt = safeCloseAtFor(lifecycle)
  if (lifecycle.status !== "open" || safeCloseAt === null || now <= safeCloseAt) {
    return { kind: "not_eligible" }
  }

  const meta = await getRuntimeQuizMeta(db, quizId)
  if (!meta) return { kind: "not_found" }

  const snapshot = await getParticipantsSnapshot(db, quizId)
  const unfinished = snapshot.filter((p): p is ParticipantSnapshotRow & { openUnit: NonNullable<ParticipantSnapshotRow["openUnit"]> } => !p.finished && p.openUnit !== null)
  for (const p of unfinished) {
    await settleExpiredUnit(db, {
      quizId,
      userId: p.userId,
      unitPosition: p.openUnit.unitPosition,
      closedAt: now,
      elapsedMs: p.openUnit.deadlineAt - p.openUnit.unitStartedAt,
      unansweredCount: unansweredCountForClosure(meta, p.openUnit.unitPosition, true),
      next: null,
      finish: true,
    })
  }

  const allTotals: RankableParticipant[] = snapshot.map((p) => ({
    userId: p.userId,
    name: p.name,
    totalScore: p.totalScore,
    totalTimeMs: p.finished || !p.openUnit ? p.totalTimeMs : p.totalTimeMs + (p.openUnit.deadlineAt - p.openUnit.unitStartedAt),
  }))
  const ranked = assignDenseRanks(allTotals)

  const statements = ranked.map((r) => db.prepare("UPDATE participants SET rank = ? WHERE quiz_id = ? AND user_id = ?").bind(r.rank, quizId, r.userId))
  statements.push(
    db
      .prepare(`UPDATE quizzes SET status = 'ended', ended_at = ?, board_computed_at = ? WHERE id = ? AND status = 'open' AND board_computed_at IS NULL`)
      .bind(now, now, quizId)
  )
  const batchResults = await db.batch(statements)
  const publishResult = batchResults.at(-1)
  if (!publishResult) throw new Error("closeQuizTransaction: batch returned no results")

  if (publishResult.meta.changes !== 1) {
    const afterRace = await getQuizLifecycle(db, quizId)
    if (afterRace?.boardComputedAt !== null && afterRace?.boardComputedAt !== undefined) {
      return { kind: "ok", result: await readCommittedBoard(db, quizId, afterRace.boardComputedAt) }
    }
    return { kind: "not_eligible" }
  }

  const top10: LeaderboardRow[] = ranked.slice(0, 10).map((r) => ({ rank: r.rank, userId: r.userId, name: r.name, score: r.totalScore }))
  return { kind: "ok", result: { participantCount: allTotals.length, top10, boardComputedAt: now } }
}

// ============================================================================
// Participant-only access gate
// ============================================================================

export async function isParticipant(db: D1Database, quizId: string, userId: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 FROM participants WHERE quiz_id = ? AND user_id = ?").bind(quizId, userId).first()
  return row !== null
}

export async function getParticipantCount(db: D1Database, quizId: string): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM participants WHERE quiz_id = ?").bind(quizId).first<{ n: number }>()
  return row?.n ?? 0
}

// ============================================================================
// Review projections — structural data only; BANK content is fetched by the service layer
// ============================================================================

export type QuizStructure = RuntimeQuizMeta

export async function getQuizStructure(db: D1Database, quizId: string): Promise<QuizStructure | null> {
  return getRuntimeQuizMeta(db, quizId)
}

export type ViewerAnswerRow = {
  position: number
  status: "answered" | "skipped" | "unanswered"
  chosenOption: "A" | "B" | "C" | "D" | null
  numericValue: number | null
  isCorrect: boolean | null
  marks: number
}

export async function getViewerAnswers(db: D1Database, quizId: string, userId: string): Promise<ViewerAnswerRow[]> {
  const { results } = await db
    .prepare("SELECT position, status, chosen_option, numeric_value, is_correct, marks FROM answers WHERE quiz_id = ? AND user_id = ?")
    .bind(quizId, userId)
    .all<{
      position: number
      status: "answered" | "skipped" | "unanswered"
      chosen_option: "A" | "B" | "C" | "D" | null
      numeric_value: number | null
      is_correct: number | null
      marks: number
    }>()
  return results.map((r) => ({
    position: r.position,
    status: r.status,
    chosenOption: r.chosen_option,
    numericValue: r.numeric_value,
    isCorrect: r.is_correct === null ? null : r.is_correct === 1,
    marks: r.marks,
  }))
}

export type ViewerUnitRow = { unitPosition: number; closeReason: UnitCloseReason | null; elapsedMs: number | null }

// Every unit this participant ever had a runtime row for, reached or not — the caller derives
// "not_reached" from a MISSING unitPosition, not from a null field on a present row.
export async function getViewerUnitTimings(db: D1Database, quizId: string, userId: string): Promise<ViewerUnitRow[]> {
  const { results } = await db
    .prepare("SELECT unit_position, close_reason, elapsed_ms FROM participant_units WHERE quiz_id = ? AND user_id = ?")
    .bind(quizId, userId)
    .all<{ unit_position: number; close_reason: UnitCloseReason | null; elapsed_ms: number | null }>()
  return results.map((r) => ({ unitPosition: r.unit_position, closeReason: r.close_reason, elapsedMs: r.elapsed_ms }))
}

export type RoomUnitAverage = { unitPosition: number; avgElapsedMs: number | null }

export async function getRoomUnitAverages(db: D1Database, quizId: string): Promise<RoomUnitAverage[]> {
  const { results } = await db
    .prepare(
      `SELECT unit_position, AVG(elapsed_ms) AS avg_ms FROM participant_units
       WHERE quiz_id = ? AND closed_at IS NOT NULL GROUP BY unit_position`
    )
    .bind(quizId)
    .all<{ unit_position: number; avg_ms: number | null }>()
  return results.map((r) => ({ unitPosition: r.unit_position, avgElapsedMs: r.avg_ms }))
}

export type McqTally = { position: number; counts: Record<"A" | "B" | "C" | "D", number> }

// The full participant roster crossed with answered MCQ choices — never a plain GROUP BY over
// existing answer rows alone, so a missing row still counts toward the denominator via the
// caller's own participantCount, satisfying AC-13's conservation equation.
export async function getMcqTallies(db: D1Database, quizId: string): Promise<McqTally[]> {
  const { results } = await db
    .prepare(
      `SELECT position, chosen_option, COUNT(*) AS n FROM answers
       WHERE quiz_id = ? AND status = 'answered' AND chosen_option IS NOT NULL
       GROUP BY position, chosen_option`
    )
    .bind(quizId)
    .all<{ position: number; chosen_option: "A" | "B" | "C" | "D"; n: number }>()

  const byPosition = new Map<number, Record<"A" | "B" | "C" | "D", number>>()
  for (const row of results) {
    const counts = byPosition.get(row.position) ?? { A: 0, B: 0, C: 0, D: 0 }
    counts[row.chosen_option] = row.n
    byPosition.set(row.position, counts)
  }
  return [...byPosition.entries()].map(([position, counts]) => ({ position, counts }))
}

// ============================================================================
// History
// ============================================================================

export type HistoryRow = {
  quizId: string
  quizNumber: number
  title: string
  type: QuizType
  scheduledAt: number
  finishedAt: number | null
  totalScore: number
  rank: number | null
  boardComputedAt: number | null
  participantCount: number
}

export async function getHistoryPage(db: D1Database, userId: string, limit: number, offset: number): Promise<{ items: HistoryRow[]; total: number }> {
  const totalRow = await db.prepare("SELECT COUNT(*) AS n FROM participants WHERE user_id = ?").bind(userId).first<{ n: number }>()
  const { results } = await db
    .prepare(
      `SELECT q.id AS quiz_id, q.quiz_number, q.title, q.type, q.scheduled_at, q.board_computed_at,
              p.finished_at, p.total_score, p.rank,
              (SELECT COUNT(*) FROM participants p2 WHERE p2.quiz_id = q.id) AS participant_count
       FROM participants p
       JOIN quizzes q ON q.id = p.quiz_id
       WHERE p.user_id = ?
       ORDER BY q.scheduled_at DESC, q.id DESC
       LIMIT ? OFFSET ?`
    )
    .bind(userId, limit, offset)
    .all<{
      quiz_id: string
      quiz_number: number
      title: string
      type: QuizType
      scheduled_at: number
      board_computed_at: number | null
      finished_at: number | null
      total_score: number
      rank: number | null
      participant_count: number
    }>()

  const items: HistoryRow[] = results.map((r) => ({
    quizId: r.quiz_id,
    quizNumber: r.quiz_number,
    title: r.title,
    type: r.type,
    scheduledAt: r.scheduled_at,
    finishedAt: r.finished_at,
    totalScore: r.total_score,
    rank: r.rank,
    boardComputedAt: r.board_computed_at,
    participantCount: r.participant_count,
  }))
  return { items, total: totalRow?.n ?? 0 }
}
