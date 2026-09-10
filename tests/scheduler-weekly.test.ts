import { env } from "cloudflare:test"
import { describe, expect, it, vi } from "vitest"
import type { BoardSummary } from "../src/core/contracts"
import app from "../src/index"
import type { TelegramContract } from "../src/core/contracts"
import { runWeeklyPass } from "../src/services/scheduler"

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

function boards(): BoardSummary[] {
  return (["verbal", "quant", "lr", "overall"] as const).map((type) => ({ type, weekStart: "2026-09-07", top10: [] }))
}

describe("runWeeklyPass — typed but never production-wired in Sprint 6", () => {
  it("skips claimAndSend when the week is not ready (empty result)", async () => {
    const computeWeeklyBoards = vi.fn(async () => [] as BoardSummary[])
    const telegram = fakeTelegram()
    const result = await runWeeklyPass(computeWeeklyBoards, "2026-09-07", telegram)
    expect(result).toEqual({ sent: false })
    expect(telegram.claims).toHaveLength(0)
  })

  it("delegates the four-summary send to claimAndSend('weekly', {weekStart}, boards) exactly once", async () => {
    const computeWeeklyBoards = vi.fn(async () => boards())
    const telegram = fakeTelegram()
    const result = await runWeeklyPass(computeWeeklyBoards, "2026-09-07", telegram)
    expect(result).toEqual({ sent: true })
    expect(telegram.claims).toEqual([{ kind: "weekly", target: { weekStart: "2026-09-07" } }])
  })
})

describe("production wiring — the weekly cron stays a no-op in Sprint 6", () => {
  it("the weekly cron trigger fires with no observable Telegram/D1 side effect", async () => {
    for (const table of ["telegram_posts"]) {
      await env.DB.prepare(`DELETE FROM ${table}`).run()
    }
    const controller = { cron: "0 19 * * SUN", scheduledTime: Date.now(), noRetry: () => undefined }
    await expect(app.scheduled(controller, env)).resolves.not.toThrow()
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM telegram_posts").first<{ n: number }>()
    expect(count?.n).toBe(0)
  })
})
