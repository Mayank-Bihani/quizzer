// Admin CRUD for recurring quiz_templates — QUIZZING.md §4.4; API.md "QUIZZING — templates".
// Feeds Sprint 7's materializeTemplates; never edits it or getActiveTemplates/TemplateRow.

import { Hono } from "hono"
import type { Context } from "hono"
import type { Bindings, Variables } from "../core/config"
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../core/config"
import type { Difficulty, QuizType, UnitKind } from "../core/contracts"
import type { CreateTemplateRequest, ListTemplatesResponse, UpdateTemplateRequest } from "../core/api"
import { createTemplate, deactivateTemplate, listTemplates, patchTemplate, type TemplateDeps } from "../services/templates"
import { currentUser, requireRole } from "../middleware/auth"

type Env = { Bindings: Bindings; Variables: Variables }

const templates = new Hono<Env>()
templates.use("*", requireRole("admin"))

function templateDeps(c: Context<Env>): TemplateDeps {
  return { db: c.env.DB, now: () => Date.now() }
}

function parsePaginationParam(raw: string | undefined, fallback: number): number | "invalid" {
  if (raw === undefined) return fallback
  if (!/^-?\d+$/.test(raw)) return "invalid"
  return Number(raw)
}

const VALID_TYPES: readonly QuizType[] = ["verbal", "quant", "lr"]
const VALID_DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"]
const VALID_UNIT_KINDS: readonly UnitKind[] = ["standalone", "rc", "lrdi"]

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function checkDifficultyMix(value: unknown): string | null {
  if (!isPlainObject(value)) return "Invalid difficultyMix"
  for (const [key, v] of Object.entries(value)) {
    if (!VALID_DIFFICULTIES.includes(key as Difficulty)) return "Invalid difficulty key"
    if (typeof v !== "number") return "Invalid difficulty count"
  }
  return null
}

function checkTimingPolicy(value: unknown): string | null {
  if (!isPlainObject(value)) return "Invalid timingPolicy"
  for (const [kind, v] of Object.entries(value)) {
    if (!VALID_UNIT_KINDS.includes(kind as UnitKind)) return "Invalid unit kind in timingPolicy"
    if (typeof v !== "number") return "Invalid timingPolicy value"
  }
  return null
}

const TEMPLATE_FIELDS = [
  "name",
  "type",
  "questionCount",
  "difficultyMix",
  "timingPolicy",
  "slackSec",
  "joinWindowSec",
  "marksCorrect",
  "marksWrong",
  "seatCap",
  "rrule",
] as const

templates.get("/", async (c) => {
  const limitRaw = parsePaginationParam(c.req.query("limit"), DEFAULT_PAGE_LIMIT)
  const offsetRaw = parsePaginationParam(c.req.query("offset"), 0)
  if (limitRaw === "invalid" || offsetRaw === "invalid" || limitRaw < 1 || limitRaw > MAX_PAGE_LIMIT || offsetRaw < 0) {
    return c.json({ message: "Invalid pagination parameters" }, 400)
  }
  const { items, total } = await listTemplates(templateDeps(c), limitRaw, offsetRaw)
  const body: ListTemplatesResponse = { items, total, limit: limitRaw, offset: offsetRaw }
  return c.json(body, 200)
})

function validateCreateBody(body: unknown): string | null {
  if (!isPlainObject(body)) return "Invalid request body"
  const keys = Object.keys(body)
  if (keys.some((k) => !TEMPLATE_FIELDS.includes(k as (typeof TEMPLATE_FIELDS)[number]))) return "Unknown field"
  if (TEMPLATE_FIELDS.some((f) => !(f in body))) return "Missing field"

  if (typeof body.name !== "string" || body.name.trim().length === 0) return "Invalid name"
  if (typeof body.type !== "string" || !VALID_TYPES.includes(body.type as QuizType)) return "Invalid type"
  if (typeof body.questionCount !== "number") return "Invalid questionCount"
  const mixError = checkDifficultyMix(body.difficultyMix)
  if (mixError) return mixError
  const policyError = checkTimingPolicy(body.timingPolicy)
  if (policyError) return policyError
  for (const field of ["slackSec", "joinWindowSec", "marksCorrect", "marksWrong", "seatCap"] as const) {
    if (typeof body[field] !== "number") return `Invalid ${field}`
  }
  if (typeof body.rrule !== "string") return "Invalid rrule"
  return null
}

templates.post("/", async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ message: "Invalid request body" }, 400)
  }
  const error = validateCreateBody(body)
  if (error) return c.json({ message: error }, 400)

  const result = await createTemplate(templateDeps(c), currentUser(c).id, body as CreateTemplateRequest)
  if (result.kind === "invalid") return c.json({ message: "Invalid template" }, 400)
  return c.json(result.summary, 200)
})

function validatePatchBody(body: unknown): string | null {
  if (!isPlainObject(body)) return "Invalid request body"
  const keys = Object.keys(body)
  if (keys.length === 0) return "Request body must not be empty"
  if (keys.some((k) => !TEMPLATE_FIELDS.includes(k as (typeof TEMPLATE_FIELDS)[number]))) return "Unknown field"
  if (keys.some((k) => body[k] === null)) return "Null is not a valid value for any field"

  if ("name" in body && typeof body.name !== "string") return "Invalid name"
  if ("type" in body && (typeof body.type !== "string" || !VALID_TYPES.includes(body.type as QuizType))) return "Invalid type"
  if ("questionCount" in body && typeof body.questionCount !== "number") return "Invalid questionCount"
  if ("difficultyMix" in body) {
    const mixError = checkDifficultyMix(body.difficultyMix)
    if (mixError) return mixError
  }
  if ("timingPolicy" in body) {
    const policyError = checkTimingPolicy(body.timingPolicy)
    if (policyError) return policyError
  }
  for (const field of ["slackSec", "joinWindowSec", "marksCorrect", "marksWrong", "seatCap"] as const) {
    if (field in body && typeof body[field] !== "number") return `Invalid ${field}`
  }
  if ("rrule" in body && typeof body.rrule !== "string") return "Invalid rrule"
  return null
}

templates.patch("/:id", async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ message: "Invalid request body" }, 400)
  }
  const error = validatePatchBody(body)
  if (error) return c.json({ message: error }, 400)

  const result = await patchTemplate(templateDeps(c), c.req.param("id"), body as UpdateTemplateRequest)
  if (result.kind === "not_found") return c.json({ message: "Template not found" }, 404)
  if (result.kind === "invalid") return c.json({ message: "Invalid template" }, 400)
  return c.json(result.summary, 200)
})

templates.post("/:id/deactivate", async (c) => {
  const result = await deactivateTemplate(templateDeps(c), c.req.param("id"))
  if (result.kind === "not_found") return c.json({ message: "Template not found" }, 404)
  if (result.kind === "conflict") return c.json({ message: "Template is already inactive" }, 409)
  return c.json(result.summary, 200)
})

export default templates
