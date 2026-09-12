// Shared D1 row shapes and QuestionFull/PassageSummary mappers for the BANK persistence files —
// kept in one place so imageUrl derivation and field allowlisting never drift between them.

import type { Difficulty, PassageContent, QuestionFormat, QuestionFull, QuizType } from "../core/contracts"
import type { PassageSummary } from "../core/api"
import { imageUrl } from "../services/images"

export type QuestionRow = {
  id: string
  type: QuizType
  topic: string
  subtopic: string | null
  difficulty: Difficulty
  format: QuestionFormat
  passage_id: string | null
  group_position: number | null
  body_md: string
  image_key: string | null
  option_a: string | null
  option_b: string | null
  option_c: string | null
  option_d: string | null
  correct_option: "A" | "B" | "C" | "D" | null
  numeric_answer: number | null
  numeric_tolerance: number | null
  explanation_md: string
  source: string | null
  used_in_quiz_id: string | null
  used_in_quiz_number: number | null
}

export type PassageRow = {
  id: string
  type: QuizType
  topic: string
  title: string | null
  body_md: string
  image_key: string | null
  source: string | null
  used_in_quiz_id: string | null
}

// Question browse/detail queries LEFT JOIN passages with this exact alias prefix so one query
// avoids N+1 passage reads.
export const QUESTION_JOIN_PASSAGE_SELECT = `
  q.id, q.type, q.topic, q.subtopic, q.difficulty, q.format, q.passage_id, q.group_position,
  q.body_md, q.image_key, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option,
  q.numeric_answer, q.numeric_tolerance, q.explanation_md, q.source, q.used_in_quiz_id,
  q.used_in_quiz_number,
  p.title AS p_title, p.body_md AS p_body_md, p.image_key AS p_image_key
`
export const QUESTION_JOIN_PASSAGE_FROM = "FROM questions q LEFT JOIN passages p ON p.id = q.passage_id"

export type JoinedQuestionRow = QuestionRow & {
  p_title: string | null
  p_body_md: string | null
  p_image_key: string | null
}

export function toPassageContent(row: JoinedQuestionRow): PassageContent | null {
  if (row.passage_id === null || row.p_body_md === null) return null
  return {
    title: row.p_title,
    bodyMd: row.p_body_md,
    imageUrl: row.p_image_key ? imageUrl(row.p_image_key) : null,
  }
}

export function toQuestionFull(row: JoinedQuestionRow): QuestionFull {
  return {
    id: row.id,
    type: row.type,
    topic: row.topic,
    subtopic: row.subtopic,
    difficulty: row.difficulty,
    format: row.format,
    passageId: row.passage_id,
    groupPosition: row.group_position,
    bodyMd: row.body_md,
    imageUrl: row.image_key ? imageUrl(row.image_key) : null,
    optionA: row.option_a,
    optionB: row.option_b,
    optionC: row.option_c,
    optionD: row.option_d,
    correctOption: row.correct_option,
    numericAnswer: row.numeric_answer,
    numericTolerance: row.numeric_tolerance,
    explanationMd: row.explanation_md,
    source: row.source,
    usedInQuizId: row.used_in_quiz_id,
    passage: toPassageContent(row),
  }
}

export function toPassageSummary(row: PassageRow): PassageSummary {
  return {
    id: row.id,
    type: row.type,
    topic: row.topic,
    title: row.title,
    bodyMd: row.body_md,
    imageUrl: row.image_key ? imageUrl(row.image_key) : null,
    source: row.source,
    usedInQuizId: row.used_in_quiz_id,
  }
}
