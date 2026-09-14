// The three BankContract calls QUIZZING uses — CONTRACTS.md §3; src/core/contracts.ts:63-69.
// listUnused/getByIds are read-only; claimUnused is BANK's one write path from outside the
// module, and it is the only place `used_in_quiz_id`/`used_in_quiz_number` are ever set.

import type { BankContract, Difficulty, QuestionFull, SelectionFilters } from "../core/contracts"
import {
  QUESTION_JOIN_PASSAGE_FROM,
  QUESTION_JOIN_PASSAGE_SELECT,
  toQuestionFull,
  type JoinedQuestionRow,
} from "./bank-rows"

const ID_CHUNK_SIZE = 50 // stays comfortably under D1's bound SQL variable count
const ALL_DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"]

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ")
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

export async function listUnused(db: D1Database, filters: SelectionFilters): Promise<QuestionFull[]> {
  // A difficultyMix that doesn't cover the full count leaves a shortfall the selector fills from
  // any difficulty (src/core/selection.ts's `any` bucket) — so the candidate pool must span every
  // difficulty in that case, not just the ones explicitly named.
  const specifiedTotal = Object.values(filters.difficultyMix).reduce((sum: number, v) => sum + (v ?? 0), 0)
  const needsAnyDifficulty = specifiedTotal < filters.count
  const difficulties = needsAnyDifficulty ? ALL_DIFFICULTIES : Object.keys(filters.difficultyMix)

  // A pure-set request (e.g. lr, or verbal with no standalone VA questions) has count=0 and no
  // difficulties to filter by — that must skip only the standalone query, never the group query
  // below, which whole rc/lrdi groups always need regardless of any standalone filter.
  const topicClause = filters.topics.length > 0 ? ` AND q.topic IN (${placeholders(filters.topics.length)})` : ""
  const standaloneRows =
    filters.count > 0 && difficulties.length > 0
      ? await db
          .prepare(
            `SELECT ${QUESTION_JOIN_PASSAGE_SELECT} ${QUESTION_JOIN_PASSAGE_FROM}
             WHERE q.type = ? AND q.passage_id IS NULL AND q.used_in_quiz_id IS NULL
               AND q.difficulty IN (${placeholders(difficulties.length)})${topicClause}`
          )
          .bind(filters.type, ...difficulties, ...filters.topics)
          .all<JoinedQuestionRow>()
      : { results: [] as JoinedQuestionRow[] }

  // A complete group is one timed unit; it is included wholesale regardless of each member's
  // individual difficulty — difficultyMix scopes standalone composition, not whole-group draws.
  const groupRows = await db
    .prepare(
      `SELECT ${QUESTION_JOIN_PASSAGE_SELECT} ${QUESTION_JOIN_PASSAGE_FROM}
       WHERE q.type = ? AND q.passage_id IS NOT NULL AND q.used_in_quiz_id IS NULL
         AND q.passage_id NOT IN (
           SELECT DISTINCT passage_id FROM questions
           WHERE passage_id IS NOT NULL AND used_in_quiz_id IS NOT NULL
         )`
    )
    .bind(filters.type)
    .all<JoinedQuestionRow>()

  return [...standaloneRows.results, ...groupRows.results].map(toQuestionFull)
}

export async function claimUnused(
  db: D1Database,
  questionIds: string[],
  quizId: string,
  quizNumber: number
): Promise<string[]> {
  if (questionIds.length === 0) return []

  for (const idChunk of chunk(questionIds, ID_CHUNK_SIZE)) {
    const statements = idChunk.map((id) =>
      db
        .prepare(
          "UPDATE questions SET used_in_quiz_id = ?, used_in_quiz_number = ? WHERE id = ? AND used_in_quiz_id IS NULL"
        )
        .bind(quizId, quizNumber, id)
    )
    await db.batch(statements)
  }

  const confirmed: string[] = []
  const touchedPassageIds = new Set<string>()
  for (const idChunk of chunk(questionIds, ID_CHUNK_SIZE)) {
    const { results } = await db
      .prepare(
        `SELECT id, passage_id, used_in_quiz_id, used_in_quiz_number FROM questions WHERE id IN (${placeholders(idChunk.length)})`
      )
      .bind(...idChunk)
      .all<{ id: string; passage_id: string | null; used_in_quiz_id: string | null; used_in_quiz_number: number | null }>()
    const byId = new Map(results.map((r) => [r.id, r]))
    for (const id of idChunk) {
      const row = byId.get(id)
      if (row && row.used_in_quiz_id === quizId && row.used_in_quiz_number === quizNumber) {
        confirmed.push(id)
        if (row.passage_id) touchedPassageIds.add(row.passage_id)
      }
    }
  }

  for (const passageId of touchedPassageIds) {
    // Stamp only once every stored member of the passage belongs to this exact quiz — from
    // database membership, never from the caller's requested id list.
    await db
      .prepare(
        `UPDATE passages
         SET used_in_quiz_id = ?
         WHERE id = ? AND used_in_quiz_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM questions
             WHERE passage_id = ? AND (used_in_quiz_id IS NULL OR used_in_quiz_id != ?)
           )`
      )
      .bind(quizId, passageId, passageId, quizId)
      .run()
  }

  return confirmed
}

export async function getByIds(db: D1Database, questionIds: string[]): Promise<QuestionFull[]> {
  if (questionIds.length === 0) return []

  const byId = new Map<string, QuestionFull>()
  for (const idChunk of chunk(questionIds, ID_CHUNK_SIZE)) {
    const { results } = await db
      .prepare(
        `SELECT ${QUESTION_JOIN_PASSAGE_SELECT} ${QUESTION_JOIN_PASSAGE_FROM} WHERE q.id IN (${placeholders(idChunk.length)})`
      )
      .bind(...idChunk)
      .all<JoinedQuestionRow>()
    for (const row of results) byId.set(row.id, toQuestionFull(row))
  }

  const ordered: QuestionFull[] = []
  for (const id of questionIds) {
    const found = byId.get(id)
    if (found) ordered.push(found) // a missing id is simply omitted, never a malformed entry
  }
  return ordered
}

export function createBankContract(db: D1Database): BankContract {
  return {
    listUnused: (filters) => listUnused(db, filters),
    claimUnused: (questionIds, quizId, quizNumber) => claimUnused(db, questionIds, quizId, quizNumber),
    getByIds: (questionIds) => getByIds(db, questionIds),
  }
}
