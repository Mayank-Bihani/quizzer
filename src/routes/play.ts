// GET open quizzes; POST join; GET current; POST /api/play/:quizId/units/:unitPosition/submit; GET finished-only status. Serve active ServedUnit, local navigation and one final batch; no per-question answer/skip/timeout routes — API.md.

import { Hono } from "hono"
import type { Context } from "hono"
import type { Bindings, Variables } from "../core/config"
import { currentUser, requireAuth } from "../middleware/auth"
import { current, join, listOpen, status, submit, type RunDeps } from "../services/quiz-run"

type Env = { Bindings: Bindings; Variables: Variables }

const MAX_ROOM_CODE_BYTES = 32
const MAX_QUIZ_ID_BYTES = 128

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

function runDeps(c: Context<Env>): RunDeps {
  return { db: c.env.DB, kv: c.env.CACHE, bank: c.get("bank"), now: () => Date.now(), hash: sha256Hex }
}

function isBoundedString(value: string, maxBytes: number): boolean {
  return value.length > 0 && new TextEncoder().encode(value).length <= maxBytes
}

export const quizzesPublic = new Hono<Env>()
quizzesPublic.use("*", requireAuth)

quizzesPublic.get("/open", async (c) => {
  const response = await listOpen(runDeps(c))
  return c.json(response, 200)
})

quizzesPublic.post("/:code/join", async (c) => {
  const code = c.req.param("code")
  if (!code || !isBoundedString(code, MAX_ROOM_CODE_BYTES)) return c.json({ message: "Invalid room code" }, 404)

  const result = await join(runDeps(c), code, currentUser(c).id)
  if (result.kind === "not_found") return c.json({ message: "Quiz not found" }, 404)
  if (result.kind === "full") return c.json({ message: "Room is full" }, 409)
  if (result.kind === "unavailable") return c.json({ message: "Quiz is not open for admission" }, 409)
  return c.json(result.response, 200)
})

export const play = new Hono<Env>()
play.use("*", requireAuth)

function parseQuizId(c: Context<Env>): string | null {
  const quizId = c.req.param("quizId")
  return quizId && isBoundedString(quizId, MAX_QUIZ_ID_BYTES) ? quizId : null
}

play.get("/:quizId/current", async (c) => {
  const quizId = parseQuizId(c)
  if (!quizId) return c.json({ message: "Quiz not found" }, 404)

  const result = await current(runDeps(c), quizId, currentUser(c).id)
  if (result.kind === "not_found") return c.json({ message: "Quiz not found" }, 404)
  if (result.kind === "forbidden") return c.json({ message: "Not a participant" }, 403)
  if (result.kind === "cancelled") return c.json({ message: "Quiz was cancelled" }, 409)
  return c.json(result.response, 200)
})

play.post("/:quizId/units/:unitPosition/submit", async (c) => {
  const quizId = parseQuizId(c)
  if (!quizId) return c.json({ message: "Quiz not found" }, 404)

  const rawPosition = c.req.param("unitPosition")
  if (!/^[1-9]\d*$/.test(rawPosition)) return c.json({ message: "Invalid unit position" }, 400)
  const unitPosition = Number(rawPosition)

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ message: "Invalid request body" }, 400)
  }

  const result = await submit(runDeps(c), quizId, currentUser(c).id, unitPosition, body)
  if (result.kind === "not_found") return c.json({ message: "Quiz not found" }, 404)
  if (result.kind === "forbidden") return c.json({ message: "Not a participant" }, 403)
  if (result.kind === "invalid") return c.json({ message: "Invalid submission" }, 400)
  if (result.kind === "conflict") return c.json({ message: "This unit is not accepting that submission" }, 409)
  if (result.kind === "late") return c.json({ message: "Submission window has closed" }, 410)
  return c.json(result.response, 200)
})

play.get("/:quizId/status", async (c) => {
  const quizId = parseQuizId(c)
  if (!quizId) return c.json({ message: "Quiz not found" }, 404)

  const result = await status(runDeps(c), quizId, currentUser(c).id)
  if (result.kind === "not_found") return c.json({ message: "Quiz not found" }, 404)
  if (result.kind === "forbidden") return c.json({ message: "Not a participant" }, 403)
  if (result.kind === "active") return c.json({ message: "Quiz is still in progress for this participant" }, 409)
  return c.json(result.response, 200)
})
