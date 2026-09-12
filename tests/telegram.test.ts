import { env } from "cloudflare:test"
import { beforeEach, describe, expect, it } from "vitest"
import type { BoardSummary, CancelledPayload, CloseResult, QuizAnnouncePayload } from "../src/core/contracts"
import type { BotApiClient, SendResult } from "../src/services/telegram"
import { claimAndSend } from "../src/db/telegram"

let adminId: string
let quizId: string

beforeEach(async () => {
  for (const table of ["telegram_posts", "quizzes", "users"]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run()
  }
  adminId = crypto.randomUUID()
  await env.DB.prepare("INSERT INTO users (id, google_sub, email, name, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)")
    .bind(adminId, crypto.randomUUID(), `${adminId}@example.com`, "Admin", Date.now())
    .run()
  quizId = crypto.randomUUID()
  const scheduledAt = Date.now()
  await env.DB.prepare(
    `INSERT INTO quizzes (id, quiz_number, title, type, question_count, unit_count, difficulty_mix, timing_policy, slack_sec, join_window_sec, scheduled_at, lobby_opens_at, ends_at, status, room_code, seat_cap, window_sec, marks_correct, marks_wrong, created_by, created_at)
     VALUES (?, 1, 'Test Quiz', 'quant', 10, 3, '{}', '{}', 0, 600, ?, ?, ?, 'open', 'QNT-5001', 120, 900, 4, -1, ?, ?)`
  )
    .bind(quizId, scheduledAt, scheduledAt - 300_000, scheduledAt + 600_000, adminId, Date.now())
    .run()
})

function fakeBot(overrides: Partial<BotApiClient> = {}): BotApiClient & { calls: { chatId: string; text: string }[] } {
  const calls: { chatId: string; text: string }[] = []
  let seq = 0
  return {
    calls,
    async sendMessage(chatId, text) {
      calls.push({ chatId, text })
      seq++
      return { ok: true, messageId: `msg-${seq}` }
    },
    async getMe() {
      return { ok: true }
    },
    ...overrides,
  }
}

async function postRow(quiz: string | null, week: string | null, kind: string) {
  return env.DB.prepare("SELECT status, message_id, error, claimed_at, sent_at FROM telegram_posts WHERE quiz_id IS ? AND week_start IS ? AND kind = ?")
    .bind(quiz, week, kind)
    .first<{ status: string; message_id: string | null; error: string | null; claimed_at: number; sent_at: number | null }>()
}

const announcePayload: QuizAnnouncePayload = {
  title: "Test Quiz",
  scheduledAt: 1_700_000_000_000,
  endsAt: 1_700_000_600_000,
  questionCount: 10,
  unitCount: 3,
  windowSec: 900,
  timingSummary: [{ kind: "standalone", count: 10, minTimeSec: 60, maxTimeSec: 60 }],
}

describe("claimAndSend — single-message claim-then-send (AC-6)", () => {
  it("claims, sends, and marks the row sent with a message id", async () => {
    const bot = fakeBot()
    const result = await claimAndSend(env.DB, bot, "-100", "announce", { quizId }, announcePayload, Date.now())
    expect(result).toEqual({ sent: true, skipped: false })
    expect(bot.calls).toHaveLength(1)
    const row = await postRow(quizId, null, "announce")
    expect(row?.status).toBe("sent")
    expect(row?.message_id).toBe("msg-1")
  })

  it("is idempotent under a doubled call — second call skips with no second send", async () => {
    const bot = fakeBot()
    const first = await claimAndSend(env.DB, bot, "-100", "announce", { quizId }, announcePayload, Date.now())
    const second = await claimAndSend(env.DB, bot, "-100", "announce", { quizId }, announcePayload, Date.now())
    expect(first).toEqual({ sent: true, skipped: false })
    expect(second).toEqual({ sent: false, skipped: true })
    expect(bot.calls).toHaveLength(1)
  })

  it("marks the row failed with an error on a permanent Bot API failure, never retried by a repeat call", async () => {
    const bot = fakeBot({ async sendMessage() { return { ok: false, permanent: true, error: "unauthorized: invalid token" } } })
    const result = await claimAndSend(env.DB, bot, "-100", "announce", { quizId }, announcePayload, Date.now())
    expect(result).toEqual({ sent: false, skipped: false })
    const row = await postRow(quizId, null, "announce")
    expect(row?.status).toBe("failed")
    expect(row?.error).toContain("unauthorized")

    // A repeated call for the same (quizId, kind) does not retry — the claim already exists.
    const again = await claimAndSend(env.DB, bot, "-100", "announce", { quizId }, announcePayload, Date.now())
    expect(again).toEqual({ sent: false, skipped: true })
  })

  it("distinguishes soon/open/result kinds as independent claims for the same quiz", async () => {
    const bot = fakeBot()
    const closeResult: CloseResult = { participantCount: 1, top10: [{ rank: 1, userId: "u1", name: "A", score: 10 }], boardComputedAt: Date.now() }
    await claimAndSend(env.DB, bot, "-100", "announce", { quizId }, announcePayload, Date.now())
    await claimAndSend(env.DB, bot, "-100", "soon", { quizId }, announcePayload, Date.now())
    await claimAndSend(env.DB, bot, "-100", "open", { quizId }, announcePayload, Date.now())
    const result = await claimAndSend(env.DB, bot, "-100", "result", { quizId }, closeResult, Date.now())
    expect(result).toEqual({ sent: true, skipped: false })
    expect(bot.calls).toHaveLength(4)
  })
})

describe("claimAndSend — weekly single-claim/four-message shape (AC-7)", () => {
  const boards: BoardSummary[] = (["verbal", "quant", "lr", "overall"] as const).map((type) => ({
    type,
    weekStart: "2026-09-07",
    top10: [{ rank: 1, userId: "u1", name: "A", totalScore: 10, quizzesTaken: 1 }],
  }))

  it("sends all four sections in order under one claim row and stores a keyed message-id JSON object", async () => {
    const bot = fakeBot()
    const result = await claimAndSend(env.DB, bot, "-100", "weekly", { weekStart: "2026-09-07" }, boards, Date.now())
    expect(result).toEqual({ sent: true, skipped: false })
    expect(bot.calls).toHaveLength(4)

    const row = await postRow(null, "2026-09-07", "weekly")
    expect(row?.status).toBe("sent")
    const ids = JSON.parse(row?.message_id ?? "{}")
    expect(Object.keys(ids)).toEqual(["verbal", "quant", "lr", "overall"])
  })

  it("aborts on the first failed section, leaves remaining sections unsent, and marks the claim failed", async () => {
    let call = 0
    const bot = fakeBot({
      async sendMessage(): Promise<SendResult> {
        call++
        if (call === 3) return { ok: false, permanent: true, error: "server error 500" }
        return { ok: true, messageId: `m${call}` }
      },
    })
    const result = await claimAndSend(env.DB, bot, "-100", "weekly", { weekStart: "2026-09-07" }, boards, Date.now())
    expect(result).toEqual({ sent: false, skipped: false })
    expect(call).toBe(3) // sections 1-2 sent, 3 failed, 4 never attempted

    const row = await postRow(null, "2026-09-07", "weekly")
    expect(row?.status).toBe("failed")
    expect(row?.error).toContain("lr") // names the failed section (3rd in verbal,quant,lr,overall)
  })

  it("does not automatically resend on a repeated call for an already-claimed week", async () => {
    const bot = fakeBot()
    await claimAndSend(env.DB, bot, "-100", "weekly", { weekStart: "2026-09-07" }, boards, Date.now())
    const again = await claimAndSend(env.DB, bot, "-100", "weekly", { weekStart: "2026-09-07" }, boards, Date.now())
    expect(again).toEqual({ sent: false, skipped: true })
    expect(bot.calls).toHaveLength(4) // not 8
  })
})

describe("claimAndSend — monthly single-claim/four-message shape (mirrors AC-7's weekly shape)", () => {
  const boards: BoardSummary[] = (["verbal", "quant", "lr", "overall"] as const).map((type) => ({
    type,
    weekStart: "2026-09-01",
    top10: [{ rank: 1, userId: "u1", name: "A", totalScore: 10, quizzesTaken: 1 }],
  }))

  it("sends all four sections in order under one claim row and stores a keyed message-id JSON object", async () => {
    const bot = fakeBot()
    const result = await claimAndSend(env.DB, bot, "-100", "monthly", { weekStart: "2026-09-01" }, boards, Date.now())
    expect(result).toEqual({ sent: true, skipped: false })
    expect(bot.calls).toHaveLength(4)

    const row = await postRow(null, "2026-09-01", "monthly")
    expect(row?.status).toBe("sent")
    const ids = JSON.parse(row?.message_id ?? "{}")
    expect(Object.keys(ids)).toEqual(["verbal", "quant", "lr", "overall"])
  })

  it("aborts on the first failed section, leaves remaining sections unsent, and marks the claim failed", async () => {
    let call = 0
    const bot = fakeBot({
      async sendMessage(): Promise<SendResult> {
        call++
        if (call === 3) return { ok: false, permanent: true, error: "server error 500" }
        return { ok: true, messageId: `m${call}` }
      },
    })
    const result = await claimAndSend(env.DB, bot, "-100", "monthly", { weekStart: "2026-09-01" }, boards, Date.now())
    expect(result).toEqual({ sent: false, skipped: false })
    expect(call).toBe(3)

    const row = await postRow(null, "2026-09-01", "monthly")
    expect(row?.status).toBe("failed")
    expect(row?.error).toContain("lr")
  })

  it("does not automatically resend on a repeated call for an already-claimed month, and stays independent of a same-dated weekly claim", async () => {
    const bot = fakeBot()
    const weeklyBoards: BoardSummary[] = (["verbal", "quant", "lr", "overall"] as const).map((type) => ({
      type,
      weekStart: "2026-09-01",
      top10: [{ rank: 1, userId: "u1", name: "A", totalScore: 5, quizzesTaken: 1 }],
    }))
    // Same week_start-shaped date, different kind — the UNIQUE(week_start, kind) constraint keeps
    // these independent claims (AC-13's reuse of the shared week_start column).
    await claimAndSend(env.DB, bot, "-100", "weekly", { weekStart: "2026-09-01" }, weeklyBoards, Date.now())
    await claimAndSend(env.DB, bot, "-100", "monthly", { weekStart: "2026-09-01" }, boards, Date.now())
    const again = await claimAndSend(env.DB, bot, "-100", "monthly", { weekStart: "2026-09-01" }, boards, Date.now())
    expect(again).toEqual({ sent: false, skipped: true })
    expect(bot.calls).toHaveLength(8) // 4 weekly + 4 monthly, not 12
  })
})

describe("claimAndSend — cancelled silent/notify self-check (AC-7)", () => {
  const cancelledPayload: CancelledPayload = { title: "Test Quiz", scheduledAt: 1_700_000_000_000 }

  it("is silent (zero D1 writes, zero Bot API calls) when no 'open' post for this quiz has been sent", async () => {
    const bot = fakeBot()
    const result = await claimAndSend(env.DB, bot, "-100", "cancelled", { quizId }, cancelledPayload, Date.now())
    expect(result).toEqual({ sent: false, skipped: true })
    expect(bot.calls).toHaveLength(0)
    const row = await postRow(quizId, null, "cancelled")
    expect(row).toBeNull()
    const rowCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM telegram_posts WHERE quiz_id = ?").bind(quizId).first<{ n: number }>()
    expect(rowCount?.n).toBe(0)
  })

  it("notifies when the 'open' post for this quiz was already sent", async () => {
    const bot = fakeBot()
    await claimAndSend(env.DB, bot, "-100", "open", { quizId }, announcePayload, Date.now())
    const result = await claimAndSend(env.DB, bot, "-100", "cancelled", { quizId }, cancelledPayload, Date.now())
    expect(result).toEqual({ sent: true, skipped: false })
    const row = await postRow(quizId, null, "cancelled")
    expect(row?.status).toBe("sent")
  })

  it("stays silent when the 'open' post was claimed but never actually sent (still pending/failed)", async () => {
    const bot = fakeBot({ async sendMessage() { return { ok: false, permanent: true, error: "boom" } } })
    await claimAndSend(env.DB, bot, "-100", "open", { quizId }, announcePayload, Date.now()) // ends up 'failed', not 'sent'
    const result = await claimAndSend(env.DB, bot, "-100", "cancelled", { quizId }, cancelledPayload, Date.now())
    expect(result).toEqual({ sent: false, skipped: true })
    const row = await postRow(quizId, null, "cancelled")
    expect(row).toBeNull()
  })
})
