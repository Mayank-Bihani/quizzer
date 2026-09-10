import { env } from "cloudflare:test"
import { describe, expect, it, vi } from "vitest"
import type { CloseResult, DueCloseQuiz, FailedTelegramPostRef, OpenResult } from "../src/core/contracts"
import app from "../src/index"
import { renderAlertText, sendFailureAlert, type EmailSender, type TelegramSender } from "../src/services/observability"
import { runClosePass, runFailureAlertsPass, runPreparePass, type SchedulerDeps } from "../src/services/scheduler"

const OK_OPEN: OpenResult = { seatsSeeded: 5, alreadyOpen: false }

function baseSchedulerDeps(overrides: Partial<SchedulerDeps> = {}): SchedulerDeps {
  return {
    listDuePrepare: vi.fn(async () => []),
    openRoom: vi.fn(async () => OK_OPEN),
    listDueClose: vi.fn(async () => []),
    listFailedPosts: vi.fn(async () => []),
    telegram: null,
    email: null,
    alertChatId: null,
    alertEmailAddress: null,
    now: () => 1_700_000_000_000,
    ...overrides,
  }
}

describe("runPreparePass", () => {
  it("calls openRoom for every discovered id, requesting at most the bounded limit", async () => {
    const listDuePrepare = vi.fn(async (_now: number, limit: number) => {
      expect(limit).toBe(100)
      return ["q1", "q2", "q3"]
    })
    const openRoom = vi.fn(async () => OK_OPEN)
    const result = await runPreparePass({ listDuePrepare, openRoom, now: () => 1000 })
    expect(openRoom).toHaveBeenCalledTimes(3)
    expect(openRoom).toHaveBeenNthCalledWith(1, "q1", 1000)
    expect(result).toEqual({ attempted: 3, failed: 0 })
  })

  it("isolates one failing candidate so the rest still run", async () => {
    const listDuePrepare = vi.fn(async () => ["q1", "q2", "q3"])
    const openRoom = vi.fn(async (id: string) => {
      if (id === "q2") throw new Error("boom")
      return OK_OPEN
    })
    const result = await runPreparePass({ listDuePrepare, openRoom, now: () => 1000 })
    expect(openRoom).toHaveBeenCalledTimes(3)
    expect(result).toEqual({ attempted: 3, failed: 1 })
  })
})

describe("runClosePass — the pass itself, isolated from production wiring", () => {
  it("calls the injected closeQuiz for every discovered due id", async () => {
    const listDueClose = vi.fn(async (_now: number, limit: number): Promise<DueCloseQuiz[]> => {
      expect(limit).toBe(100)
      return [
        { quizId: "q1", safeCloseAt: 500 },
        { quizId: "q2", safeCloseAt: 600 },
      ]
    })
    const closeQuiz = vi.fn(async (): Promise<CloseResult> => ({ participantCount: 1, top10: [], boardComputedAt: 1000 }))
    const result = await runClosePass({ listDueClose, now: () => 1000 }, closeQuiz)
    expect(closeQuiz).toHaveBeenCalledTimes(2)
    expect(closeQuiz).toHaveBeenNthCalledWith(1, "q1", 1000)
    expect(result).toEqual({ attempted: 2, failed: 0 })
  })

  it("isolates a failing candidate", async () => {
    const listDueClose = vi.fn(async (): Promise<DueCloseQuiz[]> => [
      { quizId: "q1", safeCloseAt: 500 },
      { quizId: "q2", safeCloseAt: 600 },
    ])
    const closeQuiz = vi.fn(async (id: string): Promise<CloseResult> => {
      if (id === "q1") throw new Error("boom")
      return { participantCount: 1, top10: [], boardComputedAt: 1000 }
    })
    const result = await runClosePass({ listDueClose, now: () => 1000 }, closeQuiz)
    expect(result).toEqual({ attempted: 2, failed: 1 })
  })
})

describe("runFailureAlertsPass — close overdue boundary and repetition", () => {
  it("does not alert just before safeCloseAt+180000, and does alert exactly at and after it", async () => {
    const telegram: TelegramSender = { send: vi.fn(async () => undefined) }
    const due: DueCloseQuiz[] = [{ quizId: "q1", safeCloseAt: 1000 }]

    const before = await runFailureAlertsPass(
      baseSchedulerDeps({ listDueClose: async () => due, telegram, alertChatId: "chat", now: () => 1000 + 180_000 - 1 })
    )
    expect(before.closeAlerts).toBe(0)
    expect(telegram.send).not.toHaveBeenCalled()

    const atBoundary = await runFailureAlertsPass(
      baseSchedulerDeps({ listDueClose: async () => due, telegram, alertChatId: "chat", now: () => 1000 + 180_000 })
    )
    expect(atBoundary.closeAlerts).toBe(1)
    expect(telegram.send).toHaveBeenCalledTimes(1)

    // Repeats on a later tick while the condition still holds — no de-dup state.
    const later = await runFailureAlertsPass(
      baseSchedulerDeps({ listDueClose: async () => due, telegram, alertChatId: "chat", now: () => 1000 + 180_000 + 60_000 })
    )
    expect(later.closeAlerts).toBe(1)
    expect(telegram.send).toHaveBeenCalledTimes(2)
  })

  it("alerts for every failed Telegram post using the bounded limit", async () => {
    const posts: FailedTelegramPostRef[] = [
      { quizId: "q1", weekStart: null, kind: "open", claimedAt: 100 },
      { quizId: null, weekStart: "2026-09-07", kind: "weekly", claimedAt: 200 },
    ]
    const listFailedPosts = vi.fn(async (limit: number) => {
      expect(limit).toBe(100)
      return posts
    })
    const telegram: TelegramSender = { send: vi.fn(async () => undefined) }
    const result = await runFailureAlertsPass(baseSchedulerDeps({ listFailedPosts, telegram, alertChatId: "chat" }))
    expect(result.postAlerts).toBe(2)
    expect(telegram.send).toHaveBeenCalledTimes(2)
  })

  it("isolates one failing alert from the next candidate", async () => {
    const due: DueCloseQuiz[] = [
      { quizId: "q1", safeCloseAt: 0 },
      { quizId: "q2", safeCloseAt: 0 },
    ]
    const telegram: TelegramSender = { send: vi.fn(async (chatId: string) => (chatId === "boom" ? Promise.reject(new Error("x")) : undefined)) }
    const result = await runFailureAlertsPass(baseSchedulerDeps({ listDueClose: async () => due, telegram, alertChatId: "chat", now: () => 1_000_000 }))
    expect(result.closeAlerts).toBe(2)
  })

  it("attempts Telegram and email independently — one channel's failure never suppresses the other", async () => {
    const telegram: TelegramSender = { send: vi.fn(async () => Promise.reject(new Error("telegram down"))) }
    const email: EmailSender = { send: vi.fn(async () => undefined) }
    const outcome = await sendFailureAlert(
      { telegram, email, alertChatId: "chat", alertEmailAddress: "ops@example.com" },
      { category: "close_overdue", quizId: "q1", safeCloseAt: 1000 }
    )
    expect(outcome).toEqual({ telegramOk: false, emailOk: true })
    expect(telegram.send).toHaveBeenCalledTimes(1)
    expect(email.send).toHaveBeenCalledTimes(1)
  })

  it("never gates prepare/join/submit — a broken channel does not throw out of the alerts pass", async () => {
    const telegram: TelegramSender = { send: vi.fn(async () => Promise.reject(new Error("down"))) }
    const email: EmailSender = { send: vi.fn(async () => Promise.reject(new Error("also down"))) }
    const due: DueCloseQuiz[] = [{ quizId: "q1", safeCloseAt: 0 }]
    await expect(
      runFailureAlertsPass(baseSchedulerDeps({ listDueClose: async () => due, telegram, email, alertChatId: "chat", alertEmailAddress: "ops@example.com", now: () => 1_000_000 }))
    ).resolves.not.toThrow()
  })
})

describe("renderAlertText — safe content only", () => {
  it("never includes question content, tokens, or raw provider errors", () => {
    const text = renderAlertText({ category: "close_overdue", quizId: "q1", safeCloseAt: 1000 })
    expect(text).not.toContain("token")
    expect(text).toContain("q1")
  })
})

describe("production wiring — Sprint 5 binds the real closeQuiz into the minute tick", () => {
  it("closes a genuinely due, zero-participant quiz end-to-end when the minute-tick cron fires against real D1", async () => {
    for (const table of [
      "answers",
      "participant_units",
      "participants",
      "quiz_seats",
      "quiz_questions",
      "quiz_units",
      "questions",
      "passages",
      "quizzes",
      "users",
    ]) {
      await env.DB.prepare(`DELETE FROM ${table}`).run()
    }

    const adminId = crypto.randomUUID()
    await env.DB.prepare("INSERT INTO users (id, google_sub, email, name, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)")
      .bind(adminId, crypto.randomUUID(), `${adminId}@example.com`, "Admin", Date.now())
      .run()

    const questionId = "sched-q-1"
    await env.DB.prepare(
      `INSERT INTO questions (id, type, topic, difficulty, format, body_md, option_a, option_b, option_c, option_d, correct_option, explanation_md, created_by, created_at)
       VALUES (?, 'quant', 'Topic', 'easy', 'mcq', 'Body', 'A', 'B', 'C', 'D', 'A', 'Explanation', ?, ?)`
    )
      .bind(questionId, adminId, Date.now())
      .run()

    const quizId = crypto.randomUUID()
    const joinWindowSec = 600
    const timeLimitSec = 60
    const scheduledAt = Date.now() - 10_000_000
    const endsAt = scheduledAt + joinWindowSec * 1000
    const lobbyOpensAt = scheduledAt - 300_000
    await env.DB.prepare(
      `INSERT INTO quizzes (id, quiz_number, title, type, question_count, unit_count, difficulty_mix, timing_policy, slack_sec, join_window_sec, scheduled_at, lobby_opens_at, ends_at, status, room_code, seat_cap, window_sec, marks_correct, marks_wrong, created_by, created_at, opened_at)
       VALUES (?, 1, 'Sched Quiz', 'quant', 1, 1, '{}', '{}', 0, ?, ?, ?, ?, 'open', 'QNT-7001', 5, ?, 4, -1, ?, ?, ?)`
    )
      .bind(quizId, joinWindowSec, scheduledAt, lobbyOpensAt, endsAt, timeLimitSec, adminId, Date.now(), Date.now())
      .run()
    await env.DB.prepare("INSERT INTO quiz_units (quiz_id, unit_position, kind, passage_id, time_limit_sec) VALUES (?, 1, 'standalone', NULL, ?)")
      .bind(quizId, timeLimitSec)
      .run()
    await env.DB.prepare("INSERT INTO quiz_questions (quiz_id, question_id, position, unit_position, sub_position) VALUES (?, ?, 1, 1, 1)")
      .bind(quizId, questionId)
      .run()
    for (let seatNo = 1; seatNo <= 5; seatNo++) {
      await env.DB.prepare("INSERT INTO quiz_seats (quiz_id, seat_no) VALUES (?, ?)").bind(quizId, seatNo).run()
    }

    const controller = { cron: "* * * * *", scheduledTime: Date.now(), noRetry: () => undefined }
    await app.scheduled(controller, env)

    const row = await env.DB.prepare("SELECT status, board_computed_at FROM quizzes WHERE id = ?")
      .bind(quizId)
      .first<{ status: string; board_computed_at: number | null }>()
    expect(row?.status).toBe("ended")
    expect(row?.board_computed_at).not.toBeNull()
  })

  it("leaves an ineligible (not-yet-due) quiz untouched — SCHEDULER still performs no SQL/KV of its own", async () => {
    for (const table of [
      "answers",
      "participant_units",
      "participants",
      "quiz_seats",
      "quiz_questions",
      "quiz_units",
      "questions",
      "passages",
      "quizzes",
      "users",
    ]) {
      await env.DB.prepare(`DELETE FROM ${table}`).run()
    }
    const adminId = crypto.randomUUID()
    await env.DB.prepare("INSERT INTO users (id, google_sub, email, name, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)")
      .bind(adminId, crypto.randomUUID(), `${adminId}@example.com`, "Admin", Date.now())
      .run()
    const quizId = crypto.randomUUID()
    const scheduledAt = Date.now() + 3_600_000 // an hour from now — nowhere near eligible
    await env.DB.prepare(
      `INSERT INTO quizzes (id, quiz_number, title, type, question_count, unit_count, difficulty_mix, timing_policy, slack_sec, join_window_sec, scheduled_at, status, seat_cap, created_by, created_at)
       VALUES (?, 2, 'Future Quiz', 'quant', 1, 1, '{}', '{}', 0, 600, ?, 'draft', 5, ?, ?)`
    )
      .bind(quizId, scheduledAt, adminId, Date.now())
      .run()

    const controller = { cron: "* * * * *", scheduledTime: Date.now(), noRetry: () => undefined }
    await app.scheduled(controller, env)

    const row = await env.DB.prepare("SELECT status, board_computed_at FROM quizzes WHERE id = ?")
      .bind(quizId)
      .first<{ status: string; board_computed_at: number | null }>()
    expect(row?.status).toBe("draft")
    expect(row?.board_computed_at).toBeNull()
  })
})
