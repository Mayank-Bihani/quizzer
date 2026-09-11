// GET /api/boards/weekly — the full weekly board per section type and overall — QUIZZING.md §6, §7

import { Hono } from "hono"
import type { Context } from "hono"
import type { Bindings, Variables } from "../core/config"
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../core/config"
import type { QuizType } from "../core/contracts"
import { requireAuth } from "../middleware/auth"
import { getWeeklyBoard, type WeeklyBoardsDeps } from "../services/quiz-boards"

type Env = { Bindings: Bindings; Variables: Variables }

const BOARD_TYPES: (QuizType | "overall")[] = ["verbal", "quant", "lr", "overall"]
const WEEK_START_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function boardsDeps(c: Context<Env>): WeeklyBoardsDeps {
  return { db: c.env.DB, kv: c.env.CACHE }
}

function parsePaginationParam(raw: string | undefined, fallback: number): number | "invalid" {
  if (raw === undefined) return fallback
  if (!/^-?\d+$/.test(raw)) return "invalid"
  return Number(raw)
}

export const boards = new Hono<Env>()
boards.use("*", requireAuth)

boards.get("/weekly", async (c) => {
  const typeRaw = c.req.query("type")
  if (typeRaw !== undefined && !BOARD_TYPES.includes(typeRaw as QuizType | "overall")) {
    return c.json({ message: "Invalid type" }, 400)
  }
  const type = (typeRaw as QuizType | "overall" | undefined) ?? undefined

  const weekStartRaw = c.req.query("weekStart")
  if (weekStartRaw !== undefined && !WEEK_START_PATTERN.test(weekStartRaw)) {
    return c.json({ message: "Invalid weekStart" }, 400)
  }

  const limit = parsePaginationParam(c.req.query("limit"), DEFAULT_PAGE_LIMIT)
  const offset = parsePaginationParam(c.req.query("offset"), 0)
  if (limit === "invalid" || offset === "invalid" || limit < 1 || limit > MAX_PAGE_LIMIT || offset < 0) {
    return c.json({ message: "Invalid pagination parameters" }, 400)
  }

  const result = await getWeeklyBoard(boardsDeps(c), { weekStart: weekStartRaw, type, limit, offset })
  return c.json(result, 200)
})
