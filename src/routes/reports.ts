// Admin report after board completion: participant marks/counts/total unit time, question outcomes, unit timing aggregates; no bonus or per-question durations — API.md; QUIZZING.md §7.

import { Hono } from "hono"
import type { Context } from "hono"
import type { Bindings, Variables } from "../core/config"
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../core/config"
import { requireRole } from "../middleware/auth"
import { getReport, type ResultsDeps } from "../services/quiz-results"

type Env = { Bindings: Bindings; Variables: Variables }

function resultsDeps(c: Context<Env>): ResultsDeps {
  return { db: c.env.DB, kv: c.env.CACHE, bank: c.get("bank"), now: () => Date.now(), onQuizClosed: c.get("onQuizClosed") }
}

function parsePaginationParam(raw: string | undefined, fallback: number): number | "invalid" {
  if (raw === undefined) return fallback
  if (!/^-?\d+$/.test(raw)) return "invalid"
  return Number(raw)
}

export const reports = new Hono<Env>()
reports.use("*", requireRole("admin"))

reports.get("/:id/report", async (c) => {
  const quizId = c.req.param("id")
  const limit = parsePaginationParam(c.req.query("limit"), DEFAULT_PAGE_LIMIT)
  const offset = parsePaginationParam(c.req.query("offset"), 0)
  if (limit === "invalid" || offset === "invalid" || limit < 1 || limit > MAX_PAGE_LIMIT || offset < 0) {
    return c.json({ message: "Invalid pagination parameters" }, 400)
  }

  const result = await getReport(resultsDeps(c), quizId, limit, offset)
  if (result.kind === "not_found") return c.json({ message: "Quiz not found" }, 404)
  if (result.kind === "locked") return c.json({ message: "Report is not available yet" }, 423)
  return c.json(result.response, 200)
})
