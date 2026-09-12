import { env } from "cloudflare:test"
import { describe, expect, it, vi } from "vitest"
import type { BoardSummary, TelegramContract } from "../src/core/contracts"
import { MONTHLY_RETRY_LOOKBACK_MONTHS } from "../src/core/config"
import { monthBoundsForMonthStart, monthStartOffsetBy, mostRecentlyElapsedMonthStart } from "../src/core/schedule"
import app from "../src/index"
import { runMonthlyPass, runMonthlyRetrySweep } from "../src/services/scheduler"

function fakeTelegram(overrides: Partial<TelegramContract> = {}): TelegramContract & { claims: { kind: string; target: unknown }[] } {
  const claims: { kind: string; target: unknown }[] = []
  return {
    claims,
    async listFailedPosts() {
      return []
    },
    async claimAndSend(kind, target) {
      claims.push({ kind, target })
      return { sent: true, skipped: false }
    },
    ...overrides,
  }
}

function boards(monthStart: string): BoardSummary[] {
  return (["verbal", "quant", "lr", "overall"] as const).map((type) => ({ type, weekStart: monthStart, top10: [] }))
}

describe("runMonthlyPass", () => {
  it("skips claimAndSend when the month is not ready (empty result)", async () => {
    const computeMonthlyBoards = vi.fn(async () => [] as BoardSummary[])
    const telegram = fakeTelegram()
    const result = await runMonthlyPass(computeMonthlyBoards, "2026-09-01", telegram)
    expect(result).toEqual({ sent: false })
    expect(telegram.claims).toHaveLength(0)
  })

  it("delegates the four-summary send to claimAndSend('monthly', {weekStart}, boards) exactly once", async () => {
    const computeMonthlyBoards = vi.fn(async () => boards("2026-09-01"))
    const telegram = fakeTelegram()
    const result = await runMonthlyPass(computeMonthlyBoards, "2026-09-01", telegram)
    expect(result).toEqual({ sent: true })
    expect(telegram.claims).toEqual([{ kind: "monthly", target: { weekStart: "2026-09-01" } }])
  })
})

describe("runMonthlyRetrySweep", () => {
  it("sweeps the current-through-lookback candidate months, reusing runMonthlyPass for each", async () => {
    const targetMonth = "2026-09-01"
    const readyMonths = new Set([targetMonth, monthStartOffsetBy(targetMonth, 2)])
    const computeMonthlyBoards = vi.fn(async (monthStart: string) => (readyMonths.has(monthStart) ? boards(monthStart) : []))
    const telegram = fakeTelegram()

    const result = await runMonthlyRetrySweep(computeMonthlyBoards, targetMonth, telegram)

    expect(computeMonthlyBoards).toHaveBeenCalledTimes(MONTHLY_RETRY_LOOKBACK_MONTHS)
    expect(result).toEqual({ attempted: MONTHLY_RETRY_LOOKBACK_MONTHS, sent: 2 })
    expect(telegram.claims.map((c) => c.target)).toEqual(
      expect.arrayContaining([{ weekStart: targetMonth }, { weekStart: monthStartOffsetBy(targetMonth, 2) }])
    )
  })

  it("isolates one candidate month's failure from the rest of the sweep", async () => {
    const targetMonth = "2026-09-01"
    const computeMonthlyBoards = vi.fn(async (monthStart: string) => {
      if (monthStart === monthStartOffsetBy(targetMonth, 1)) throw new Error("boom")
      return boards(monthStart)
    })
    const telegram = fakeTelegram()

    const result = await runMonthlyRetrySweep(computeMonthlyBoards, targetMonth, telegram)
    expect(result.attempted).toBe(MONTHLY_RETRY_LOOKBACK_MONTHS)
    expect(result.sent).toBe(MONTHLY_RETRY_LOOKBACK_MONTHS - 1)
  })
})

describe("production wiring — hourly tick sweeps monthly alongside weekly (AC-15)", () => {
  it("the hourly cron runs with no observable throw against an empty (not-ready) DB", async () => {
    for (const table of ["telegram_posts", "quizzes", "users"]) {
      await env.DB.prepare(`DELETE FROM ${table}`).run()
    }
    const controller = { cron: "0 * * * *", scheduledTime: Date.now(), noRetry: () => undefined }
    await expect(app.scheduled(controller, env)).resolves.not.toThrow()
  })

  it("BE-8: publishes and sends a genuinely-elapsed, fully-closed month via the hourly tick", async () => {
    for (const table of ["monthly_boards", "telegram_posts", "participants", "quiz_seats", "quiz_questions", "quiz_units", "quizzes", "users"]) {
      await env.DB.prepare(`DELETE FROM ${table}`).run()
    }
    const adminId = crypto.randomUUID()
    await env.DB.prepare("INSERT INTO users (id, google_sub, email, name, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)")
      .bind(adminId, crypto.randomUUID(), `${adminId}@example.com`, "Admin", Date.now())
      .run()
    const studentId = crypto.randomUUID()
    await env.DB.prepare("INSERT INTO users (id, google_sub, email, name, role, created_at) VALUES (?, ?, ?, ?, 'student', ?)")
      .bind(studentId, crypto.randomUUID(), `${studentId}@example.com`, "Student", Date.now())
      .run()

    const monthStart = mostRecentlyElapsedMonthStart(Date.now())
    const { startMs } = monthBoundsForMonthStart(monthStart)
    const scheduledAt = startMs + 60_000
    const quizId = crypto.randomUUID()
    await env.DB.prepare(
      `INSERT INTO quizzes (id, quiz_number, title, type, question_count, unit_count, timing_policy, slack_sec, join_window_sec, scheduled_at, lobby_opens_at, ends_at, status, room_code, window_sec, marks_correct, marks_wrong, created_by, created_at)
       VALUES (?, 1, 'Quiz', 'quant', 20, 1, ?, 30, 600, ?, ?, ?, 'ended', 'QNT-1', 90, 4, -1, ?, ?)`
    )
      .bind(quizId, JSON.stringify({ standalone: 60 }), scheduledAt, scheduledAt - 300000, scheduledAt + 600000, adminId, Date.now())
      .run()
    await env.DB.prepare("INSERT INTO participants (quiz_id, user_id, seat_no, started_at, finished_at, total_score) VALUES (?, ?, 1, ?, ?, ?)")
      .bind(quizId, studentId, Date.now(), Date.now(), 10)
      .run()

    const controller = { cron: "0 * * * *", scheduledTime: Date.now(), noRetry: () => undefined }
    await expect(app.scheduled(controller, env)).resolves.not.toThrow()

    const boardRow = await env.DB.prepare("SELECT total_score FROM monthly_boards WHERE month_start = ? AND type = 'overall' AND user_id = ?")
      .bind(monthStart, studentId)
      .first<{ total_score: number }>()
    expect(boardRow?.total_score).toBe(10)

    const postRow = await env.DB.prepare("SELECT status, message_id FROM telegram_posts WHERE week_start = ? AND kind = 'monthly'")
      .bind(monthStart)
      .first<{ status: string; message_id: string }>()
    expect(postRow?.status).toBe("sent")
    expect(Object.keys(JSON.parse(postRow?.message_id ?? "{}"))).toEqual(["verbal", "quant", "lr", "overall"])
  })
})
