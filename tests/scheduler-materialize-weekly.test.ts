import { env } from "cloudflare:test"
import { describe, expect, it, vi } from "vitest"
import type { BoardSummary, MaterializeResult, TelegramContract } from "../src/core/contracts"
import { WEEKLY_RETRY_LOOKBACK_WEEKS } from "../src/core/config"
import { weekStartOffsetBy } from "../src/core/schedule"
import app from "../src/index"
import { runMaterializePass, runWeeklyRetrySweep } from "../src/services/scheduler"

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

function boards(weekStart: string): BoardSummary[] {
  return (["verbal", "quant", "lr", "overall"] as const).map((type) => ({ type, weekStart, top10: [] }))
}

describe("runMaterializePass", () => {
  function alertDeps(overrides: Partial<{ telegram: { send: ReturnType<typeof vi.fn> } | null; email: { send: ReturnType<typeof vi.fn> } | null }> = {}) {
    return {
      telegram: overrides.telegram === undefined ? { send: vi.fn(async () => undefined) } : overrides.telegram,
      email: overrides.email === undefined ? { send: vi.fn(async () => undefined) } : overrides.email,
      alertChatId: "chat-1",
      alertEmailAddress: "alerts@example.com",
    }
  }

  it("returns created/failed counts from materializeTemplates with no alert when there are no failures", async () => {
    const materializeTemplates = vi.fn(async () => ({ quizIds: ["q1", "q2"], failures: [] }) satisfies MaterializeResult)
    const deps = alertDeps()
    const result = await runMaterializePass({ materializeTemplates, now: () => 1000, ...deps })
    expect(result).toEqual({ created: 2, failed: 0 })
    expect(deps.telegram.send).not.toHaveBeenCalled()
    expect(deps.email.send).not.toHaveBeenCalled()
  })

  it("independently attempts both alert channels for every returned failure", async () => {
    const materializeTemplates = vi.fn(
      async () =>
        ({
          quizIds: ["q1"],
          failures: [
            { templateId: "t1", scheduledAt: 111, code: "pool_exhausted" },
            { templateId: "t2", scheduledAt: 222, code: "missing_timing_configuration" },
          ],
        }) satisfies MaterializeResult
    )
    const deps = alertDeps()
    const result = await runMaterializePass({ materializeTemplates, now: () => 1000, ...deps })
    expect(result).toEqual({ created: 1, failed: 2 })
    expect(deps.telegram.send).toHaveBeenCalledTimes(2)
    expect(deps.email.send).toHaveBeenCalledTimes(2)
    expect(deps.telegram.send.mock.calls[0]?.[1]).toContain("t1")
    expect(deps.telegram.send.mock.calls[1]?.[1]).toContain("t2")
  })

  it("one channel failing never suppresses the other channel or a sibling failure's alerts", async () => {
    const materializeTemplates = vi.fn(
      async () =>
        ({
          quizIds: [],
          failures: [
            { templateId: "t1", scheduledAt: 111, code: "pool_exhausted" },
            { templateId: "t2", scheduledAt: 222, code: "pool_exhausted" },
          ],
        }) satisfies MaterializeResult
    )
    const deps = alertDeps({
      telegram: {
        send: vi.fn(async () => {
          throw new Error("telegram down")
        }),
      },
    })
    const result = await runMaterializePass({ materializeTemplates, now: () => 1000, ...deps })
    expect(result).toEqual({ created: 0, failed: 2 })
    expect(deps.telegram.send).toHaveBeenCalledTimes(2)
    expect(deps.email.send).toHaveBeenCalledTimes(2) // still attempted for both, despite Telegram failing
  })

  it("passes MATERIALIZE_LOOKAHEAD_DAYS and the injected now through to materializeTemplates", async () => {
    const materializeTemplates = vi.fn(async () => ({ quizIds: [], failures: [] }) satisfies MaterializeResult)
    await runMaterializePass({ materializeTemplates, now: () => 5000, ...alertDeps() })
    expect(materializeTemplates).toHaveBeenCalledWith(7, 5000)
  })
})

describe("runWeeklyRetrySweep", () => {
  it("sweeps the current-through-lookback candidate weeks, reusing runWeeklyPass for each", async () => {
    const targetWeek = "2026-09-14"
    const readyWeeks = new Set([targetWeek, weekStartOffsetBy(targetWeek, 2)])
    const computeWeeklyBoards = vi.fn(async (weekStart: string) => (readyWeeks.has(weekStart) ? boards(weekStart) : []))
    const telegram = fakeTelegram()

    const result = await runWeeklyRetrySweep(computeWeeklyBoards, targetWeek, telegram)

    expect(computeWeeklyBoards).toHaveBeenCalledTimes(WEEKLY_RETRY_LOOKBACK_WEEKS)
    expect(result).toEqual({ attempted: WEEKLY_RETRY_LOOKBACK_WEEKS, sent: 2 })
    expect(telegram.claims.map((c) => c.target)).toEqual(
      expect.arrayContaining([{ weekStart: targetWeek }, { weekStart: weekStartOffsetBy(targetWeek, 2) }])
    )
  })

  it("isolates one candidate week's failure from the rest of the sweep", async () => {
    const targetWeek = "2026-09-14"
    const computeWeeklyBoards = vi.fn(async (weekStart: string) => {
      if (weekStart === weekStartOffsetBy(targetWeek, 1)) throw new Error("boom")
      return boards(weekStart)
    })
    const telegram = fakeTelegram()

    const result = await runWeeklyRetrySweep(computeWeeklyBoards, targetWeek, telegram)
    expect(result.attempted).toBe(WEEKLY_RETRY_LOOKBACK_WEEKS)
    expect(result.sent).toBe(WEEKLY_RETRY_LOOKBACK_WEEKS - 1)
  })
})

describe("production cron dispatch — Sprint 7 binds materialize and weekly", () => {
  it("the hourly cron runs materialize and the weekly-retry sweep with no observable throw", async () => {
    for (const table of ["telegram_posts", "quizzes", "quiz_templates", "users"]) {
      await env.DB.prepare(`DELETE FROM ${table}`).run()
    }
    const controller = { cron: "0 * * * *", scheduledTime: Date.now(), noRetry: () => undefined }
    await expect(app.scheduled(controller, env)).resolves.not.toThrow()
  })

  it("the weekly cron runs the single-target Monday publish with no observable throw", async () => {
    for (const table of ["telegram_posts", "quizzes", "users"]) {
      await env.DB.prepare(`DELETE FROM ${table}`).run()
    }
    const controller = { cron: "0 19 * * SUN", scheduledTime: Date.now(), noRetry: () => undefined }
    await expect(app.scheduled(controller, env)).resolves.not.toThrow()
  })
})
