// Admin browse/detail/PATCH/cascade-DELETE over passages/questions — BANK.md §5-7.

import type { Difficulty, QuestionFull, QuizType } from "../core/contracts"
import type { PassageSummary, UpdateQuestionRequest } from "../core/api"
import {
  QUESTION_JOIN_PASSAGE_FROM,
  QUESTION_JOIN_PASSAGE_SELECT,
  toPassageSummary,
  toQuestionFull,
  type JoinedQuestionRow,
  type PassageRow,
} from "./bank-rows"

export type QuestionFilters = {
  type?: QuizType
  topic?: string
  difficulty?: Difficulty
  used?: boolean
}

function buildFilterClause(filters: QuestionFilters): { where: string; params: unknown[] } {
  const conditions: string[] = []
  const params: unknown[] = []
  if (filters.type) {
    conditions.push("q.type = ?")
    params.push(filters.type)
  }
  if (filters.topic) {
    conditions.push("q.topic = ?")
    params.push(filters.topic)
  }
  if (filters.difficulty) {
    conditions.push("q.difficulty = ?")
    params.push(filters.difficulty)
  }
  if (filters.used !== undefined) {
    conditions.push(filters.used ? "q.used_in_quiz_id IS NOT NULL" : "q.used_in_quiz_id IS NULL")
  }
  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", params }
}

export async function listQuestionsPage(
  db: D1Database,
  filters: QuestionFilters,
  limit: number,
  offset: number
): Promise<{ items: QuestionFull[]; total: number }> {
  const { where, params } = buildFilterClause(filters)

  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM questions q ${where}`)
    .bind(...params)
    .first<{ total: number }>()

  const { results } = await db
    .prepare(
      `SELECT ${QUESTION_JOIN_PASSAGE_SELECT} ${QUESTION_JOIN_PASSAGE_FROM} ${where} ORDER BY q.created_at ASC, q.id ASC LIMIT ? OFFSET ?`
    )
    .bind(...params, limit, offset)
    .all<JoinedQuestionRow>()

  return { items: results.map(toQuestionFull), total: totalRow?.total ?? 0 }
}

export async function getQuestionById(db: D1Database, id: string): Promise<QuestionFull | null> {
  const row = await db
    .prepare(`SELECT ${QUESTION_JOIN_PASSAGE_SELECT} ${QUESTION_JOIN_PASSAGE_FROM} WHERE q.id = ?`)
    .bind(id)
    .first<JoinedQuestionRow>()
  return row ? toQuestionFull(row) : null
}

export async function listPassages(db: D1Database): Promise<PassageSummary[]> {
  const { results } = await db
    .prepare("SELECT id, type, topic, title, body_md, image_key, source, used_in_quiz_id FROM passages ORDER BY created_at ASC, id ASC")
    .all<PassageRow>()
  return results.map(toPassageSummary)
}

const PATCH_COLUMN_BY_FIELD: Record<keyof UpdateQuestionRequest, string> = {
  topic: "topic",
  subtopic: "subtopic",
  difficulty: "difficulty",
  bodyMd: "body_md",
  optionA: "option_a",
  optionB: "option_b",
  optionC: "option_c",
  optionD: "option_d",
  numericTolerance: "numeric_tolerance",
  explanationMd: "explanation_md",
  source: "source",
}
const OPTION_FIELDS: (keyof UpdateQuestionRequest)[] = ["optionA", "optionB", "optionC", "optionD"]

export type UpdateOutcome =
  | { ok: true; question: QuestionFull }
  | { ok: false; reason: "not_found" | "invalid_field" }

export async function updateQuestion(
  db: D1Database,
  id: string,
  patch: UpdateQuestionRequest
): Promise<UpdateOutcome> {
  const current = await db
    .prepare("SELECT format, used_in_quiz_id FROM questions WHERE id = ?")
    .bind(id)
    .first<{ format: string; used_in_quiz_id: string | null }>()
  if (!current) return { ok: false, reason: "not_found" }

  const fields = Object.keys(patch) as (keyof UpdateQuestionRequest)[]
  const touchesOptions = fields.some((f) => OPTION_FIELDS.includes(f))
  if (touchesOptions && current.format !== "mcq") return { ok: false, reason: "invalid_field" }
  if (fields.includes("numericTolerance") && current.format !== "tita") return { ok: false, reason: "invalid_field" }
  if (touchesOptions && current.used_in_quiz_id !== null) return { ok: false, reason: "invalid_field" }

  if (fields.length === 0) {
    const row = await db
      .prepare(`SELECT ${QUESTION_JOIN_PASSAGE_SELECT} ${QUESTION_JOIN_PASSAGE_FROM} WHERE q.id = ?`)
      .bind(id)
      .first<JoinedQuestionRow>()
    return { ok: true, question: toQuestionFull(row as JoinedQuestionRow) }
  }

  const setClause = fields.map((field) => `${PATCH_COLUMN_BY_FIELD[field]} = ?`).join(", ")
  const values = fields.map((field) => patch[field] ?? null)
  const optionsGuard = touchesOptions ? " AND used_in_quiz_id IS NULL" : ""
  await db
    .prepare(`UPDATE questions SET ${setClause} WHERE id = ?${optionsGuard}`)
    .bind(...values, id)
    .run()

  const row = await db
    .prepare(`SELECT ${QUESTION_JOIN_PASSAGE_SELECT} ${QUESTION_JOIN_PASSAGE_FROM} WHERE q.id = ?`)
    .bind(id)
    .first<JoinedQuestionRow>()
  return { ok: true, question: toQuestionFull(row as JoinedQuestionRow) }
}

export type DeleteOutcome = { ok: true; deletedImageKeys: string[] } | { ok: false; reason: "not_found" | "used" }

export async function deleteQuestionCascade(db: D1Database, id: string): Promise<DeleteOutcome> {
  const target = await db
    .prepare("SELECT id, passage_id, used_in_quiz_id, image_key FROM questions WHERE id = ?")
    .bind(id)
    .first<{ id: string; passage_id: string | null; used_in_quiz_id: string | null; image_key: string | null }>()
  if (!target) return { ok: false, reason: "not_found" }

  if (target.passage_id === null) {
    if (target.used_in_quiz_id !== null) return { ok: false, reason: "used" }
    await db.prepare("DELETE FROM questions WHERE id = ?").bind(id).run()
    return { ok: true, deletedImageKeys: target.image_key ? [target.image_key] : [] }
  }

  const { results: siblings } = await db
    .prepare("SELECT id, used_in_quiz_id, image_key FROM questions WHERE passage_id = ?")
    .bind(target.passage_id)
    .all<{ id: string; used_in_quiz_id: string | null; image_key: string | null }>()
  if (siblings.some((s) => s.used_in_quiz_id !== null)) return { ok: false, reason: "used" }

  const passage = await db
    .prepare("SELECT image_key FROM passages WHERE id = ?")
    .bind(target.passage_id)
    .first<{ image_key: string | null }>()

  await db.batch([
    db.prepare("DELETE FROM questions WHERE passage_id = ?").bind(target.passage_id),
    db.prepare("DELETE FROM passages WHERE id = ?").bind(target.passage_id),
  ])

  const deletedImageKeys = [...siblings.map((s) => s.image_key), passage?.image_key ?? null].filter(
    (key): key is string => key !== null
  )
  return { ok: true, deletedImageKeys }
}
