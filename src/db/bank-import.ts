// Chunked, import_id-compensated commit of parsed passages/questions — BANK.md §3.3.

import type { ImportCounts } from "../core/api"
import { IMPORT_BATCH_ROWS } from "../core/config"

export type PassageInsert = {
  passageRef: string
  type: string
  topic: string
  bodyMd: string
  imageKey: string | null
  source: string | null
}

export type QuestionInsert = {
  type: string
  topic: string
  subtopic: string | null
  difficulty: string
  format: string
  passageRef: string | null
  groupPosition: number | null
  bodyMd: string
  imageKey: string | null
  optionA: string | null
  optionB: string | null
  optionC: string | null
  optionD: string | null
  correctOption: string | null
  numericAnswer: number | null
  numericTolerance: number | null
  explanationMd: string
  source: string | null
}

export type ImportCandidate = { passages: PassageInsert[]; questions: QuestionInsert[] }

export class ImportCleanupFailedError extends Error {
  constructor(
    readonly importId: string,
    readonly stage: "questions" | "passages",
    readonly cause: unknown
  ) {
    super("import cleanup failed; forward repair required")
    this.name = "ImportCleanupFailedError"
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

/** Idempotent: safe to call again after a partial prior cleanup. */
export async function deleteImportRows(db: D1Database, importId: string): Promise<void> {
  try {
    await db.prepare("DELETE FROM questions WHERE import_id = ?").bind(importId).run()
  } catch (cause) {
    throw new ImportCleanupFailedError(importId, "questions", cause)
  }
  try {
    await db.prepare("DELETE FROM passages WHERE import_id = ?").bind(importId).run()
  } catch (cause) {
    throw new ImportCleanupFailedError(importId, "passages", cause)
  }
}

function buildCounts(candidate: ImportCandidate): ImportCounts {
  const byType: ImportCounts["byType"] = { verbal: 0, quant: 0, lr: 0 }
  const byFormat: ImportCounts["byFormat"] = { mcq: 0, tita: 0 }
  for (const question of candidate.questions) {
    byType[question.type as keyof typeof byType]++
    byFormat[question.format as keyof typeof byFormat]++
  }
  return {
    questions: candidate.questions.length,
    passages: candidate.passages.length,
    byType,
    byFormat,
  }
}

export async function commitImport(
  db: D1Database,
  importId: string,
  candidate: ImportCandidate,
  createdBy: string,
  now: () => number
): Promise<{ importId: string; counts: ImportCounts }> {
  const createdAt = now()
  const passageIds = new Map<string, string>()
  for (const passage of candidate.passages) passageIds.set(passage.passageRef, crypto.randomUUID())

  const passageStatements = candidate.passages.map((passage) => {
    const id = passageIds.get(passage.passageRef)
    return db
      .prepare(
        `INSERT INTO passages (id, type, topic, title, body_md, image_key, source, import_id, created_by, created_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, passage.type, passage.topic, passage.bodyMd, passage.imageKey, passage.source, importId, createdBy, createdAt)
  })

  const questionStatements = candidate.questions.map((question) => {
    const resolvedPassageId = question.passageRef ? (passageIds.get(question.passageRef) ?? null) : null
    return db
      .prepare(
        `INSERT INTO questions (
           id, type, topic, subtopic, difficulty, format, passage_id, group_position, body_md,
           image_key, option_a, option_b, option_c, option_d, correct_option, numeric_answer,
           numeric_tolerance, explanation_md, source, import_id, created_by, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        question.type,
        question.topic,
        question.subtopic,
        question.difficulty,
        question.format,
        resolvedPassageId,
        question.groupPosition,
        question.bodyMd,
        question.imageKey,
        question.optionA,
        question.optionB,
        question.optionC,
        question.optionD,
        question.correctOption,
        question.numericAnswer,
        question.numericTolerance,
        question.explanationMd,
        question.source,
        importId,
        createdBy,
        createdAt
      )
  })

  try {
    for (const batch of chunk(passageStatements, IMPORT_BATCH_ROWS)) await db.batch(batch)
    for (const batch of chunk(questionStatements, IMPORT_BATCH_ROWS)) await db.batch(batch)
  } catch {
    await deleteImportRows(db, importId) // may itself throw ImportCleanupFailedError — let it propagate
    throw new Error("import failed and was rolled back")
  }

  return { importId, counts: buildCounts(candidate) }
}
