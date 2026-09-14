// QUIZZING creation tables: quizzes, quiz_units, quiz_questions. Pure persistence — mechanical
// reads/writes of a plan the service layer (quiz-creation.ts) already decided — QUIZZING.md §4.

import type { Difficulty, QuizUnitDefinition, TimingPolicy } from "../core/contracts"
import type { DueAnnounceQuiz, QuizStatus, QuizType, UnitKind } from "../core/contracts"
import type { QuizAdminSummary, TemplateSummary } from "../core/api"

type QuizRow = {
  id: string
  quiz_number: number | null
  template_id: string | null
  title: string
  type: QuizType
  question_count: number | null
  unit_count: number | null
  set_count: number | null
  standalone_count: number | null
  difficulty_mix: string | null
  topics: string
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
    setCount: row.set_count,
    standaloneCount: row.standalone_count,
    difficultyMix: parseJsonColumn<Partial<Record<Difficulty, number>>>(row.difficulty_mix),
    topics: parseJsonColumn<string[]>(row.topics) ?? [],
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
  setCount: number | null // the requested set count that produced this draw; null for quant
  standaloneCount: number | null // the requested standalone count; null for a pure-set lr draw
  difficultyMix: Partial<Record<Difficulty, number>>
  topics: string[] // quant only; [] for every other type and for manual mode
  createdBy: string
  createdAt: number
  units: QuizUnitDefinition[]
  questionIds: string[] // caller-ordered, matching units' questionPositions
  templateId?: string // Sprint 7 materialization only; admin-created drafts never set this
  seatCap?: number // defaults to 120, matching the admin-draft path's prior fixed value exactly
  selectionMode?: "auto" | "manual" // defaults to 'auto'; the materializer never sets this
}

export async function insertDraft(db: D1Database, draft: DraftInsert): Promise<void> {
  const lobbyOpensAt = draft.scheduledAt - 300_000
  const statements = [
    db
      .prepare(
        `INSERT INTO quizzes (id, template_id, title, type, question_count, unit_count, set_count, standalone_count, difficulty_mix, topics, scheduled_at, lobby_opens_at, seat_cap, selection_mode, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        draft.id,
        draft.templateId ?? null,
        draft.title,
        draft.type,
        draft.questionCount,
        draft.units.length,
        draft.setCount,
        draft.standaloneCount,
        JSON.stringify(draft.difficultyMix),
        JSON.stringify(draft.topics),
        draft.scheduledAt,
        lobbyOpensAt,
        draft.seatCap ?? 120,
        draft.selectionMode ?? "auto",
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
  setCount: number | null
  standaloneCount: number | null
  difficultyMix: Partial<Record<Difficulty, number>>
  topics: string[]
  timingPolicy: TimingPolicy | null
  slackSec: number | null
  selectionMode: "auto" | "manual"
}

export async function getDraftForReshuffle(db: D1Database, id: string): Promise<DraftForReshuffle | null> {
  const row = await db
    .prepare(
      "SELECT status, type, set_count, standalone_count, difficulty_mix, topics, timing_policy, slack_sec, selection_mode FROM quizzes WHERE id = ?"
    )
    .bind(id)
    .first<
      Pick<QuizRow, "status" | "type" | "set_count" | "standalone_count" | "difficulty_mix" | "topics" | "timing_policy" | "slack_sec"> & {
        selection_mode: "auto" | "manual"
      }
    >()
  if (!row) return null
  return {
    status: row.status,
    type: row.type,
    setCount: row.set_count,
    standaloneCount: row.standalone_count,
    difficultyMix: parseJsonColumn<Partial<Record<Difficulty, number>>>(row.difficulty_mix) ?? {},
    topics: parseJsonColumn<string[]>(row.topics) ?? [],
    timingPolicy: parseJsonColumn<TimingPolicy>(row.timing_policy),
    slackSec: row.slack_sec,
    selectionMode: row.selection_mode,
  }
}

export async function replaceMembership(
  db: D1Database,
  quizId: string,
  units: QuizUnitDefinition[],
  questionIds: string[],
  windowSec: number | null,
  questionCount: number
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
    db
      .prepare("UPDATE quizzes SET question_count = ?, unit_count = ?, window_sec = ? WHERE id = ?")
      .bind(questionCount, units.length, windowSec, quizId)
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

// ============================================================================
// listDueAnnounce — TG-1/TG-2/TG-3 discovery, CONTRACTS.md §5; SCHEDULER.md §"Announce"
// ============================================================================

const ANNOUNCE_WINDOW_MS = 7_200_000 // T-2h
const SOON_WINDOW_MS = 1_800_000 // T-30m

type DueCandidateRow = { id: string; scheduled_at: number }

// "Due" is a threshold (now >= trigger), not a narrow window: a late/missed tick still finds and
// claims the candidate on its next run, since re-evaluation (not a one-shot timer) is what makes
// this resilient to Cloudflare cron's best-effort, occasionally-late firing.
async function findDueQuizIds(db: D1Database, now: number, windowMs: number, kind: "announce" | "soon" | "open", limit: number): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT id, scheduled_at FROM quizzes
       WHERE status IN ('scheduled', 'open') AND scheduled_at - ? <= ?
         AND NOT EXISTS (SELECT 1 FROM telegram_posts WHERE quiz_id = quizzes.id AND kind = ?)
       ORDER BY scheduled_at ASC, id ASC LIMIT ?`
    )
    .bind(windowMs, now, kind, limit)
    .all<DueCandidateRow>()
  return results.map((r) => r.id)
}

async function buildAnnouncePayload(db: D1Database, quizId: string, includeRoomCode: boolean): Promise<Omit<DueAnnounceQuiz, "quizId" | "kind"> | null> {
  const row = await db
    .prepare("SELECT title, scheduled_at, ends_at, question_count, unit_count, window_sec, room_code FROM quizzes WHERE id = ?")
    .bind(quizId)
    .first<{
      title: string
      scheduled_at: number
      ends_at: number | null
      question_count: number | null
      unit_count: number | null
      window_sec: number | null
      room_code: string | null
    }>()
  if (!row || row.ends_at === null || row.question_count === null || row.unit_count === null || row.window_sec === null) return null

  const { results } = await db.prepare("SELECT kind, time_limit_sec FROM quiz_units WHERE quiz_id = ?").bind(quizId).all<{ kind: UnitKind; time_limit_sec: number | null }>()
  const byKind = new Map<UnitKind, { count: number; minTimeSec: number; maxTimeSec: number }>()
  for (const unit of results) {
    if (unit.time_limit_sec === null) continue
    const existing = byKind.get(unit.kind)
    if (!existing) {
      byKind.set(unit.kind, { count: 1, minTimeSec: unit.time_limit_sec, maxTimeSec: unit.time_limit_sec })
    } else {
      existing.count++
      existing.minTimeSec = Math.min(existing.minTimeSec, unit.time_limit_sec)
      existing.maxTimeSec = Math.max(existing.maxTimeSec, unit.time_limit_sec)
    }
  }
  const timingSummary = [...byKind.entries()].map(([kind, agg]) => ({ kind, ...agg }))

  return {
    title: row.title,
    scheduledAt: row.scheduled_at,
    endsAt: row.ends_at,
    questionCount: row.question_count,
    unitCount: row.unit_count,
    windowSec: row.window_sec,
    timingSummary,
    ...(includeRoomCode && row.room_code ? { roomCode: row.room_code } : {}),
  }
}

// Discovery-based fallback for the cancelled kind's notify path: routes/quizzes.ts (the only
// caller of quiz-creation.ts's cancel()) is a protected Sprint 3 file this packet cannot edit, so
// there is no way to inject an onQuizCancelled callback into the live admin HTTP cancel route.
// This mirrors the same "SCHEDULER polls a bounded QUIZZING read" pattern already used by
// listDuePrepare/listDueClose/listDueAnnounce, keeping "routed through SCHEDULER, not a direct
// QUIZZING call" true for this kind too, just via polling instead of a synchronous callback.
// Only genuinely notify-worthy candidates are returned (an 'open' post was actually sent) so a
// silently-cancelled quiz — no 'open' post ever sent — never shows up as due, forever, on every
// tick.
export type DueCancelledNotification = { quizId: string; title: string; scheduledAt: number }

export async function listDueCancelledNotifications(db: D1Database, limit: number): Promise<DueCancelledNotification[]> {
  const { results } = await db
    .prepare(
      `SELECT q.id, q.title, q.scheduled_at FROM quizzes q
       WHERE q.status = 'cancelled'
         AND EXISTS (SELECT 1 FROM telegram_posts WHERE quiz_id = q.id AND kind = 'open' AND status = 'sent')
         AND NOT EXISTS (SELECT 1 FROM telegram_posts WHERE quiz_id = q.id AND kind = 'cancelled')
       ORDER BY q.scheduled_at ASC, q.id ASC LIMIT ?`
    )
    .bind(limit)
    .all<{ id: string; title: string; scheduled_at: number }>()
  return results.map((r) => ({ quizId: r.id, title: r.title, scheduledAt: r.scheduled_at }))
}

export async function listDueAnnounce(db: D1Database, now: number, limit: number): Promise<DueAnnounceQuiz[]> {
  const announceIds = await findDueQuizIds(db, now, ANNOUNCE_WINDOW_MS, "announce", limit)
  const soonIds = await findDueQuizIds(db, now, SOON_WINDOW_MS, "soon", limit)
  const openIds = await findDueQuizIds(db, now, 0, "open", limit)

  const due: DueAnnounceQuiz[] = []
  for (const quizId of announceIds) {
    const payload = await buildAnnouncePayload(db, quizId, false) // TG-6: never a room code before T
    if (payload) due.push({ quizId, kind: "announce", ...payload })
  }
  for (const quizId of soonIds) {
    const payload = await buildAnnouncePayload(db, quizId, false)
    if (payload) due.push({ quizId, kind: "soon", ...payload })
  }
  for (const quizId of openIds) {
    const payload = await buildAnnouncePayload(db, quizId, true)
    if (payload) due.push({ quizId, kind: "open", ...payload })
  }
  return due.slice(0, limit)
}

// ============================================================================
// materializeTemplates support — Sprint 7; QUIZZING.md §7; SCHEDULER.md §4.2
// ============================================================================

export type TemplateRow = {
  id: string
  name: string
  type: QuizType
  setCount: number | null // lr, and the RC portion of verbal; null for quant
  standaloneCount: number | null // quant's exact draw target, and the VA portion of verbal; null for lr
  difficultyMix: Partial<Record<Difficulty, number>>
  topics: string[] // quant only; [] for every other type
  timingPolicy: TimingPolicy
  slackSec: number
  joinWindowSec: number
  marksCorrect: number
  marksWrong: number
  seatCap: number
  rrule: string
  createdBy: string
}

export async function getActiveTemplates(db: D1Database): Promise<TemplateRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, type, set_count, standalone_count, difficulty_mix, topics, timing_policy, slack_sec, join_window_sec, marks_correct, marks_wrong, seat_cap, rrule, created_by
       FROM quiz_templates WHERE active = 1`
    )
    .all<{
      id: string
      name: string
      type: QuizType
      set_count: number | null
      standalone_count: number | null
      difficulty_mix: string
      topics: string
      timing_policy: string
      slack_sec: number
      join_window_sec: number
      marks_correct: number
      marks_wrong: number
      seat_cap: number
      rrule: string
      created_by: string
    }>()
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    setCount: r.set_count,
    standaloneCount: r.standalone_count,
    difficultyMix: parseJsonColumn<Partial<Record<Difficulty, number>>>(r.difficulty_mix) ?? {},
    topics: parseJsonColumn<string[]>(r.topics) ?? [],
    timingPolicy: parseJsonColumn<TimingPolicy>(r.timing_policy) ?? {},
    slackSec: r.slack_sec,
    joinWindowSec: r.join_window_sec,
    marksCorrect: r.marks_correct,
    marksWrong: r.marks_wrong,
    seatCap: r.seat_cap,
    rrule: r.rrule,
    createdBy: r.created_by,
  }))
}

// ============================================================================
// Template CRUD — Sprint 9; QUIZZING.md §4.4; API.md "QUIZZING — templates". Additive siblings
// only: never widens TemplateRow or getActiveTemplates, the frozen read path materializeTemplates
// depends on.
// ============================================================================

type TemplateColumnRow = {
  id: string
  name: string
  type: QuizType
  set_count: number | null
  standalone_count: number | null
  difficulty_mix: string
  topics: string
  timing_policy: string
  slack_sec: number
  join_window_sec: number
  marks_correct: number
  marks_wrong: number
  seat_cap: number
  rrule: string
  active: number
}

function toTemplateSummary(row: TemplateColumnRow): TemplateSummary {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    setCount: row.set_count,
    standaloneCount: row.standalone_count,
    difficultyMix: parseJsonColumn<Partial<Record<Difficulty, number>>>(row.difficulty_mix) ?? {},
    topics: parseJsonColumn<string[]>(row.topics) ?? [],
    timingPolicy: parseJsonColumn<TimingPolicy>(row.timing_policy) ?? {},
    slackSec: row.slack_sec,
    joinWindowSec: row.join_window_sec,
    marksCorrect: row.marks_correct,
    marksWrong: row.marks_wrong,
    seatCap: row.seat_cap,
    rrule: row.rrule,
    active: row.active === 1,
  }
}

export type TemplateInsert = {
  id: string
  name: string
  type: QuizType
  setCount: number | null
  standaloneCount: number | null
  difficultyMix: Partial<Record<Difficulty, number>>
  topics: string[]
  timingPolicy: TimingPolicy
  slackSec: number
  joinWindowSec: number
  marksCorrect: number
  marksWrong: number
  seatCap: number
  rrule: string
  createdBy: string
}

export async function insertTemplateRow(db: D1Database, input: TemplateInsert): Promise<void> {
  await db
    .prepare(
      `INSERT INTO quiz_templates (id, name, type, set_count, standalone_count, difficulty_mix, topics, timing_policy, slack_sec, join_window_sec, marks_correct, marks_wrong, seat_cap, rrule, active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    )
    .bind(
      input.id,
      input.name,
      input.type,
      input.setCount,
      input.standaloneCount,
      JSON.stringify(input.difficultyMix),
      JSON.stringify(input.topics),
      JSON.stringify(input.timingPolicy),
      input.slackSec,
      input.joinWindowSec,
      input.marksCorrect,
      input.marksWrong,
      input.seatCap,
      input.rrule,
      input.createdBy
    )
    .run()
}

export async function getTemplateSummaryById(db: D1Database, id: string): Promise<TemplateSummary | null> {
  const row = await db.prepare("SELECT * FROM quiz_templates WHERE id = ?").bind(id).first<TemplateColumnRow>()
  return row ? toTemplateSummary(row) : null
}

export async function listTemplatesPage(db: D1Database, limit: number, offset: number): Promise<{ items: TemplateSummary[]; total: number }> {
  const totalRow = await db.prepare("SELECT COUNT(*) AS total FROM quiz_templates").first<{ total: number }>()
  const { results } = await db
    .prepare("SELECT * FROM quiz_templates ORDER BY rowid DESC LIMIT ? OFFSET ?")
    .bind(limit, offset)
    .all<TemplateColumnRow>()
  return { items: results.map(toTemplateSummary), total: totalRow?.total ?? 0 }
}

export type TemplateFieldUpdate = Partial<{
  name: string
  type: QuizType
  setCount: number | null
  standaloneCount: number | null
  difficultyMix: Partial<Record<Difficulty, number>>
  topics: string[]
  timingPolicy: TimingPolicy
  slackSec: number
  joinWindowSec: number
  marksCorrect: number
  marksWrong: number
  seatCap: number
  rrule: string
}>

const TEMPLATE_COLUMN_BY_FIELD: Record<string, string> = {
  name: "name",
  type: "type",
  setCount: "set_count",
  standaloneCount: "standalone_count",
  difficultyMix: "difficulty_mix",
  topics: "topics",
  timingPolicy: "timing_policy",
  slackSec: "slack_sec",
  joinWindowSec: "join_window_sec",
  marksCorrect: "marks_correct",
  marksWrong: "marks_wrong",
  seatCap: "seat_cap",
  rrule: "rrule",
}

export async function updateTemplateRow(db: D1Database, id: string, fields: TemplateFieldUpdate): Promise<void> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return
  const setClause = entries.map(([field]) => `${TEMPLATE_COLUMN_BY_FIELD[field]} = ?`).join(", ")
  const values = entries.map(([field, v]) =>
    field === "difficultyMix" || field === "topics" || field === "timingPolicy" ? JSON.stringify(v) : v
  )
  await db.prepare(`UPDATE quiz_templates SET ${setClause} WHERE id = ?`).bind(...values, id).run()
}

export async function deactivateTemplateRow(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare("UPDATE quiz_templates SET active = 0 WHERE id = ? AND active = 1").bind(id).run()
  return result.meta.changes === 1
}

// Cheap existence check backed by idx_quizzes_template_scheduled — the authoritative retry-safety
// backstop; this is only an optimization to skip work, never the sole correctness guarantee.
export async function occurrenceExists(db: D1Database, templateId: string, scheduledAt: number): Promise<boolean> {
  const row = await db.prepare("SELECT 1 FROM quizzes WHERE template_id = ? AND scheduled_at = ?").bind(templateId, scheduledAt).first()
  return row !== null
}

// Only ever called for a draft this same materialize attempt just inserted, when the immediately
// following claim comes up short (an essentially-impossible single-admin-deployment race —
// BANK.md never designs for concurrent-admin claim contention) — AC-6 requires a failed occurrence
// to leave no draft, no partial quiz_units/quiz_questions, and no BANK claim behind.
export async function deleteUnpublishedDraft(db: D1Database, quizId: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM quiz_questions WHERE quiz_id = ?").bind(quizId),
    db.prepare("DELETE FROM quiz_units WHERE quiz_id = ?").bind(quizId),
    db.prepare("DELETE FROM quizzes WHERE id = ? AND status = 'draft'").bind(quizId),
  ])
}
