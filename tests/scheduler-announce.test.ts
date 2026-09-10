import { env } from "cloudflare:test"
import { describe, expect, it, vi } from "vitest"
import type { DueAnnounceQuiz, QuizAnnouncePayload, TelegramContract } from "../src/core/contracts"
import app from "../src/index"
import { runAnnouncePass } from "../src/services/scheduler"

function fakeTelegram(overrides: Partial<TelegramContract> = {}): TelegramContract & { claims: { kind: string; target: unknown; payload: unknown }[] } {
  const claims: { kind: string; target: unknown; payload: unknown }[] = []
  return {
    claims,
    async listFailedPosts() {
      return []
    },
    async claimAndSend(kind, target, payload) {
      claims.push({ kind, target, payload })
      return { sent: true, skipped: false }
    },
    ...overrides,
  }
}

function dueEntry(overrides: Partial<DueAnnounceQuiz> = {}): DueAnnounceQuiz {
  return {
    quizId: "q1",
    kind: "announce",
    title: "Weekend Sprint",
    scheduledAt: 1_700_000_000_000,
    endsAt: 1_700_000_600_000,
    questionCount: 10,
    unitCount: 2,
    windowSec: 900,
    timingSummary: [{ kind: "standalone", count: 10, minTimeSec: 60, maxTimeSec: 60 }],
    ...overrides,
  }
}

describe("runAnnouncePass", () => {
  it("calls claimAndSend for every discovered candidate, requesting at most the bounded limit", async () => {
    const listDueAnnounce = vi.fn(async (_now: number, limit: number) => {
      expect(limit).toBe(100)
      return [dueEntry({ quizId: "q1", kind: "announce" }), dueEntry({ quizId: "q2", kind: "soon" })]
    })
    const telegram = fakeTelegram()
    const result = await runAnnouncePass({ listDueAnnounce, now: () => 1000 }, telegram)
    expect(result).toEqual({ attempted: 2, failed: 0 })
    expect(telegram.claims).toHaveLength(2)
    expect(telegram.claims[0]).toEqual({ kind: "announce", target: { quizId: "q1" }, payload: expect.any(Object) })
  })

  it("strips quizId/kind off the candidate and forwards exactly the remaining QuizAnnouncePayload fields, nothing extra", async () => {
    const entry = dueEntry({ quizId: "q1", kind: "open", roomCode: "QNT-1234" })
    const listDueAnnounce = vi.fn(async () => [entry])
    const telegram = fakeTelegram()
    await runAnnouncePass({ listDueAnnounce, now: () => 1000 }, telegram)

    const payload = telegram.claims[0]?.payload as QuizAnnouncePayload
    const { quizId, kind, ...expectedPayload } = entry
    expect(payload).toEqual(expectedPayload)
    expect(payload).not.toHaveProperty("quizId")
    expect(payload).not.toHaveProperty("kind")
    void quizId
    void kind
  })

  it("isolates one failing candidate so the rest of the batch still runs", async () => {
    const listDueAnnounce = vi.fn(async () => [dueEntry({ quizId: "q1" }), dueEntry({ quizId: "q2" }), dueEntry({ quizId: "q3" })])
    const telegram = fakeTelegram({
      async claimAndSend(kind, target) {
        if ("quizId" in target && target.quizId === "q2") throw new Error("boom")
        return { sent: true, skipped: false }
      },
    })
    const result = await runAnnouncePass({ listDueAnnounce, now: () => 1000 }, telegram)
    expect(result).toEqual({ attempted: 3, failed: 1 })
  })
})

describe("production wiring — the Announce pass is bound into the minute tick", () => {
  it("claims a genuinely due T-2h announce candidate when the minute-tick cron fires against real D1", async () => {
    for (const table of ["telegram_posts", "quiz_units", "quiz_questions", "questions", "quizzes", "users"]) {
      await env.DB.prepare(`DELETE FROM ${table}`).run()
    }
    const adminId = crypto.randomUUID()
    await env.DB.prepare("INSERT INTO users (id, google_sub, email, name, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)")
      .bind(adminId, crypto.randomUUID(), `${adminId}@example.com`, "Admin", Date.now())
      .run()

    const quizId = crypto.randomUUID()
    const scheduledAt = Date.now() + 3_600_000 // 1h from now — inside the T-2h announce window
    await env.DB.prepare(
      `INSERT INTO quizzes (id, quiz_number, title, type, question_count, unit_count, difficulty_mix, timing_policy, slack_sec, join_window_sec, scheduled_at, lobby_opens_at, ends_at, status, room_code, seat_cap, window_sec, marks_correct, marks_wrong, created_by, created_at)
       VALUES (?, 1, 'Announce Wiring Quiz', 'quant', 1, 1, '{}', '{}', 0, 600, ?, ?, ?, 'scheduled', 'QNT-6001', 5, 60, 4, -1, ?, ?)`
    )
      .bind(quizId, scheduledAt, scheduledAt - 300_000, scheduledAt + 600_000, adminId, Date.now())
      .run()
    await env.DB.prepare("INSERT INTO quiz_units (quiz_id, unit_position, kind, passage_id, time_limit_sec) VALUES (?, 1, 'standalone', NULL, 60)").bind(quizId).run()

    const controller = { cron: "* * * * *", scheduledTime: Date.now(), noRetry: () => undefined }
    await app.scheduled(controller, env)

    const row = await env.DB.prepare("SELECT status, kind FROM telegram_posts WHERE quiz_id = ? AND kind = 'announce'").bind(quizId).first<{ status: string; kind: string }>()
    expect(row).not.toBeNull()
    expect(row?.status === "sent" || row?.status === "pending").toBe(true) // claimed; TELEGRAM_ENABLED unset locally so the no-op client still marks it sent
  })
})
