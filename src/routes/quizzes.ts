// Admin quiz list/create/reshuffle/PATCH/lock/cancel; explicit units and timing policy, no direct windowSec or bonus settings; reject edits once open — API.md; QUIZZING.md §4.

import { Hono } from "hono"
import type { Context } from "hono"
import type { Bindings, Variables } from "../core/config"
import { DEFAULT_PAGE_LIMIT, MAX_GRADED_QUESTION_COUNT, MAX_PAGE_LIMIT } from "../core/config"
import type { Difficulty, QuizStatus, QuizType, UnitKind } from "../core/contracts"
import type { ListQuizzesResponse, UpdateQuizParamsRequest } from "../core/api"
import { listQuizzesPage } from "../db/quizzes"
import {
  cancel,
  createDraft,
  lockQuiz,
  patchSettings,
  reshuffleDraft,
  type CreateInput,
  type CreationDeps,
} from "../services/quiz-creation"
import type { ManualDrawFailureReason } from "../core/selection"
import { currentUser, requireRole } from "../middleware/auth"

type Env = { Bindings: Bindings; Variables: Variables }

const quizzes = new Hono<Env>()
quizzes.use("*", requireRole("admin"))

function creationDeps(c: Context<Env>): CreationDeps {
  return { db: c.env.DB, bank: c.get("bank"), now: () => Date.now(), random: () => Math.random() }
}

function parsePaginationParam(raw: string | undefined, fallback: number): number | "invalid" {
  if (raw === undefined) return fallback
  if (!/^-?\d+$/.test(raw)) return "invalid"
  return Number(raw)
}

const VALID_TYPES: readonly QuizType[] = ["verbal", "quant", "lr"]
const VALID_DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"]
const VALID_STATUSES: readonly QuizStatus[] = ["draft", "scheduled", "open", "ended", "cancelled"]
const VALID_UNIT_KINDS: readonly UnitKind[] = ["standalone", "rc", "lrdi"]

function parseDifficultyMix(raw: unknown): Partial<Record<Difficulty, number>> | "invalid" {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "invalid"
  const mix: Partial<Record<Difficulty, number>> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!VALID_DIFFICULTIES.includes(key as Difficulty)) return "invalid"
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return "invalid"
    mix[key as Difficulty] = value
  }
  return mix
}

function mixSum(mix: Partial<Record<Difficulty, number>>): number {
  return Object.values(mix).reduce((sum: number, v) => sum + (v ?? 0), 0)
}

function isValidCount(value: unknown, min: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= MAX_GRADED_QUESTION_COUNT
}

const INVALID_SELECTION_MESSAGES: Record<ManualDrawFailureReason, string> = {
  unknown_question: "One or more selected questions are no longer in the unused pool",
  duplicate_question: "questionIds contains a duplicate",
  partial_group: "A passage/LRDI group must be selected in full, or not at all",
  empty_selection: "questionIds must not be empty",
}

quizzes.get("/", async (c) => {
  const limitRaw = parsePaginationParam(c.req.query("limit"), DEFAULT_PAGE_LIMIT)
  const offsetRaw = parsePaginationParam(c.req.query("offset"), 0)
  if (limitRaw === "invalid" || offsetRaw === "invalid" || limitRaw < 1 || limitRaw > MAX_PAGE_LIMIT || offsetRaw < 0) {
    return c.json({ message: "Invalid pagination parameters" }, 400)
  }
  const status = c.req.query("status")
  if (status !== undefined && !VALID_STATUSES.includes(status as QuizStatus)) {
    return c.json({ message: "Invalid status filter" }, 400)
  }

  const { items, total } = await listQuizzesPage(c.env.DB, { status: status as QuizStatus | undefined }, limitRaw, offsetRaw)
  const body: ListQuizzesResponse = { items, total, limit: limitRaw, offset: offsetRaw }
  return c.json(body, 200)
})

quizzes.post("/", async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ message: "Invalid request body" }, 400)
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return c.json({ message: "Invalid request body" }, 400)
  const b = body as Record<string, unknown>
  const allowedFields = [
    "title",
    "scheduledAt",
    "type",
    "difficultyMix",
    "count",
    "setCount",
    "standaloneCount",
    "standaloneDifficultyMix",
    "mode",
    "questionIds",
  ]
  if (Object.keys(b).some((k) => !allowedFields.includes(k))) return c.json({ message: "Unknown field" }, 400)

  if (typeof b.title !== "string" || b.title.trim().length === 0) return c.json({ message: "Invalid title" }, 400)
  if (typeof b.scheduledAt !== "number" || !Number.isFinite(b.scheduledAt) || !Number.isInteger(b.scheduledAt)) {
    return c.json({ message: "Invalid scheduledAt" }, 400)
  }
  if (typeof b.type !== "string" || !VALID_TYPES.includes(b.type as QuizType)) return c.json({ message: "Invalid type" }, 400)
  if (b.mode !== undefined && b.mode !== "auto" && b.mode !== "manual") return c.json({ message: "Invalid mode" }, 400)
  const mode = (b.mode as "auto" | "manual" | undefined) ?? "auto"

  let input: CreateInput
  if (mode === "manual") {
    if (
      b.difficultyMix !== undefined ||
      b.count !== undefined ||
      b.setCount !== undefined ||
      b.standaloneCount !== undefined ||
      b.standaloneDifficultyMix !== undefined
    ) {
      return c.json({ message: "Draw-request fields are not accepted with mode: manual" }, 400)
    }
    if (
      !Array.isArray(b.questionIds) ||
      b.questionIds.length === 0 ||
      b.questionIds.length > MAX_GRADED_QUESTION_COUNT ||
      !b.questionIds.every((v) => typeof v === "string")
    ) {
      return c.json({ message: "Invalid questionIds" }, 400)
    }
    input = {
      mode: "manual",
      title: b.title.trim(),
      scheduledAt: b.scheduledAt,
      type: b.type as QuizType,
      questionIds: b.questionIds as string[],
    }
  } else if (b.questionIds !== undefined) {
    return c.json({ message: "questionIds is only accepted with mode: manual" }, 400)
  } else if (b.type === "quant") {
    if (b.setCount !== undefined || b.standaloneCount !== undefined || b.standaloneDifficultyMix !== undefined) {
      return c.json({ message: "setCount/standaloneCount/standaloneDifficultyMix are only accepted for type verbal/lr" }, 400)
    }
    if (!isValidCount(b.count, 1)) return c.json({ message: "Invalid count" }, 400)
    const difficultyMix = parseDifficultyMix(b.difficultyMix)
    if (difficultyMix === "invalid") return c.json({ message: "Invalid difficultyMix" }, 400)
    // A difficulty omitted from difficultyMix isn't excluded — the shortfall is drawn from any
    // difficulty (src/core/selection.ts). Only an over-specified mix (sum > count) is invalid.
    if (mixSum(difficultyMix) > b.count) return c.json({ message: "difficultyMix must not exceed count" }, 400)
    input = { mode: "auto", title: b.title.trim(), scheduledAt: b.scheduledAt, type: "quant", count: b.count, difficultyMix }
  } else if (b.type === "lr") {
    if (b.count !== undefined || b.difficultyMix !== undefined || b.standaloneCount !== undefined || b.standaloneDifficultyMix !== undefined) {
      return c.json({ message: "lr accepts only setCount — it is always whole LRDI sets, never standalone questions" }, 400)
    }
    // lr is always fully grouped: "1" means 1 whole LRDI set, never 1 question (the bug this fixes).
    if (!isValidCount(b.setCount, 1)) return c.json({ message: "Invalid setCount" }, 400)
    input = { mode: "auto", title: b.title.trim(), scheduledAt: b.scheduledAt, type: "lr", setCount: b.setCount }
  } else if (b.type === "verbal") {
    if (b.count !== undefined || b.difficultyMix !== undefined) {
      return c.json({ message: "verbal uses setCount (RC passages) + standaloneCount/standaloneDifficultyMix (VA questions), not count/difficultyMix" }, 400)
    }
    // setCount is RC passages, standaloneCount is standalone VA questions — independent asks, so
    // "1" for one and "0" for the other means exactly that, never a substitution of one for the
    // other (the bug this fixes: count=1 used to silently grab a lone VA question over a passage).
    if (!isValidCount(b.setCount, 0)) return c.json({ message: "Invalid setCount" }, 400)
    if (!isValidCount(b.standaloneCount, 0)) return c.json({ message: "Invalid standaloneCount" }, 400)
    if (b.setCount === 0 && b.standaloneCount === 0) return c.json({ message: "setCount and standaloneCount cannot both be 0" }, 400)
    const standaloneDifficultyMix = parseDifficultyMix(b.standaloneDifficultyMix)
    if (standaloneDifficultyMix === "invalid") return c.json({ message: "Invalid standaloneDifficultyMix" }, 400)
    if (mixSum(standaloneDifficultyMix) > b.standaloneCount) {
      return c.json({ message: "standaloneDifficultyMix must not exceed standaloneCount" }, 400)
    }
    input = {
      mode: "auto",
      title: b.title.trim(),
      scheduledAt: b.scheduledAt,
      type: "verbal",
      setCount: b.setCount,
      standaloneCount: b.standaloneCount,
      standaloneDifficultyMix,
    }
  } else {
    return c.json({ message: "Invalid type" }, 400)
  }

  const result = await createDraft(creationDeps(c), currentUser(c).id, input)
  if (result.kind === "pool_exhausted") {
    return c.json({ message: "No exact whole-unit composition is available for this request" }, 409)
  }
  if (result.kind === "invalid_selection") {
    return c.json({ message: INVALID_SELECTION_MESSAGES[result.reason] }, 400)
  }
  return c.json(result.response, 200)
})

quizzes.post("/:id/reshuffle", async (c) => {
  const result = await reshuffleDraft(creationDeps(c), c.req.param("id"))
  if (result.kind === "not_found") return c.json({ message: "Quiz not found" }, 404)
  if (result.kind === "conflict") return c.json({ message: "Quiz is already locked" }, 409)
  if (result.kind === "pool_exhausted") {
    return c.json({ message: "No exact whole-unit composition is available for this request" }, 409)
  }
  if (result.kind === "manual_locked") {
    return c.json({ message: "Manual drafts cannot be reshuffled" }, 409)
  }
  return c.json(result.response, 200)
})

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const PATCH_ALLOWED_FIELDS = [
  "title",
  "scheduledAt",
  "joinWindowSec",
  "timingPolicy",
  "unitTimeLimits",
  "slackSec",
  "marksCorrect",
  "marksWrong",
  "seatCap",
]

function validatePatchBody(body: unknown): string | null {
  if (!isPlainObject(body)) return "Invalid request body"
  const keys = Object.keys(body)
  if (keys.length === 0) return "Request body must not be empty"
  if (keys.some((k) => !PATCH_ALLOWED_FIELDS.includes(k))) return "Unknown field"
  if (keys.some((k) => body[k] === null)) return "Null is not a valid value for any field"

  if ("title" in body && typeof body.title !== "string") return "Invalid title"
  if ("scheduledAt" in body && (typeof body.scheduledAt !== "number" || !Number.isFinite(body.scheduledAt))) {
    return "Invalid scheduledAt"
  }
  for (const field of ["joinWindowSec", "slackSec", "marksCorrect", "marksWrong", "seatCap"] as const) {
    if (field in body && typeof body[field] !== "number") return `Invalid ${field}`
  }
  if ("timingPolicy" in body) {
    if (!isPlainObject(body.timingPolicy)) return "Invalid timingPolicy"
    for (const [kind, value] of Object.entries(body.timingPolicy)) {
      if (!VALID_UNIT_KINDS.includes(kind as UnitKind)) return "Invalid unit kind in timingPolicy"
      if (typeof value !== "number") return "Invalid timingPolicy value"
    }
  }
  if ("unitTimeLimits" in body) {
    if (!Array.isArray(body.unitTimeLimits)) return "Invalid unitTimeLimits"
    for (const item of body.unitTimeLimits) {
      if (!isPlainObject(item)) return "Invalid unitTimeLimits entry"
      const itemKeys = Object.keys(item).sort()
      if (itemKeys.join(",") !== "timeLimitSec,unitPosition") return "Invalid unitTimeLimits entry shape"
      if (typeof item.unitPosition !== "number" || typeof item.timeLimitSec !== "number") {
        return "Invalid unitTimeLimits entry values"
      }
    }
  }
  return null
}

quizzes.patch("/:id", async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ message: "Invalid request body" }, 400)
  }
  const error = validatePatchBody(body)
  if (error) return c.json({ message: error }, 400)

  const result = await patchSettings(creationDeps(c), c.req.param("id"), body as UpdateQuizParamsRequest)
  if (result.kind === "not_found") return c.json({ message: "Quiz not found" }, 404)
  if (result.kind === "conflict") return c.json({ message: "Settings can only change while draft or scheduled" }, 409)
  if (result.kind === "invalid") return c.json({ message: "Invalid settings" }, 400)
  return c.json(result.summary, 200)
})

quizzes.post("/:id/lock", async (c) => {
  const result = await lockQuiz(creationDeps(c), c.req.param("id"))
  if (result.kind === "not_found") return c.json({ message: "Quiz not found" }, 404)
  if (result.kind === "conflict") return c.json({ message: "Quiz is already locked" }, 409)
  if (result.kind === "invalid") return c.json({ message: "Quiz settings are incomplete" }, 400)
  return c.json(result.response, 200)
})

quizzes.post("/:id/cancel", async (c) => {
  const result = await cancel(creationDeps(c), c.req.param("id"))
  if (result.kind === "not_found") return c.json({ message: "Quiz not found" }, 404)
  if (result.kind === "conflict") return c.json({ message: "Quiz cannot be cancelled from its current status" }, 409)
  return c.json(result.summary, 200)
})

export default quizzes
