// CSV parse + validate, pure (string in, validated structure or errors by line out) — PLAN.md §"Question bank / CSV format"; BANK.md §3

import Papa from "papaparse"
import type { Difficulty, QuestionFormat, QuizType } from "./contracts"

const CANONICAL_COLUMNS = [
  "type",
  "topic",
  "subtopic",
  "difficulty",
  "format",
  "passage_ref",
  "body",
  "image",
  "option_a",
  "option_b",
  "option_c",
  "option_d",
  "correct",
  "numeric_answer",
  "tolerance",
  "explanation",
  "source",
] as const

const TYPES: readonly QuizType[] = ["verbal", "quant", "lr"]
const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"]
const OPTION_LETTERS = ["A", "B", "C", "D"] as const
const GROUP_MIN_SIZE = 4
const GROUP_MAX_SIZE = 5

export type ImportRowError = { line: number; message: string }

export type NormalizedPassage = {
  passageRef: string
  type: QuizType
  topic: string
  bodyMd: string
  imageFilename: string | null
  source: string | null
  line: number
}

export type NormalizedQuestion = {
  type: QuizType
  topic: string
  subtopic: string | null
  difficulty: Difficulty
  format: QuestionFormat
  passageRef: string | null
  groupPosition: number | null
  bodyMd: string
  imageFilename: string | null
  optionA: string | null
  optionB: string | null
  optionC: string | null
  optionD: string | null
  correctOption: "A" | "B" | "C" | "D" | null
  numericAnswer: number | null
  numericTolerance: number | null
  explanationMd: string
  source: string | null
  line: number
}

export type ParsedImport = {
  passages: NormalizedPassage[]
  questions: NormalizedQuestion[]
  imageReferences: { filename: string; line: number }[]
  errors: ImportRowError[]
}

type Cells = Record<(typeof CANONICAL_COLUMNS)[number], string>

/**
 * For each record index (0 = header, 1 = first data row, ...), the physical 1-based line on
 * which that record starts. A quoted field may embed literal newlines, so a record's start line
 * is not simply its record index + 1 — this walks the raw text tracking quote state to find it.
 */
function computeRecordStartLines(text: string): number[] {
  const starts = [1]
  let line = 1
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        i++ // escaped quote, stays inside the field
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (ch === "\n") {
      line++
      if (!inQuotes) starts.push(line)
    }
  }
  return starts
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function isQuizType(value: string): value is QuizType {
  return (TYPES as readonly string[]).includes(value)
}

function isDifficulty(value: string): value is Difficulty {
  return (DIFFICULTIES as readonly string[]).includes(value)
}

function isOptionLetter(value: string): value is "A" | "B" | "C" | "D" {
  return (OPTION_LETTERS as readonly string[]).includes(value)
}

function validateHeader(headerRow: string[]): ImportRowError[] {
  const errors: ImportRowError[] = []
  for (const column of CANONICAL_COLUMNS) {
    const occurrences = headerRow.filter((h) => h.trim() === column).length
    if (occurrences === 0) errors.push({ line: 0, message: `Missing required column "${column}"` })
    else if (occurrences > 1) errors.push({ line: 0, message: `Duplicate column "${column}"` })
  }
  return errors
}

function cellsFromRow(headerRow: string[], dataRow: string[]): Cells {
  const cells = {} as Cells
  for (const column of CANONICAL_COLUMNS) {
    const index = headerRow.findIndex((h) => h.trim() === column)
    cells[column] = index === -1 ? "" : (dataRow[index] ?? "").trim()
  }
  return cells
}

function validatePassageRow(cells: Cells, line: number): { passage: NormalizedPassage | null; errors: ImportRowError[] } {
  const errors: ImportRowError[] = []
  const type = cells.type
  const body = blankToNull(cells.body)
  const passageRef = blankToNull(cells.passage_ref)

  if (!isQuizType(type)) errors.push({ line, message: `Invalid type "${type}"` })
  if (!body) errors.push({ line, message: "Passage body must not be empty" })
  if (!passageRef) errors.push({ line, message: "Passage row must set passage_ref" })

  const hasOptionsOrAnswer =
    cells.option_a || cells.option_b || cells.option_c || cells.option_d || cells.correct
  if (hasOptionsOrAnswer) errors.push({ line, message: "Passage row must leave options/answer blank" })

  if (errors.length > 0 || !isQuizType(type) || !body || !passageRef) {
    return { passage: null, errors }
  }

  return {
    passage: {
      passageRef,
      type,
      topic: cells.topic.trim(),
      bodyMd: body,
      imageFilename: blankToNull(cells.image),
      source: blankToNull(cells.source),
      line,
    },
    errors: [],
  }
}

function validateQuestionRow(
  cells: Cells,
  line: number
): { question: NormalizedQuestion | null; errors: ImportRowError[] } {
  const errors: ImportRowError[] = []
  const type = cells.type
  const format = cells.format
  const body = blankToNull(cells.body)
  const explanation = blankToNull(cells.explanation)

  if (!isQuizType(type)) errors.push({ line, message: `Invalid type "${type}"` })
  if (!isDifficulty(cells.difficulty)) errors.push({ line, message: `Invalid difficulty "${cells.difficulty}"` })
  if (!body) errors.push({ line, message: "Question body must not be empty" })
  if (!explanation) errors.push({ line, message: "Question explanation must not be empty" })

  let correctOption: "A" | "B" | "C" | "D" | null = null
  let numericAnswer: number | null = null
  let numericTolerance: number | null = null

  if (format === "mcq") {
    const options = [cells.option_a, cells.option_b, cells.option_c, cells.option_d]
    if (options.some((o) => o.trim().length === 0)) {
      errors.push({ line, message: "MCQ rows require exactly 4 non-empty options" })
    }
    if (!isOptionLetter(cells.correct)) {
      errors.push({ line, message: `MCQ "correct" must be one of A-D, got "${cells.correct}"` })
    } else {
      correctOption = cells.correct
    }
    if (cells.numeric_answer || cells.tolerance) {
      errors.push({ line, message: "MCQ rows must leave numeric_answer/tolerance blank" })
    }
  } else if (format === "tita") {
    const parsedAnswer = Number(cells.numeric_answer)
    if (cells.numeric_answer.trim().length === 0 || !Number.isFinite(parsedAnswer)) {
      errors.push({ line, message: `TITA numeric_answer must be a number, got "${cells.numeric_answer}"` })
    } else {
      numericAnswer = parsedAnswer
    }
    const parsedTolerance = Number(cells.tolerance)
    if (cells.tolerance.trim().length === 0 || !Number.isFinite(parsedTolerance) || parsedTolerance < 0) {
      errors.push({ line, message: `TITA tolerance must be a non-negative number, got "${cells.tolerance}"` })
    } else {
      numericTolerance = parsedTolerance
    }
    if (cells.option_a || cells.option_b || cells.option_c || cells.option_d || cells.correct) {
      errors.push({ line, message: "TITA rows must leave options/correct blank" })
    }
  } else {
    errors.push({ line, message: `Invalid format "${format}"` })
  }

  if (errors.length > 0 || !isQuizType(type) || !isDifficulty(cells.difficulty) || !body || !explanation) {
    return { question: null, errors }
  }

  return {
    question: {
      type,
      topic: cells.topic.trim(),
      subtopic: blankToNull(cells.subtopic),
      difficulty: cells.difficulty,
      format: format as "mcq" | "tita",
      passageRef: blankToNull(cells.passage_ref),
      groupPosition: null, // assigned after grouping, below
      bodyMd: body,
      imageFilename: blankToNull(cells.image),
      optionA: format === "mcq" ? blankToNull(cells.option_a) : null,
      optionB: format === "mcq" ? blankToNull(cells.option_b) : null,
      optionC: format === "mcq" ? blankToNull(cells.option_c) : null,
      optionD: format === "mcq" ? blankToNull(cells.option_d) : null,
      correctOption,
      numericAnswer,
      numericTolerance,
      explanationMd: explanation,
      source: blankToNull(cells.source),
      line,
    },
    errors: [],
  }
}

export function parseBankCsv(rawText: string): ParsedImport {
  const text = stripBom(rawText)
  const errors: ImportRowError[] = []

  const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: "greedy" })
  const rows = parsed.data
  if (rows.length === 0) {
    return { passages: [], questions: [], imageReferences: [], errors: [{ line: 0, message: "File is empty" }] }
  }

  const headerRow = rows[0] ?? []
  const headerErrors = validateHeader(headerRow)
  errors.push(...headerErrors)
  if (headerErrors.some((e) => e.message.startsWith("Missing") || e.message.startsWith("Duplicate"))) {
    // A malformed header makes every cell lookup meaningless; stop here.
    return { passages: [], questions: [], imageReferences: [], errors }
  }

  const recordStartLines = computeRecordStartLines(text)
  const passages: NormalizedPassage[] = []
  const questions: NormalizedQuestion[] = []
  const imageReferences: { filename: string; line: number }[] = []
  // Every question-shaped row with a passage_ref, valid or not — group *size* is a property of
  // the physical rows present in the file, not just the subset that individually parsed clean.
  const rawGroupRows = new Map<string, { line: number; question: NormalizedQuestion | null }[]>()

  for (let recordIndex = 1; recordIndex < rows.length; recordIndex++) {
    const dataRow = rows[recordIndex] ?? []
    const line = recordStartLines[recordIndex] ?? recordIndex + 1
    const cells = cellsFromRow(headerRow, dataRow)

    if (cells.image) imageReferences.push({ filename: cells.image, line })

    if (cells.format === "passage") {
      const { passage, errors: rowErrors } = validatePassageRow(cells, line)
      errors.push(...rowErrors)
      if (passage) passages.push(passage)
    } else {
      const { question, errors: rowErrors } = validateQuestionRow(cells, line)
      errors.push(...rowErrors)
      if (question) questions.push(question)

      const passageRef = blankToNull(cells.passage_ref)
      if (passageRef) {
        const members = rawGroupRows.get(passageRef) ?? []
        members.push({ line, question })
        rawGroupRows.set(passageRef, members)
      }
    }
  }

  // Passage uniqueness, question -> passage resolution, and group size/section rules all need
  // the full picture, so they run once every row has been individually validated.
  const passagesByRef = new Map<string, NormalizedPassage>()
  for (const passage of passages) {
    if (passagesByRef.has(passage.passageRef)) {
      errors.push({ line: passage.line, message: `Duplicate passage_ref "${passage.passageRef}"` })
      continue
    }
    passagesByRef.set(passage.passageRef, passage)
  }

  for (const [ref, members] of rawGroupRows) {
    const passage = passagesByRef.get(ref)

    members.forEach((member, index) => {
      if (member.question) member.question.groupPosition = index + 1
    })

    for (const member of members) {
      if (!member.question) continue
      if (!passage) {
        errors.push({
          line: member.question.line,
          message: `passage_ref "${ref}" does not resolve to a passage row in this file`,
        })
      } else if (member.question.type !== passage.type) {
        errors.push({
          line: member.question.line,
          message: `Group member section "${member.question.type}" does not match passage "${ref}" section "${passage.type}"`,
        })
      }
    }

    // An unresolved passage_ref is already reported above; a phantom group has no size to check.
    if (passage && (members.length < GROUP_MIN_SIZE || members.length > GROUP_MAX_SIZE)) {
      errors.push({
        line: passage.line,
        message: `Group "${ref}" has ${members.length} questions; must have ${GROUP_MIN_SIZE}-${GROUP_MAX_SIZE}`,
      })
    }
  }

  errors.sort((a, b) => a.line - b.line)
  return { passages, questions, imageReferences, errors }
}

export type ZipInventoryEntry = { name: string; accepted: boolean; reason?: string }

export function validateImageReferences(
  references: { filename: string; line: number }[],
  zipInventory: ZipInventoryEntry[] | null
): ImportRowError[] {
  const errors: ImportRowError[] = []
  const byName = new Map((zipInventory ?? []).map((entry) => [entry.name, entry]))

  for (const ref of references) {
    if (!zipInventory) {
      errors.push({ line: ref.line, message: `Image "${ref.filename}" referenced but no companion ZIP was uploaded` })
      continue
    }
    const entry = byName.get(ref.filename)
    if (!entry) {
      errors.push({ line: ref.line, message: `Image "${ref.filename}" not found in the companion ZIP` })
    } else if (!entry.accepted) {
      errors.push({ line: ref.line, message: `Image "${ref.filename}" rejected: ${entry.reason ?? "invalid"}` })
    }
  }
  return errors
}
