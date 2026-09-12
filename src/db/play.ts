// QUIZZING runtime reads: quiz meta/unit structure, open-list, participant snapshots, status
// counts, and bounded scheduler discovery. Never reads BANK's questions/passages columns —
// authored content and format always come through BankContract — QUIZZING.md §5.

import type { DueCloseQuiz, QuizStatus, QuizType, UnitKind } from "../core/contracts"
import type { OpenQuizSummary, UpcomingQuizSummary } from "../core/api"
import { SCHEDULER_DISCOVERY_LIMIT } from "../core/config"

export type RuntimeUnitDef = {
  unitPosition: number
  kind: UnitKind
  passageId: string | null
  timeLimitSec: number
  questionPositions: number[] // flat graded positions, ordered by subPosition
  questionIds: string[] // parallel to questionPositions
}

export type RuntimeQuizMeta = {
  id: string
  quizNumber: number
  title: string
  type: QuizType
  status: QuizStatus
  scheduledAt: number
  lobbyOpensAt: number
  endsAt: number
  windowSec: number
  seatCap: number
  questionCount: number
  unitCount: number
  marksCorrect: number
  marksWrong: number
  units: RuntimeUnitDef[]
}

type QuizMetaRow = {
  id: string
  quiz_number: number | null
  title: string
  type: QuizType
  status: QuizStatus
  scheduled_at: number
  lobby_opens_at: number | null
  ends_at: number | null
  window_sec: number | null
  seat_cap: number
  question_count: number | null
  unit_count: number | null
  marks_correct: number | null
  marks_wrong: number | null
}

type UnitRow = { unit_position: number; kind: UnitKind; passage_id: string | null; time_limit_sec: number | null }
type QuestionRow = { question_id: string; position: number; unit_position: number; sub_position: number }

function toRuntimeQuizMeta(row: QuizMetaRow, units: UnitRow[], questions: QuestionRow[]): RuntimeQuizMeta | null {
  if (
    row.quiz_number === null ||
    row.lobby_opens_at === null ||
    row.ends_at === null ||
    row.window_sec === null ||
    row.question_count === null ||
    row.unit_count === null ||
    row.marks_correct === null ||
    row.marks_wrong === null
  ) {
    return null // draft/incomplete row — never a real runtime target
  }

  const questionsByUnit = new Map<number, QuestionRow[]>()
  for (const q of questions) {
    const list = questionsByUnit.get(q.unit_position) ?? []
    list.push(q)
    questionsByUnit.set(q.unit_position, list)
  }

  const runtimeUnits: RuntimeUnitDef[] = [...units]
    .sort((a, b) => a.unit_position - b.unit_position)
    .map((unit) => {
      const members = (questionsByUnit.get(unit.unit_position) ?? []).sort((a, b) => a.sub_position - b.sub_position)
      return {
        unitPosition: unit.unit_position,
        kind: unit.kind,
        passageId: unit.passage_id,
        timeLimitSec: unit.time_limit_sec as number,
        questionPositions: members.map((m) => m.position),
        questionIds: members.map((m) => m.question_id),
      }
    })

  return {
    id: row.id,
    quizNumber: row.quiz_number,
    title: row.title,
    type: row.type,
    status: row.status,
    scheduledAt: row.scheduled_at,
    lobbyOpensAt: row.lobby_opens_at,
    endsAt: row.ends_at,
    windowSec: row.window_sec,
    seatCap: row.seat_cap,
    questionCount: row.question_count,
    unitCount: row.unit_count,
    marksCorrect: row.marks_correct,
    marksWrong: row.marks_wrong,
    units: runtimeUnits,
  }
}

async function loadUnitsAndQuestions(db: D1Database, quizId: string): Promise<{ units: UnitRow[]; questions: QuestionRow[] }> {
  const [units, questions] = await Promise.all([
    db
      .prepare("SELECT unit_position, kind, passage_id, time_limit_sec FROM quiz_units WHERE quiz_id = ?")
      .bind(quizId)
      .all<UnitRow>(),
    db
      .prepare("SELECT question_id, position, unit_position, sub_position FROM quiz_questions WHERE quiz_id = ?")
      .bind(quizId)
      .all<QuestionRow>(),
  ])
  return { units: units.results, questions: questions.results }
}

export async function getRuntimeQuizMeta(db: D1Database, quizId: string): Promise<RuntimeQuizMeta | null> {
  const row = await db
    .prepare(
      `SELECT id, quiz_number, title, type, status, scheduled_at, lobby_opens_at, ends_at, window_sec,
              seat_cap, question_count, unit_count, marks_correct, marks_wrong
       FROM quizzes WHERE id = ?`
    )
    .bind(quizId)
    .first<QuizMetaRow>()
  if (!row) return null
  const { units, questions } = await loadUnitsAndQuestions(db, quizId)
  return toRuntimeQuizMeta(row, units, questions)
}

export async function getRuntimeQuizMetaByRoomCode(db: D1Database, roomCode: string): Promise<RuntimeQuizMeta | null> {
  const row = await db
    .prepare(
      `SELECT id, quiz_number, title, type, status, scheduled_at, lobby_opens_at, ends_at, window_sec,
              seat_cap, question_count, unit_count, marks_correct, marks_wrong
       FROM quizzes WHERE room_code = ?`
    )
    .bind(roomCode)
    .first<QuizMetaRow>()
  if (!row) return null
  const { units, questions } = await loadUnitsAndQuestions(db, row.id)
  return toRuntimeQuizMeta(row, units, questions)
}

export async function listOpenQuizzes(db: D1Database, now: number): Promise<OpenQuizSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT id, quiz_number, title, type, room_code, scheduled_at, ends_at
       FROM quizzes
       WHERE status = 'open' AND scheduled_at <= ? AND ends_at > ?
       ORDER BY scheduled_at ASC, id ASC`
    )
    .bind(now, now)
    .all<{
      id: string
      quiz_number: number
      title: string
      type: QuizType
      room_code: string
      scheduled_at: number
      ends_at: number
    }>()

  return results.map((row) => ({
    id: row.id,
    quizNumber: row.quiz_number,
    title: row.title,
    type: row.type,
    roomCode: row.room_code,
    scheduledAt: row.scheduled_at,
    endsAt: row.ends_at,
  }))
}

export async function listUpcomingQuizzes(db: D1Database, now: number, windowMs: number): Promise<UpcomingQuizSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT id, quiz_number, title, type, question_count, scheduled_at
       FROM quizzes
       WHERE status = 'scheduled' AND scheduled_at > ? AND scheduled_at <= ?
       ORDER BY scheduled_at ASC, id ASC`
    )
    .bind(now, now + windowMs)
    .all<{
      id: string
      quiz_number: number
      title: string
      type: QuizType
      question_count: number
      scheduled_at: number
    }>()

  return results.map((row) => ({
    id: row.id,
    quizNumber: row.quiz_number,
    title: row.title,
    type: row.type,
    questionCount: row.question_count,
    scheduledAt: row.scheduled_at,
  }))
}

export type ParticipantRow = {
  seatNo: number
  startedAt: number
  currentUnitPosition: number
  finishedAt: number | null
  totalScore: number
  correctCount: number
  wrongCount: number
  skippedCount: number
  unansweredCount: number
  totalTimeMs: number
}

export async function getParticipant(db: D1Database, quizId: string, userId: string): Promise<ParticipantRow | null> {
  const row = await db
    .prepare(
      `SELECT seat_no, started_at, current_unit_position, finished_at, total_score,
              correct_count, wrong_count, skipped_count, unanswered_count, total_time_ms
       FROM participants WHERE quiz_id = ? AND user_id = ?`
    )
    .bind(quizId, userId)
    .first<{
      seat_no: number
      started_at: number
      current_unit_position: number
      finished_at: number | null
      total_score: number
      correct_count: number
      wrong_count: number
      skipped_count: number
      unanswered_count: number
      total_time_ms: number
    }>()
  if (!row) return null
  return {
    seatNo: row.seat_no,
    startedAt: row.started_at,
    currentUnitPosition: row.current_unit_position,
    finishedAt: row.finished_at,
    totalScore: row.total_score,
    correctCount: row.correct_count,
    wrongCount: row.wrong_count,
    skippedCount: row.skipped_count,
    unansweredCount: row.unanswered_count,
    totalTimeMs: row.total_time_ms,
  }
}

export type ParticipantUnitRow = {
  unitPosition: number
  startedAt: number
  deadlineAt: number
  submitByAt: number
  closedAt: number | null
  closeReason: "completed" | "timed_out" | null
  submissionId: string | null
  payloadHash: string | null
}

function mapParticipantUnitRow(row: {
  unit_position: number
  started_at: number
  deadline_at: number
  submit_by_at: number
  closed_at: number | null
  close_reason: "completed" | "timed_out" | null
  submission_id: string | null
  payload_hash: string | null
}): ParticipantUnitRow {
  return {
    unitPosition: row.unit_position,
    startedAt: row.started_at,
    deadlineAt: row.deadline_at,
    submitByAt: row.submit_by_at,
    closedAt: row.closed_at,
    closeReason: row.close_reason,
    submissionId: row.submission_id,
    payloadHash: row.payload_hash,
  }
}

// The active (still-open) unit for this participant, if any — at most one by schema invariant.
export async function getActiveParticipantUnit(db: D1Database, quizId: string, userId: string): Promise<ParticipantUnitRow | null> {
  const row = await db
    .prepare(
      `SELECT unit_position, started_at, deadline_at, submit_by_at, closed_at, close_reason, submission_id, payload_hash
       FROM participant_units WHERE quiz_id = ? AND user_id = ? AND closed_at IS NULL`
    )
    .bind(quizId, userId)
    .first<{
      unit_position: number
      started_at: number
      deadline_at: number
      submit_by_at: number
      closed_at: number | null
      close_reason: "completed" | "timed_out" | null
      submission_id: string | null
      payload_hash: string | null
    }>()
  return row ? mapParticipantUnitRow(row) : null
}

export async function getParticipantUnit(
  db: D1Database,
  quizId: string,
  userId: string,
  unitPosition: number
): Promise<ParticipantUnitRow | null> {
  const row = await db
    .prepare(
      `SELECT unit_position, started_at, deadline_at, submit_by_at, closed_at, close_reason, submission_id, payload_hash
       FROM participant_units WHERE quiz_id = ? AND user_id = ? AND unit_position = ?`
    )
    .bind(quizId, userId, unitPosition)
    .first<{
      unit_position: number
      started_at: number
      deadline_at: number
      submit_by_at: number
      closed_at: number | null
      close_reason: "completed" | "timed_out" | null
      submission_id: string | null
      payload_hash: string | null
    }>()
  return row ? mapParticipantUnitRow(row) : null
}

export async function getStatusCounts(db: D1Database, quizId: string): Promise<{ finishedCount: number; participantCount: number }> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS participant_count, SUM(CASE WHEN finished_at IS NOT NULL THEN 1 ELSE 0 END) AS finished_count
       FROM participants WHERE quiz_id = ?`
    )
    .bind(quizId)
    .first<{ participant_count: number; finished_count: number | null }>()
  return { finishedCount: row?.finished_count ?? 0, participantCount: row?.participant_count ?? 0 }
}

// Bounded discovery — QUIZZING is the sole writer/reader of its own tables for this purpose;
// SCHEDULER never issues SQL itself — CONTRACTS.md §5; SCHEDULER.md §"scheduler discovery".
export async function listDuePrepare(db: D1Database, now: number, limit: number): Promise<string[]> {
  const boundedLimit = Math.min(limit, SCHEDULER_DISCOVERY_LIMIT)
  const { results } = await db
    .prepare(
      `SELECT id FROM quizzes WHERE status = 'scheduled' AND lobby_opens_at <= ?
       ORDER BY lobby_opens_at ASC, id ASC LIMIT ?`
    )
    .bind(now, boundedLimit)
    .all<{ id: string }>()
  return results.map((r) => r.id)
}

// safeCloseAt = ends_at + windowSec*1000 + transport allowance: the latest moment any legitimate
// participant clock could still be open — PRD.md §5.4.
export async function listDueClose(db: D1Database, now: number, limit: number): Promise<DueCloseQuiz[]> {
  const boundedLimit = Math.min(limit, SCHEDULER_DISCOVERY_LIMIT)
  const { results } = await db
    .prepare(
      `SELECT id, (ends_at + window_sec * 1000 + 5000) AS safe_close_at
       FROM quizzes
       WHERE status = 'open' AND (ends_at + window_sec * 1000 + 5000) <= ?
       ORDER BY safe_close_at ASC, id ASC LIMIT ?`
    )
    .bind(now, boundedLimit)
    .all<{ id: string; safe_close_at: number }>()
  return results.map((r) => ({ quizId: r.id, safeCloseAt: r.safe_close_at }))
}
