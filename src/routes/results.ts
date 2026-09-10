// Participant-only leaderboard/review after atomic board completion; own history hides active score. Review contains per-question outcomes and a separate per-unit timing collection — API.md; QUIZZING.md §6.

import { Hono } from "hono"
import type { Context } from "hono"
import type { Bindings, Variables } from "../core/config"
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../core/config"
import { currentUser, requireAuth } from "../middleware/auth"
import { getHistory, getLeaderboard, getReview, type ResultsDeps } from "../services/quiz-results"

type Env = { Bindings: Bindings; Variables: Variables }

const MAX_QUIZ_ID_BYTES = 128

function resultsDeps(c: Context<Env>): ResultsDeps {
  return { db: c.env.DB, kv: c.env.CACHE, bank: c.get("bank"), now: () => Date.now(), onQuizClosed: c.get("onQuizClosed") }
}

function isBoundedString(value: string, maxBytes: number): boolean {
  return value.length > 0 && new TextEncoder().encode(value).length <= maxBytes
}

function parseQuizId(c: Context<Env>): string | null {
  const quizId = c.req.param("quizId")
  return quizId && isBoundedString(quizId, MAX_QUIZ_ID_BYTES) ? quizId : null
}

// Mounted at /api/quizzes alongside Sprint 4's quizzesPublic (open/join) — a separate router
// because src/routes/play.ts is a protected file this packet must not edit.
export const resultsQuizRoutes = new Hono<Env>()
resultsQuizRoutes.use("*", requireAuth)

resultsQuizRoutes.get("/:quizId/leaderboard", async (c) => {
  const quizId = parseQuizId(c)
  if (!quizId) return c.json({ message: "Quiz not found" }, 404)

  const result = await getLeaderboard(resultsDeps(c), quizId, currentUser(c).id)
  if (result.kind === "not_found") return c.json({ message: "Quiz not found" }, 404)
  if (result.kind === "forbidden") return c.json({ message: "Not a participant" }, 403)
  if (result.kind === "locked") return c.json({ message: "Results are not published yet" }, 423)
  return c.json(result.response, 200)
})

resultsQuizRoutes.get("/:quizId/review", async (c) => {
  const quizId = parseQuizId(c)
  if (!quizId) return c.json({ message: "Quiz not found" }, 404)

  const result = await getReview(resultsDeps(c), quizId, currentUser(c).id)
  if (result.kind === "not_found") return c.json({ message: "Quiz not found" }, 404)
  if (result.kind === "forbidden") return c.json({ message: "Not a participant" }, 403)
  if (result.kind === "locked") return c.json({ message: "Results are not published yet" }, 423)
  return c.json(result.response, 200)
})

export const studentsRoutes = new Hono<Env>()
studentsRoutes.use("*", requireAuth)

function parsePaginationParam(raw: string | undefined, fallback: number): number | "invalid" {
  if (raw === undefined) return fallback
  if (!/^-?\d+$/.test(raw)) return "invalid"
  return Number(raw)
}

studentsRoutes.get("/me/history", async (c) => {
  const limitRaw = parsePaginationParam(c.req.query("limit"), DEFAULT_PAGE_LIMIT)
  const offsetRaw = parsePaginationParam(c.req.query("offset"), 0)
  if (limitRaw === "invalid" || offsetRaw === "invalid" || limitRaw < 1 || limitRaw > MAX_PAGE_LIMIT || offsetRaw < 0) {
    return c.json({ message: "Invalid pagination parameters" }, 400)
  }

  const response = await getHistory(resultsDeps(c), currentUser(c).id, limitRaw, offsetRaw)
  return c.json(response, 200)
})
