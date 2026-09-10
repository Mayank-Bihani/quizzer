// QUIZZING creation tables: quizzes, quiz_units, quiz_questions. Pure persistence — mechanical
// reads/writes of a plan the service layer (quiz-creation.ts) already decided — QUIZZING.md §4.

import type { Difficulty, QuizUnitDefinition, TimingPolicy } from "../core/contracts"
import type { QuizStatus, QuizType } from "../core/contracts"
import type { QuizAdminSummary } from "../core/api"

type QuizRow = {
  id: string
  quiz_number: number | null
  template_id: string | null
  title: string
  type: QuizType
  question_count: number | null
  unit_count: number | null
  difficulty_mix: string | null
  timing_policy: string | null
  slack_sec: number | null
  join_window_sec: number | null
  scheduled_at: number
  lobby_opens_at: number | null
  ends_at: number | null
  status: QuizStatus
  room_code: string | null
  seat_cap: number
  window_sec: number | null
  marks_correct: number | null
  marks_wrong: number | null
  created_by: string
  created_at: number
  opened_at: number | null
  ended_at: number | null
  board_computed_at: number | null
}

type UnitRow = { unit_position: number; kind: string; passage_id: string | null; time_limit_sec: number | null }
type QuestionRow = { question_id: string; position: number; unit_position: number }

function parseJsonColumn<T>(value: string | null): T | null {
  if (value === null) return null
  try {
    return JSON.parse(value) as T
  } catch {
    throw new Error("corrupt stored JSON column")
  }
}

function toUnitDefinitions(rows: UnitRow[], questionRows: QuestionRow[]): QuizUnitDefinition[] {
  const positionsByUnit = new Map<number, number[]>()
  for (const q of questionRows) {
    const list = positionsByUnit.get(q.unit_position) ?? []
    list.push(q.position)
    positionsByUnit.set(q.unit_position, list)
  }
  return rows
    .sort((a, b) => a.unit_position - b.unit_position)
    .map((row) => ({
      unitPosition: row.unit_position,
      kind: row.kind as QuizUnitDefinition["kind"],
      passageId: row.passage_id,
      questionPositions: (positionsByUnit.get(row.unit_position) ?? []).sort((a, b) => a - b),
      timeLimitSec: row.time_limit_sec,
    }))
}

// quizNumber is hidden while room_code is null — the reservation is internal until a quiz is
// fully retired and scheduled (AC-7/API.md §"hidden reservation").
function toAdminSummary(row: QuizRow, units: QuizUnitDefinition[]): QuizAdminSummary {
  return {
    id: row.id,
    quizNumber: row.room_code === null ? null : row.quiz_number,
    templateId: row.template_id,
    title: row.title,
    type: row.type,
    questionCount: row.question_count,
    difficultyMix: parseJsonColumn<Partial<Record<Difficulty, number>>>(row.difficulty_mix),
    scheduledAt: row.scheduled_at,
    lobbyOpensAt: row.lobby_opens_at,
    endsAt: row.ends_at,
    status: row.status,
    roomCode: row.room_code,
    seatCap: row.seat_cap,
    unitCount: row.unit_count,
    units,
    timingPolicy: parseJsonColumn<TimingPolicy>(row.timing_policy),
    joinWindowSec: row.join_window_sec,
    slackSec: row.slack_sec,
    windowSec: row.window_sec,
    marksCorrect: row.marks_correct,
    marksWrong: row.marks_wrong,
    createdAt: row.created_at,
    openedAt: row.opened_at,
    endedAt: row.ended_at,
    boardComputedAt: row.board_computed_at,
  }
}

async function loadUnits(db: D1Database, quizId: string): Promise<{ units: UnitRow[]; questions: QuestionRow[] }> {
  const [units, questions] = await Promise.all([
    db
      .prepare("SELECT unit_position, kind, passage_id, time_limit_sec FROM quiz_units WHERE quiz_id = ?")
      .bind(quizId)
      .all<UnitRow>(),
    db
      .prepare("SELECT question_id, position, unit_position FROM quiz_questions WHERE quiz_id = ?")
      .bind(quizId)
      .all<QuestionRow>(),
  ])
  return { units: units.results, questions: questions.results }
}

export type DraftInsert = {
  id: string
  title: string
  type: QuizType
  scheduledAt: number
  questionCount: number
  difficultyMix: Partial<Record<Difficulty, number>>
  createdBy: string
  createdAt: number
  units: QuizUnitDefinition[]
  questionIds: string[] // caller-ordered, matching units' questionPositions
}

export async function insertDraft(db: D1Database, draft: DraftInsert): Promise<void> {
  const lobbyOpensAt = draft.scheduledAt - 300_000
  const statements = [
    db
      .prepare(
        `INSERT INTO quizzes (id, title, type, question_count, unit_count, difficulty_mix, scheduled_at, lobby_opens_at, seat_cap, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 120, ?, ?)`
      )
      .bind(
        draft.id,
        draft.title,
        draft.type,
        draft.questionCount,
        draft.units.length,
        JSON.stringify(draft.difficultyMix),
        draft.scheduledAt,
        lobbyOpensAt,
        draft.createdBy,
        draft.createdAt
      ),
    ...draft.units.map((unit) =>
      db
        .prepare("INSERT INTO quiz_units (quiz_id, unit_position, kind, passage_id) VALUES (?, ?, ?, ?)")
        .bind(draft.id, unit.unitPosition, unit.kind, unit.passageId)
    ),
  ]

  let position = 1
  for (const unit of draft.units) {
    for (let sub = 1; sub <= unit.questionPositions.length; sub++) {
      const questionId = draft.questionIds[position - 1]
      statements.push(
        db
          .prepare(
            "INSERT INTO quiz_questions (quiz_id, question_id, position, unit_position, sub_position) VALUES (?, ?, ?, ?, ?)"
          )
          .bind(draft.id, questionId, position, unit.unitPosition, sub)
      )
      position++
    }
  }

  await db.batch(statements)
}

export async function getQuizAdminSummary(db: D1Database, id: string): Promise<QuizAdminSummary | null> {
  const row = await db.prepare("SELECT * FROM quizzes WHERE id = ?").bind(id).first<QuizRow>()
  if (!row) return null
  const { units, questions } = await loadUnits(db, id)
  return toAdminSummary(row, toUnitDefinitions(units, questions))
}

export async function listQuizzesPage(
  db: D1Database,
  filters: { status?: QuizStatus },
  limit: number,
  offset: number
): Promise<{ items: QuizAdminSummary[]; total: number }> {
  const where = filters.status ? "WHERE status = ?" : ""
  const params = filters.status ? [filters.status] : []

  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM quizzes ${where}`)
    .bind(...params)
    .first<{ total: number }>()

  const { results } = await db
    .prepare(`SELECT * FROM quizzes ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .bind(...params, limit, offset)
    .all<QuizRow>()

  if (results.length === 0) return { items: [], total: totalRow?.total ?? 0 }

  const ids = results.map((r) => r.id)
  const placeholders = ids.map(() => "?").join(", ")
  const [unitRows, questionRows] = await Promise.all([
    db
      .prepare(`SELECT quiz_id, unit_position, kind, passage_id, time_limit_sec FROM quiz_units WHERE quiz_id IN (${placeholders})`)
      .bind(...ids)
      .all<UnitRow & { quiz_id: string }>(),
    db
      .prepare(`SELECT quiz_id, question_id, position, unit_position FROM quiz_questions WHERE quiz_id IN (${placeholders})`)
      .bind(...ids)
      .all<QuestionRow & { quiz_id: string }>(),
  ])

  const unitsByQuiz = new Map<string, UnitRow[]>()
  for (const row of unitRows.results) {
    const list = unitsByQuiz.get(row.quiz_id) ?? []
    list.push(row)
    unitsByQuiz.set(row.quiz_id, list)
  }
  const questionsByQuiz = new Map<string, QuestionRow[]>()
  for (const row of questionRows.results) {
    const list = questionsByQuiz.get(row.quiz_id) ?? []
    list.push(row)
    questionsByQuiz.set(row.quiz_id, list)
  }

  const items = results.map((row) =>
    toAdminSummary(row, toUnitDefinitions(unitsByQuiz.get(row.id) ?? [], questionsByQuiz.get(row.id) ?? []))
  )
  return { items, total: totalRow?.total ?? 0 }
}

export type DraftForReshuffle = {
  status: QuizStatus
  type: QuizType
  questionCount: number
  difficultyMix: Partial<Record<Difficulty, number>>
  timingPolicy: TimingPolicy | null
  slackSec: number | null
}

export async function getDraftForReshuffle(db: D1Database, id: string): Promise<DraftForReshuffle | null> {
  const row = await db
    .prepare("SELECT status, type, question_count, difficulty_mix, timing_policy, slack_sec FROM quizzes WHERE id = ?")
    .bind(id)
    .first<Pick<QuizRow, "status" | "type" | "question_count" | "difficulty_mix" | "timing_policy" | "slack_sec">>()
  if (!row) return null
  return {
    status: row.status,
    type: row.type,
    questionCount: row.question_count ?? 0,
    difficultyMix: parseJsonColumn<Partial<Record<Difficulty, number>>>(row.difficulty_mix) ?? {},
    timingPolicy: parseJsonColumn<TimingPolicy>(row.timing_policy),
    slackSec: row.slack_sec,
  }
}

export async function replaceMembership(
  db: D1Database,
  quizId: string,
  units: QuizUnitDefinition[],
  questionIds: string[],
  windowSec: number | null
): Promise<void> {
  const statements = [
    db.prepare("DELETE FROM quiz_questions WHERE quiz_id = ?").bind(quizId),
    db.prepare("DELETE FROM quiz_units WHERE quiz_id = ?").bind(quizId),
    ...units.map((unit) =>
      db
        .prepare("INSERT INTO quiz_units (quiz_id, unit_position, kind, passage_id, time_limit_sec) VALUES (?, ?, ?, ?, ?)")
        .bind(quizId, unit.unitPosition, unit.kind, unit.passageId, unit.timeLimitSec)
    ),
  ]
  let position = 1
  for (const unit of units) {
    for (let sub = 1; sub <= unit.questionPositions.length; sub++) {
      statements.push(
        db
          .prepare(
            "INSERT INTO quiz_questions (quiz_id, question_id, position, unit_position, sub_position) VALUES (?, ?, ?, ?, ?)"
          )
          .bind(quizId, questionIds[position - 1], position, unit.unitPosition, sub)
      )
      position++
    }
  }
  statements.push(
    db.prepare("UPDATE quizzes SET unit_count = ?, window_sec = ? WHERE id = ?").bind(units.length, windowSec, quizId)
  )
  await db.batch(statements)
}

export type QuizForPatch = {
  status: QuizStatus
  units: { unitPosition: number; kind: QuizUnitDefinition["kind"]; timeLimitSec: number | null }[]
  scheduledAt: number
  joinWindowSec: number | null
  slackSec: number | null
}

export async function getQuizForPatch(db: D1Database, id: string): Promise<QuizForPatch | null> {
  const row = await db
    .prepare("SELECT status, scheduled_at, join_window_sec, slack_sec FROM quizzes WHERE id = ?")
    .bind(id)
    .first<Pick<QuizRow, "status" | "scheduled_at" | "join_window_sec" | "slack_sec">>()
  if (!row) return null
  const { units } = await loadUnits(db, id)
  return {
    status: row.status,
    units: units.map((u) => ({
      unitPosition: u.unit_position,
      kind: u.kind as QuizUnitDefinition["kind"],
      timeLimitSec: u.time_limit_sec,
    })),
    scheduledAt: row.scheduled_at,
    joinWindowSec: row.join_window_sec,
    slackSec: row.slack_sec,
  }
}

export type SettingsUpdate = {
  title?: string
  scheduledAt?: number
  lobbyOpensAt?: number
  joinWindowSec?: number
  endsAt?: number | null
  slackSec?: number
  marksCorrect?: number
  marksWrong?: number
  seatCap?: number
  timingPolicy?: TimingPolicy
  windowSec: number | null
}

const SETTINGS_COLUMN_BY_FIELD: Record<string, string> = {
  title: "title",
  scheduledAt: "scheduled_at",
  lobbyOpensAt: "lobby_opens_at",
  joinWindowSec: "join_window_sec",
  endsAt: "ends_at",
  slackSec: "slack_sec",
  marksCorrect: "marks_correct",
  marksWrong: "marks_wrong",
  seatCap: "seat_cap",
  timingPolicy: "timing_policy",
  windowSec: "window_sec",
}

export async function applySettingsUpdate(
  db: D1Database,
  quizId: string,
  fields: SettingsUpdate,
  unitTimeLimits: { unitPosition: number; timeLimitSec: number }[]
): Promise<void> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined)
  const setClause = entries.map(([field]) => `${SETTINGS_COLUMN_BY_FIELD[field]} = ?`).join(", ")
  const values = entries.map(([field, v]) => (field === "timingPolicy" ? JSON.stringify(v) : v))

  const statements = [db.prepare(`UPDATE quizzes SET ${setClause} WHERE id = ?`).bind(...values, quizId)]
  for (const override of unitTimeLimits) {
    statements.push(
      db
        .prepare("UPDATE quiz_units SET time_limit_sec = ? WHERE quiz_id = ? AND unit_position = ?")
        .bind(override.timeLimitSec, quizId, override.unitPosition)
    )
  }
  await db.batch(statements)
}

export type LockSnapshot = {
  status: QuizStatus
  quizNumber: number | null
  roomCode: string | null
  type: QuizType
  questionCount: number | null
  unitCount: number | null
  slackSec: number | null
  joinWindowSec: number | null
  marksCorrect: number | null
  marksWrong: number | null
  seatCap: number
  units: QuizUnitDefinition[]
  questionIds: string[] // ordered by flat position
}

export async function getLockSnapshot(db: D1Database, id: string): Promise<LockSnapshot | null> {
  const row = await db.prepare("SELECT * FROM quizzes WHERE id = ?").bind(id).first<QuizRow>()
  if (!row) return null
  const { units, questions } = await loadUnits(db, id)
  const orderedQuestionIds = questions.sort((a, b) => a.position - b.position).map((q) => q.question_id)
  return {
    status: row.status,
    quizNumber: row.quiz_number,
    roomCode: row.room_code,
    type: row.type,
    questionCount: row.question_count,
    unitCount: row.unit_count,
    slackSec: row.slack_sec,
    joinWindowSec: row.join_window_sec,
    marksCorrect: row.marks_correct,
    marksWrong: row.marks_wrong,
    seatCap: row.seat_cap,
    units: toUnitDefinitions(units, questions),
    questionIds: orderedQuestionIds,
  }
}

export async function reserveQuizNumber(db: D1Database, id: string): Promise<number | "not_draft"> {
  const existing = await db
    .prepare("SELECT quiz_number, status FROM quizzes WHERE id = ?")
    .bind(id)
    .first<{ quiz_number: number | null; status: QuizStatus }>()
  if (!existing) return "not_draft"
  if (existing.quiz_number !== null) return existing.quiz_number
  if (existing.status !== "draft") return "not_draft"

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const result = await db
        .prepare(
          `UPDATE quizzes
           SET quiz_number = (SELECT COALESCE(MAX(quiz_number), 0) + 1 FROM quizzes)
           WHERE id = ? AND status = 'draft' AND quiz_number IS NULL`
        )
        .bind(id)
        .run()
      if (result.meta.changes === 1) {
        const row = await db.prepare("SELECT quiz_number FROM quizzes WHERE id = ?").bind(id).first<{ quiz_number: number }>()
        return row!.quiz_number
      }
    } catch {
      // unique collision on quiz_number — another reservation won this number, retry
    }
    const recheck = await db
      .prepare("SELECT quiz_number, status FROM quizzes WHERE id = ?")
      .bind(id)
      .first<{ quiz_number: number | null; status: QuizStatus }>()
    if (recheck?.quiz_number !== null && recheck?.quiz_number !== undefined) return recheck.quiz_number
    if (recheck?.status !== "draft") return "not_draft"
  }
  throw new Error("quiz number reservation exhausted retries")
}

export async function publishSchedule(db: D1Database, id: string, quizNumber: number, roomCode: string): Promise<boolean> {
  const result = await db
    .prepare("UPDATE quizzes SET room_code = ?, status = 'scheduled' WHERE id = ? AND status = 'draft' AND quiz_number = ?")
    .bind(roomCode, id, quizNumber)
    .run()
  return result.meta.changes === 1
}

export async function cancelQuiz(db: D1Database, id: string): Promise<{ ok: true } | { ok: false; reason: "not_found" | "conflict" }> {
  const result = await db
    .prepare("UPDATE quizzes SET status = 'cancelled' WHERE id = ? AND status IN ('draft', 'scheduled', 'open')")
    .bind(id)
    .run()
  if (result.meta.changes === 1) return { ok: true }
  const exists = await db.prepare("SELECT id FROM quizzes WHERE id = ?").bind(id).first()
  return { ok: false, reason: exists ? "conflict" : "not_found" }
}
