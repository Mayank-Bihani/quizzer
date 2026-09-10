// Pure request validation/canonicalization for the one final unit batch — QUIZZING.md §5.
// Zero platform imports: hashing the canonical bytes is the caller's job (injected hasher).

import type { QuestionFormat, UnitAnswer } from "./contracts"
import { MAX_SUBMISSION_ID_BYTES, MAX_UNIT_ANSWERS } from "./config"

export type UnitManifestEntry = { position: number; format: QuestionFormat }

// Wire-level close reason from SubmitUnitRequest (src/core/api.ts) — distinct from the persisted
// UnitCloseReason ('completed'/'timed_out'); the service layer maps one to the other.
export type SubmitReason = "complete" | "timeout"

export type ParsedSubmission = {
  submissionId: string
  reason: SubmitReason
  answers: UnitAnswer[] // exactly one per manifest position
}

export type SubmissionValidationResult = { ok: true; parsed: ParsedSubmission } | { ok: false }

const submissionIdBytes = new TextEncoder()

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function keysMatch(obj: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(obj).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length && actual.every((k, i) => k === sortedExpected[i])
}

function parseAnswerEntry(raw: unknown, manifestByPosition: Map<number, QuestionFormat>): UnitAnswer | null {
  if (!isPlainObject(raw)) return null
  if (typeof raw.position !== "number" || !Number.isInteger(raw.position)) return null
  const expectedFormat = manifestByPosition.get(raw.position)
  if (expectedFormat === undefined) return null // foreign position, not in this unit

  if (raw.status === "skipped" || raw.status === "unanswered") {
    if (!keysMatch(raw, ["position", "status"])) return null // no response data allowed
    return { position: raw.position, status: raw.status }
  }

  if (raw.status === "answered") {
    if (raw.format === "mcq") {
      if (expectedFormat !== "mcq") return null
      if (!keysMatch(raw, ["position", "status", "format", "chosenOption"])) return null
      if (raw.chosenOption !== "A" && raw.chosenOption !== "B" && raw.chosenOption !== "C" && raw.chosenOption !== "D") return null
      return { position: raw.position, status: "answered", format: "mcq", chosenOption: raw.chosenOption }
    }
    if (raw.format === "tita") {
      if (expectedFormat !== "tita") return null
      if (!keysMatch(raw, ["position", "status", "format", "numericValue"])) return null
      if (typeof raw.numericValue !== "number" || !Number.isFinite(raw.numericValue)) return null
      return { position: raw.position, status: "answered", format: "tita", numericValue: raw.numericValue }
    }
    return null
  }

  return null
}

export function parseSubmitUnitRequest(body: unknown, manifest: UnitManifestEntry[]): SubmissionValidationResult {
  if (!isPlainObject(body)) return { ok: false }
  if (!keysMatch(body, ["submissionId", "reason", "answers"])) return { ok: false }

  if (typeof body.submissionId !== "string") return { ok: false }
  const idByteLength = submissionIdBytes.encode(body.submissionId).length
  if (idByteLength === 0 || idByteLength > MAX_SUBMISSION_ID_BYTES) return { ok: false }

  if (body.reason !== "complete" && body.reason !== "timeout") return { ok: false }

  if (!Array.isArray(body.answers)) return { ok: false }
  if (body.answers.length !== manifest.length || body.answers.length > MAX_UNIT_ANSWERS) return { ok: false }

  const manifestByPosition = new Map(manifest.map((m) => [m.position, m.format]))
  const seenPositions = new Set<number>()
  const answers: UnitAnswer[] = []
  for (const raw of body.answers) {
    const parsedEntry = parseAnswerEntry(raw, manifestByPosition)
    if (!parsedEntry) return { ok: false }
    if (seenPositions.has(parsedEntry.position)) return { ok: false }
    seenPositions.add(parsedEntry.position)
    if (body.reason === "complete" && parsedEntry.status === "unanswered") return { ok: false }
    answers.push(parsedEntry)
  }
  if (seenPositions.size !== manifestByPosition.size) return { ok: false } // every manifest member covered

  return { ok: true, parsed: { submissionId: body.submissionId, reason: body.reason, answers } }
}

export function canonicalizeSubmission(parsed: ParsedSubmission): string {
  const sorted = [...parsed.answers].sort((a, b) => a.position - b.position)
  const normalized = sorted.map((answer) => {
    if (answer.status === "answered" && answer.format === "tita") {
      // -0 and 0 are the same submitted value; never let float sign divide identical retries.
      return { ...answer, numericValue: answer.numericValue === 0 ? 0 : answer.numericValue }
    }
    return answer
  })
  return JSON.stringify({ reason: parsed.reason, answers: normalized })
}
