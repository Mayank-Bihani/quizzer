import { env } from "cloudflare:test"
import { beforeEach, describe, expect, it } from "vitest"
import type { QuizType } from "../src/core/contracts"
import { weekBoundsForWeekStart } from "../src/core/schedule"
import { computeWeeklyBoards, getWeeklyBoard } from "../src/services/quiz-boards"

let creatorId: string
let quizNumberSeq = 0
let userSeq = 0

const WEEK_START = "2026-09-07" // a Monday
const { startMs } = weekBoundsForWeekStart(WEEK_START)

beforeEach(async () => {
  for (const table of ["weekly_boards", "participants", "quiz_seats", "quiz_questions", "quiz_units", "quizzes", "users"]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run()
  }
  creatorId = await insertUser("Admin")
  quizNumberSeq = 0
  userSeq = 0
})

async function insertUser(name: string): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare("INSERT INTO users (id, google_sub, email, name, role, created_at) VALUES (?, ?, ?, ?, 'student', ?)")
    .bind(id, crypto.randomUUID(), `${id}@example.com`, name, Date.now())
    .run()
  return id
}

async function nextUser(name: string): Promise<string> {
  userSeq++
  return insertUser(name)
}

async function insertQuiz(opts: { type: QuizType; scheduledAt: number; status: "draft" | "scheduled" | "open" | "ended" | "cancelled" }): Promise<string> {
  const id = crypto.randomUUID()
  quizNumberSeq++
  const needsFull = opts.status !== "draft" && opts.status !== "cancelled"
  const joinWindowSec = 600
  await env.DB.prepare(
    `INSERT INTO quizzes (id, quiz_number, title, type, question_count, unit_count, timing_policy, slack_sec, join_window_sec, scheduled_at, lobby_opens_at, ends_at, status, room_code, window_sec, marks_correct, marks_wrong, created_by, created_at)
     VALUES (?, ?, 'Quiz', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      needsFull ? quizNumberSeq : null,
      opts.type,
      needsFull ? 20 : null,
      needsFull ? 1 : null,
      needsFull ? JSON.stringify({ standalone: 60 }) : null,
      needsFull ? 30 : null,
      needsFull ? joinWindowSec : null,
      opts.scheduledAt,
      needsFull ? opts.scheduledAt - 300000 : null,
      needsFull ? opts.scheduledAt + joinWindowSec * 1000 : null,
      opts.status,
      needsFull ? `RM${quizNumberSeq}` : null,
      needsFull ? 90 : null,
      needsFull ? 4 : null,
      needsFull ? -1 : null,
      creatorId,
      Date.now()
    )
    .run()
  return id
}

async function insertParticipant(quizId: string, userId: string, totalScore: number): Promise<void> {
  await env.DB.prepare("INSERT INTO participants (quiz_id, user_id, seat_no, started_at, finished_at, total_score) VALUES (?, ?, 1, ?, ?, ?)")
    .bind(quizId, userId, Date.now(), Date.now(), totalScore)
    .run()
}

function deps(): { db: D1Database; kv: KVNamespace } {
  return { db: env.DB, kv: env.CACHE }
}

describe("computeWeeklyBoards", () => {
  it("returns [] while a scheduled or open quiz remains in-week", async () => {
    const scheduledQuiz = await insertQuiz({ type: "quant", scheduledAt: startMs + 60_000, status: "scheduled" })
    expect(await computeWeeklyBoards(deps(), WEEK_START)).toEqual([])

    await env.DB.prepare("UPDATE quizzes SET status = 'open' WHERE id = ?").bind(scheduledQuiz).run()
    expect(await computeWeeklyBoards(deps(), WEEK_START)).toEqual([])
  })

  it("does not block on cancelled or draft in-week quizzes, and publishes once every other is ended", async () => {
    await insertQuiz({ type: "quant", scheduledAt: startMs + 60_000, status: "cancelled" })
    await insertQuiz({ type: "verbal", scheduledAt: startMs + 120_000, status: "draft" })
    await insertQuiz({ type: "lr", scheduledAt: startMs + 180_000, status: "ended" })

    const result = await computeWeeklyBoards(deps(), WEEK_START)
    expect(result).toHaveLength(4)
  })

  it("aggregates total score per type and overall from ended quizzes only, excluding zero-participation users", async () => {
    const alice = await nextUser("Alice")
    const bob = await nextUser("Bob")
    const carol = await nextUser("Carol")

    const quant1 = await insertQuiz({ type: "quant", scheduledAt: startMs + 60_000, status: "ended" })
    const quant2 = await insertQuiz({ type: "quant", scheduledAt: startMs + 120_000, status: "ended" })
    const verbal1 = await insertQuiz({ type: "verbal", scheduledAt: startMs + 180_000, status: "ended" })

    await insertParticipant(quant1, alice, 10)
    await insertParticipant(quant2, alice, 5)
    await insertParticipant(quant1, bob, 8)
    await insertParticipant(verbal1, carol, 20)

    const result = await computeWeeklyBoards(deps(), WEEK_START)
    const quantBoard = result.find((b) => b.type === "quant")!
    const verbalBoard = result.find((b) => b.type === "verbal")!
    const lrBoard = result.find((b) => b.type === "lr")!
    const overallBoard = result.find((b) => b.type === "overall")!

    expect(quantBoard.top10.map((r) => ({ userId: r.userId, totalScore: r.totalScore, quizzesTaken: r.quizzesTaken }))).toEqual(
      expect.arrayContaining([
        { userId: alice, totalScore: 15, quizzesTaken: 2 },
        { userId: bob, totalScore: 8, quizzesTaken: 1 },
      ])
    )
    expect(quantBoard.top10.find((r) => r.userId === carol)).toBeUndefined()
    expect(verbalBoard.top10).toEqual([{ rank: 1, userId: carol, name: "Carol", totalScore: 20, quizzesTaken: 1 }])
    expect(lrBoard.top10).toEqual([])
    expect(overallBoard.top10.find((r) => r.userId === alice)?.totalScore).toBe(15)
    expect(overallBoard.top10.find((r) => r.userId === carol)?.totalScore).toBe(20)
  })

  it("assigns dense ranks with exact total-score ties sharing one rank", async () => {
    const alice = await nextUser("Alice")
    const bob = await nextUser("Bob")
    const carol = await nextUser("Carol")
    const quiz = await insertQuiz({ type: "quant", scheduledAt: startMs + 60_000, status: "ended" })
    await insertParticipant(quiz, alice, 10)
    await insertParticipant(quiz, bob, 10)
    await insertParticipant(quiz, carol, 5)

    const result = await computeWeeklyBoards(deps(), WEEK_START)
    const quantBoard = result.find((b) => b.type === "quant")!
    const ranks = new Map(quantBoard.top10.map((r) => [r.userId, r.rank]))
    expect(ranks.get(alice)).toBe(1)
    expect(ranks.get(bob)).toBe(1)
    expect(ranks.get(carol)).toBe(2)
  })

  it("is safely re-callable while not-ready with no side effect", async () => {
    await insertQuiz({ type: "quant", scheduledAt: startMs + 60_000, status: "open" })
    await computeWeeklyBoards(deps(), WEEK_START)
    await computeWeeklyBoards(deps(), WEEK_START)
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM weekly_boards").first<{ n: number }>()
    expect(count?.n).toBe(0)
  })

  it("cleanly overwrites a prior computation for the same (weekStart, type) instead of appending", async () => {
    const alice = await nextUser("Alice")
    const quiz1 = await insertQuiz({ type: "quant", scheduledAt: startMs + 60_000, status: "ended" })
    await insertParticipant(quiz1, alice, 10)
    await computeWeeklyBoards(deps(), WEEK_START)

    const bob = await nextUser("Bob")
    const quiz2 = await insertQuiz({ type: "quant", scheduledAt: startMs + 120_000, status: "ended" })
    await insertParticipant(quiz2, bob, 30)
    await computeWeeklyBoards(deps(), WEEK_START)

    const rows = await env.DB.prepare("SELECT user_id, total_score FROM weekly_boards WHERE week_start = ? AND type = 'quant'").bind(WEEK_START).all<{
      user_id: string
      total_score: number
    }>()
    expect(rows.results).toHaveLength(2)
    expect(rows.results.find((r) => r.user_id === alice)?.total_score).toBe(10)
    expect(rows.results.find((r) => r.user_id === bob)?.total_score).toBe(30)
  })

  it("returns exactly four entries in fixed order verbal, quant, lr, overall", async () => {
    const result = await computeWeeklyBoards(deps(), WEEK_START)
    expect(result.map((b) => b.type)).toEqual(["verbal", "quant", "lr", "overall"])
    expect(result.every((b) => b.weekStart === WEEK_START)).toBe(true)
  })
})

describe("getWeeklyBoard", () => {
  it("defaults type to overall and weekStart to the most recently published week", async () => {
    const alice = await nextUser("Alice")
    const quiz = await insertQuiz({ type: "quant", scheduledAt: startMs + 60_000, status: "ended" })
    await insertParticipant(quiz, alice, 10)
    await computeWeeklyBoards(deps(), WEEK_START)

    const result = await getWeeklyBoard(deps(), { limit: 50, offset: 0 })
    expect(result.type).toBe("overall")
    expect(result.weekStart).toBe(WEEK_START)
    expect(result.items).toEqual([{ rank: 1, userId: alice, name: "Alice", totalScore: 10, quizzesTaken: 1 }])
    expect(result.total).toBe(1)
  })

  it("returns an empty PageResponse with no 404 when no week has ever been published", async () => {
    const result = await getWeeklyBoard(deps(), { limit: 50, offset: 0 })
    expect(result).toEqual({ items: [], total: 0, limit: 50, offset: 0, weekStart: "", type: "overall" })
  })

  it("returns an empty PageResponse for an explicit not-yet-published weekStart", async () => {
    const result = await getWeeklyBoard(deps(), { weekStart: "2099-01-05", type: "verbal", limit: 50, offset: 0 })
    expect(result).toEqual({ items: [], total: 0, limit: 50, offset: 0, weekStart: "2099-01-05", type: "verbal" })
  })
})
