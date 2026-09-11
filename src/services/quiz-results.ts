// closeQuiz as the scheduler contract adapter, lazy participant-triggered close, and explicit
// leaderboard/review/history DTO assembly. Participation and D1 publication gate every BANK
// content fetch — QUIZZING.md §6-7; CONTRACTS.md §5.

import type { BankContract, CloseResult } from "../core/contracts"
import type {
  AdminReportResponse,
  HistoryEntry,
  HistoryResponse,
  LeaderboardResponse,
  McqDistribution,
  QuestionReviewRow,
  ReviewResponse,
  UnitReviewTiming,
} from "../core/api"
import { selectTopAndOwn } from "../core/leaderboard"
import {
  closeQuizTransaction,
  getAdminReportParticipantsPage,
  getAdminReportQuestions,
  getAdminReportUnits,
  getFullRankedBoard,
  getHistoryPage,
  getMcqTallies,
  getParticipantCount,
  getQuizLifecycle,
  getQuizStructure,
  getRoomUnitAverages,
  getViewerAnswers,
  getViewerUnitTimings,
  isParticipant,
  safeCloseAtFor,
  type CloseOutcome,
  type QuizLifecycle,
} from "../db/results"
import { getCachedBoard, putCachedBoard } from "./cache"

// Locally typed only — this file must never import anything Telegram-shaped (AC-13). The real
// body (calling claimAndSend) is composed in src/services/scheduler.ts/src/index.ts.
export type OnQuizClosed = (quizId: string, result: CloseResult) => Promise<void>

export type ResultsDeps = { db: D1Database; kv: KVNamespace; bank: BankContract; now: () => number; onQuizClosed?: OnQuizClosed }

async function attemptClose(db: D1Database, kv: KVNamespace, quizId: string, now: number, onQuizClosed?: OnQuizClosed): Promise<CloseOutcome> {
  const outcome = await closeQuizTransaction(db, quizId, now)
  if (outcome.kind === "ok") {
    const board = await getFullRankedBoard(db, quizId, outcome.result.boardComputedAt)
    await putCachedBoard(kv, quizId, board) // best-effort; never blocks or reverses the D1 commit

    // Fire strictly after the D1 commit, only on a genuinely fresh close (never a reconstructed
    // re-read), and never let a callback failure escape into the close path (TG-7).
    if (outcome.fresh && onQuizClosed) {
      try {
        await onQuizClosed(quizId, outcome.result)
      } catch {
        // swallowed deliberately — a failed/slow Telegram post must never affect quiz correctness
      }
    }
  }
  return outcome
}

// The exact QuizzingSchedulerContract.closeQuiz(quizId, now) adapter. The scheduler only ever
// calls this for IDs its own listDueClose already found eligible, so a non-'ok' outcome here is a
// race/invariant surprise — thrown and caught per-candidate by the scheduler's pass isolation.
export function createCloseQuiz(db: D1Database, kv: KVNamespace, onQuizClosed?: OnQuizClosed): (quizId: string, now: number) => Promise<CloseResult> {
  return async (quizId, now) => {
    const outcome = await attemptClose(db, kv, quizId, now, onQuizClosed)
    if (outcome.kind !== "ok") throw new Error(`closeQuiz: quiz ${outcome.kind}`)
    return outcome.result
  }
}

async function ensurePublished(deps: ResultsDeps, quizId: string, lifecycle: QuizLifecycle, now: number): Promise<QuizLifecycle> {
  if (lifecycle.boardComputedAt !== null) return lifecycle
  const safeCloseAt = safeCloseAtFor(lifecycle)
  if (lifecycle.status === "open" && safeCloseAt !== null && now > safeCloseAt) {
    await attemptClose(deps.db, deps.kv, quizId, now, deps.onQuizClosed)
    const refreshed = await getQuizLifecycle(deps.db, quizId)
    if (refreshed) return refreshed
  }
  return lifecycle
}

// ============================================================================
// Leaderboard — AC-9/10
// ============================================================================

export type LeaderboardOutcome = { kind: "ok"; response: LeaderboardResponse } | { kind: "not_found" } | { kind: "forbidden" } | { kind: "locked" }

export async function getLeaderboard(deps: ResultsDeps, quizId: string, userId: string): Promise<LeaderboardOutcome> {
  const now = deps.now()
  const initial = await getQuizLifecycle(deps.db, quizId)
  if (!initial) return { kind: "not_found" }
  if (!(await isParticipant(deps.db, quizId, userId))) return { kind: "forbidden" }

  const lifecycle = await ensurePublished(deps, quizId, initial, now)
  if (lifecycle.boardComputedAt === null) return { kind: "locked" }

  let board = await getCachedBoard(deps.kv, quizId)
  if (!board || board.boardComputedAt !== lifecycle.boardComputedAt) {
    board = await getFullRankedBoard(deps.db, quizId, lifecycle.boardComputedAt)
  }

  const { rows, truncated } = selectTopAndOwn(board.ranked, userId)
  return { kind: "ok", response: { participantCount: board.participantCount, boardComputedAt: board.boardComputedAt, truncated, rows } }
}

// ============================================================================
// Review — AC-9/11/12/13/14
// ============================================================================

export type ReviewOutcome = { kind: "ok"; response: ReviewResponse } | { kind: "not_found" } | { kind: "forbidden" } | { kind: "locked" }

export async function getReview(deps: ResultsDeps, quizId: string, userId: string): Promise<ReviewOutcome> {
  const now = deps.now()
  const initial = await getQuizLifecycle(deps.db, quizId)
  if (!initial) return { kind: "not_found" }
  if (!(await isParticipant(deps.db, quizId, userId))) return { kind: "forbidden" }

  const lifecycle = await ensurePublished(deps, quizId, initial, now)
  if (lifecycle.boardComputedAt === null) return { kind: "locked" }

  const structure = await getQuizStructure(deps.db, quizId)
  if (!structure) return { kind: "not_found" }

  const [viewerAnswers, viewerUnits, roomAverages, mcqTallies, participantCount] = await Promise.all([
    getViewerAnswers(deps.db, quizId, userId),
    getViewerUnitTimings(deps.db, quizId, userId),
    getRoomUnitAverages(deps.db, quizId),
    getMcqTallies(deps.db, quizId),
    getParticipantCount(deps.db, quizId),
  ])

  const allQuestionIds = structure.units.flatMap((u) => u.questionIds)
  const questions = await deps.bank.getByIds(allQuestionIds)
  const questionById = new Map(questions.map((q) => [q.id, q]))
  const answerByPosition = new Map(viewerAnswers.map((a) => [a.position, a]))
  const reachedUnitPositions = new Set(viewerUnits.map((u) => u.unitPosition))
  const mcqByPosition = new Map(mcqTallies.map((t) => [t.position, t.counts]))

  const rows: QuestionReviewRow[] = []
  for (const unit of structure.units) {
    for (let i = 0; i < unit.questionPositions.length; i++) {
      const position = unit.questionPositions[i]
      const questionId = unit.questionIds[i]
      if (position === undefined || questionId === undefined) throw new Error("quiz-results invariant: malformed unit membership")
      const question = questionById.get(questionId)
      if (!question) throw new Error("quiz-results invariant: BANK content missing for a published quiz")

      const answer = answerByPosition.get(position)
      let outcome: QuestionReviewRow["outcome"]
      let yourAnswer: QuestionReviewRow["yourAnswer"] = null
      if (answer) {
        yourAnswer = { chosenOption: answer.chosenOption, numericValue: answer.numericValue, isCorrect: answer.isCorrect, marks: answer.marks }
        outcome = answer.status === "answered" ? (answer.isCorrect ? "correct" : "wrong") : answer.status
      } else {
        outcome = reachedUnitPositions.has(unit.unitPosition) ? "unanswered" : "not_reached"
      }

      const counts = mcqByPosition.get(position)
      const distribution: McqDistribution | null =
        question.format === "mcq"
          ? {
              participantCount,
              optionCounts: counts ?? { A: 0, B: 0, C: 0, D: 0 },
              notAnsweredCount: participantCount - ((counts?.A ?? 0) + (counts?.B ?? 0) + (counts?.C ?? 0) + (counts?.D ?? 0)),
            }
          : null

      rows.push({
        position,
        unitPosition: unit.unitPosition,
        subPosition: i + 1,
        outcome,
        question: {
          bodyMd: question.bodyMd,
          imageUrl: question.imageUrl,
          format: question.format,
          optionA: question.optionA,
          optionB: question.optionB,
          optionC: question.optionC,
          optionD: question.optionD,
          correctOption: question.correctOption,
          numericAnswer: question.numericAnswer,
          numericTolerance: question.numericTolerance,
          explanationMd: question.explanationMd,
          passage: question.passage,
        },
        yourAnswer,
        distribution,
      })
    }
  }

  const units: UnitReviewTiming[] = structure.units.map((u) => {
    const viewerUnit = viewerUnits.find((vu) => vu.unitPosition === u.unitPosition)
    const roomAverage = roomAverages.find((a) => a.unitPosition === u.unitPosition)
    return {
      unitPosition: u.unitPosition,
      closeReason: viewerUnit?.closeReason ?? null,
      elapsedMs: viewerUnit?.elapsedMs ?? null,
      roomAvgElapsedMs: roomAverage?.avgElapsedMs ?? null,
    }
  })

  return { kind: "ok", response: { rows, units } }
}

// ============================================================================
// History — AC-15
// ============================================================================

export async function getHistory(deps: ResultsDeps, userId: string, limit: number, offset: number): Promise<HistoryResponse> {
  const { items, total } = await getHistoryPage(deps.db, userId, limit, offset)
  const entries: HistoryEntry[] = items.map((r) => ({
    quizId: r.quizId,
    quizNumber: r.quizNumber,
    title: r.title,
    type: r.type,
    scheduledAt: r.scheduledAt,
    totalScore: r.finishedAt === null ? null : r.totalScore,
    rank: r.boardComputedAt === null ? null : r.rank,
    participantCount: r.boardComputedAt === null ? null : r.participantCount,
  }))
  return { items: entries, total, limit, offset }
}

// ============================================================================
// Admin report — Sprint 8 AC-1/2/3/5; gated identically to leaderboard/review
// ============================================================================

export type ReportOutcome = { kind: "ok"; response: AdminReportResponse } | { kind: "not_found" } | { kind: "locked" }

export async function getReport(deps: ResultsDeps, quizId: string, limit: number, offset: number): Promise<ReportOutcome> {
  const now = deps.now()
  const initial = await getQuizLifecycle(deps.db, quizId)
  if (!initial) return { kind: "not_found" }

  const lifecycle = await ensurePublished(deps, quizId, initial, now)
  if (lifecycle.boardComputedAt === null) return { kind: "locked" }

  const [participants, questions, units] = await Promise.all([
    getAdminReportParticipantsPage(deps.db, quizId, limit, offset),
    getAdminReportQuestions(deps.db, quizId),
    getAdminReportUnits(deps.db, quizId),
  ])

  return {
    kind: "ok",
    response: {
      quizId,
      participants: { items: participants.items, total: participants.total, limit, offset },
      questions,
      units,
    },
  }
}
