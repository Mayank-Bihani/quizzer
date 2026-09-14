import { env } from "cloudflare:test"
import { beforeEach, describe, expect, it } from "vitest"
import type { BankContract, Difficulty, QuestionFull, QuizType, SelectionFilters, TimingPolicy } from "../src/core/contracts"
import { materializeTemplates, type MaterializerDeps } from "../src/services/quiz-materializer"

let creatorId: string
let questionSeq = 0

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM quiz_questions"),
    env.DB.prepare("DELETE FROM quiz_units"),
    env.DB.prepare("DELETE FROM quizzes"),
    env.DB.prepare("DELETE FROM quiz_templates"),
    env.DB.prepare("DELETE FROM questions"),
    env.DB.prepare("DELETE FROM passages"),
    env.DB.prepare("DELETE FROM users"),
  ])
  creatorId = await insertAdmin()
  questionSeq = 0
})

async function insertAdmin(): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare("INSERT INTO users (id, google_sub, email, name, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)")
    .bind(id, crypto.randomUUID(), `${id}@example.com`, "Admin", Date.now())
    .run()
  return id
}

async function makeStandalone(type: QuizType, difficulty: Difficulty, topic = "Topic"): Promise<QuestionFull> {
  questionSeq++
  const id = `m-q-${questionSeq}`
  await env.DB.prepare(
    `INSERT INTO questions (id, type, topic, difficulty, format, body_md, option_a, option_b, option_c, option_d, correct_option, explanation_md, created_by, created_at)
     VALUES (?, ?, ?, ?, 'mcq', ?, 'A', 'B', 'C', 'D', 'A', 'Explanation', ?, ?)`
  )
    .bind(id, type, topic, difficulty, `Body ${questionSeq}`, creatorId, Date.now())
    .run()
  return {
    id,
    type,
    topic,
    subtopic: null,
    difficulty,
    format: "mcq",
    passageId: null,
    groupPosition: null,
    bodyMd: `Body ${questionSeq}`,
    imageUrl: null,
    optionA: "A",
    optionB: "B",
    optionC: "C",
    optionD: "D",
    correctOption: "A",
    numericAnswer: null,
    numericTolerance: null,
    explanationMd: "Explanation",
    source: null,
    passage: null,
  }
}

function fakeBank(pool: QuestionFull[]): BankContract & { claims: Map<string, { quizId: string; quizNumber: number }> } {
  const claims = new Map<string, { quizId: string; quizNumber: number }>()
  return {
    claims,
    async listUnused(filters: SelectionFilters) {
      const difficulties = Object.keys(filters.difficultyMix)
      return pool.filter(
        (q) =>
          q.type === filters.type &&
          !claims.has(q.id) &&
          difficulties.includes(q.difficulty) &&
          (filters.topics.length === 0 || filters.topics.includes(q.topic))
      )
    },
    async claimUnused(questionIds, quizId, quizNumber) {
      const confirmed: string[] = []
      for (const id of questionIds) {
        const existing = claims.get(id)
        if (!existing) {
          claims.set(id, { quizId, quizNumber })
          confirmed.push(id)
        } else if (existing.quizId === quizId && existing.quizNumber === quizNumber) {
          confirmed.push(id)
        }
      }
      return confirmed
    },
    async getByIds(questionIds) {
      const byId = new Map(pool.map((q) => [q.id, q]))
      return questionIds.map((id) => byId.get(id)).filter((q): q is QuestionFull => q !== undefined)
    },
  }
}

async function insertTemplate(opts: {
  type: QuizType
  questionCount: number
  difficultyMix: Partial<Record<Difficulty, number>>
  topics?: string[]
  timingPolicy: TimingPolicy
  slackSec?: number
  joinWindowSec?: number
  rrule: string
  active?: boolean
  seatCap?: number
}): Promise<string> {
  const id = crypto.randomUUID()
  // Every template in this file is quant, whose request lives in standalone_count (set_count is
  // null) — src/core/selection.ts's toStoredDrawRequest.
  await env.DB.prepare(
    `INSERT INTO quiz_templates (id, name, type, set_count, standalone_count, difficulty_mix, topics, timing_policy, slack_sec, join_window_sec, marks_correct, marks_wrong, seat_cap, rrule, active, created_by)
     VALUES (?, 'Recurring Test Template', ?, NULL, ?, ?, ?, ?, ?, ?, 4, -1, ?, ?, ?, ?)`
  )
    .bind(
      id,
      opts.type,
      opts.questionCount,
      JSON.stringify(opts.difficultyMix),
      JSON.stringify(opts.topics ?? []),
      JSON.stringify(opts.timingPolicy),
      opts.slackSec ?? 30,
      opts.joinWindowSec ?? 600,
      opts.seatCap ?? 120,
      opts.rrule,
      opts.active === false ? 0 : 1,
      creatorId
    )
    .run()
  return id
}

function deps(bank: BankContract): MaterializerDeps {
  return { db: env.DB, bank, random: () => 0.42 }
}

const T0 = Date.parse("2026-09-07T00:00:00.000Z") // a Monday-ish anchor

describe("materializeTemplates", () => {
  it("draws, builds units, derives duration, and publishes each new occurrence to scheduled", async () => {
    const pool = await Promise.all([makeStandalone("quant", "easy"), makeStandalone("quant", "easy")])
    await insertTemplate({
      type: "quant",
      questionCount: 2,
      difficultyMix: { easy: 2 },
      timingPolicy: { standalone: 60 },
      slackSec: 30,
      rrule: "FREQ=WEEKLY;BYDAY=TU;BYHOUR=18;BYMINUTE=0",
    })

    const bank = fakeBank(pool)
    const result = await materializeTemplates(deps(bank), 7, T0)
    expect(result.failures).toEqual([])
    expect(result.quizIds).toHaveLength(1)

    const row = await env.DB.prepare(
      "SELECT status, window_sec, seat_cap, template_id, room_code, selection_mode FROM quizzes WHERE id = ?"
    )
      .bind(result.quizIds[0])
      .first<{
        status: string
        window_sec: number
        seat_cap: number
        template_id: string | null
        room_code: string | null
        selection_mode: string
      }>()
    expect(row?.status).toBe("scheduled")
    expect(row?.window_sec).toBe(2 * 60 + 30) // SUM(unit time limits) + slackSec, never a stale/copied duration
    expect(row?.seat_cap).toBe(120)
    expect(row?.template_id).not.toBeNull()
    expect(row?.room_code).not.toBeNull()
    // BE-10: materializer-created quizzes never set selectionMode, so the DB default applies.
    expect(row?.selection_mode).toBe("auto")

    // BankContract.claimUnused's actual contract surface is the fake's own claim bookkeeping —
    // not the real questions.used_in_quiz_id column, which only Sprint 2's real BANK implementation touches.
    expect(bank.claims.has(pool[0]!.id)).toBe(true)
    expect(bank.claims.has(pool[1]!.id)).toBe(true)
    const questionCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM quiz_questions WHERE quiz_id = ?").bind(result.quizIds[0]).first<{ n: number }>()
    expect(questionCount?.n).toBe(2)
  })

  it("BE-9: honors a template's configured topics, drawing only from that subset", async () => {
    const arithmetic = await Promise.all([
      makeStandalone("quant", "easy", "Arithmetic"),
      makeStandalone("quant", "easy", "Arithmetic"),
    ])
    const algebra = await Promise.all([makeStandalone("quant", "easy", "Algebra"), makeStandalone("quant", "easy", "Algebra")])
    await insertTemplate({
      type: "quant",
      questionCount: 2,
      difficultyMix: { easy: 2 },
      topics: ["Arithmetic"],
      timingPolicy: { standalone: 60 },
      rrule: "FREQ=WEEKLY;BYDAY=TU;BYHOUR=18;BYMINUTE=0",
    })

    const bank = fakeBank([...arithmetic, ...algebra])
    const result = await materializeTemplates(deps(bank), 7, T0)
    expect(result.failures).toEqual([])
    expect(result.quizIds).toHaveLength(1)
    expect(algebra.every((q) => !bank.claims.has(q.id))).toBe(true)
    expect(arithmetic.every((q) => bank.claims.has(q.id))).toBe(true)
  })

  it("BE-10: reports pool_exhausted and writes nothing when the configured topics can't satisfy the draw", async () => {
    const arithmetic = await makeStandalone("quant", "easy", "Arithmetic")
    await insertTemplate({
      type: "quant",
      questionCount: 2, // only 1 Arithmetic candidate exists
      difficultyMix: { easy: 2 },
      topics: ["Arithmetic"],
      timingPolicy: { standalone: 60 },
      rrule: "FREQ=WEEKLY;BYDAY=TU;BYHOUR=18;BYMINUTE=0",
    })

    const bank = fakeBank([arithmetic])
    const result = await materializeTemplates(deps(bank), 7, T0)
    expect(result.quizIds).toEqual([])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.code).toBe("pool_exhausted")
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM quizzes").first<{ n: number }>()
    expect(row?.n).toBe(0)
  })

  it("is idempotent — a second invocation over the same window creates nothing new for already-materialized slots", async () => {
    const pool = await Promise.all([makeStandalone("quant", "easy"), makeStandalone("quant", "easy"), makeStandalone("quant", "easy"), makeStandalone("quant", "easy")])
    await insertTemplate({
      type: "quant",
      questionCount: 2,
      difficultyMix: { easy: 2 },
      timingPolicy: { standalone: 60 },
      rrule: "FREQ=WEEKLY;BYDAY=TU;BYHOUR=18;BYMINUTE=0",
    })
    const bank = fakeBank(pool)
    const first = await materializeTemplates(deps(bank), 7, T0)
    expect(first.quizIds).toHaveLength(1)
    const second = await materializeTemplates(deps(bank), 7, T0)
    expect(second.quizIds).toHaveLength(0)
    expect(second.failures).toEqual([])

    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM quizzes").first<{ n: number }>()
    expect(count?.n).toBe(1)
  })

  it("still materializes an occurrence that fell due since the last tick (MATERIALIZE_LOOKBACK_MS)", async () => {
    // 30 minutes before T0 — the gap a template created between two hourly ticks can fall into
    // (SCHEDULER.md §4.2): without a lookback this occurrence's time has already passed by the
    // time `now` reaches T0, and expandRrule's `occurrenceMs >= fromMs` would drop it forever.
    const pool = await Promise.all([makeStandalone("quant", "easy"), makeStandalone("quant", "easy")])
    await insertTemplate({
      type: "quant",
      questionCount: 2,
      difficultyMix: { easy: 2 },
      timingPolicy: { standalone: 60 },
      rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=5;BYMINUTE=0", // Monday 05:00 IST = T0 - 30min
    })
    const bank = fakeBank(pool)
    // days=1 (not the production 7) so next week's recurrence of the same weekday falls outside
    // the forward window too — isolates the lookback's effect from the normal forward lookahead.
    const result = await materializeTemplates(deps(bank), 1, T0)
    expect(result.failures).toEqual([])
    expect(result.quizIds).toHaveLength(1)
  })

  it("does not resurrect an occurrence from well before the lookback window", async () => {
    // 2 hours before T0 — outside MATERIALIZE_LOOKBACK_MS (65 min), so this stays excluded exactly
    // like before the lookback existed; the fix widens the window, it doesn't remove the bound.
    const pool = await Promise.all([makeStandalone("quant", "easy"), makeStandalone("quant", "easy")])
    await insertTemplate({
      type: "quant",
      questionCount: 2,
      difficultyMix: { easy: 2 },
      timingPolicy: { standalone: 60 },
      rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=3;BYMINUTE=30", // Monday 03:30 IST = T0 - 2h
    })
    const bank = fakeBank(pool)
    const result = await materializeTemplates(deps(bank), 1, T0)
    expect(result.failures).toEqual([])
    expect(result.quizIds).toHaveLength(0)
  })

  it("isolates a pool-exhausted occurrence from a healthy sibling occurrence in the same call", async () => {
    // Only enough content for ONE of the two due occurrences (Tuesday + Thursday this week).
    const pool = await Promise.all([makeStandalone("quant", "easy"), makeStandalone("quant", "easy")])
    await insertTemplate({
      type: "quant",
      questionCount: 2,
      difficultyMix: { easy: 2 },
      timingPolicy: { standalone: 60 },
      rrule: "FREQ=WEEKLY;BYDAY=TU,TH;BYHOUR=18;BYMINUTE=0",
    })

    const result = await materializeTemplates(deps(fakeBank(pool)), 7, T0)
    expect(result.quizIds).toHaveLength(1)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.code).toBe("pool_exhausted")
    expect(Object.keys(result.failures[0] ?? {}).sort()).toEqual(["code", "scheduledAt", "templateId"])

    // The failed occurrence wrote nothing: no draft, no partial units/questions, no BANK claim.
    const draftCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM quizzes").first<{ n: number }>()
    expect(draftCount?.n).toBe(1) // only the one healthy occurrence
  })

  it("maps a missing timing-policy value for a drawn unit kind to missing_timing_configuration and writes nothing", async () => {
    const pool = await Promise.all([makeStandalone("quant", "easy"), makeStandalone("quant", "easy")])
    await insertTemplate({
      type: "quant",
      questionCount: 2,
      difficultyMix: { easy: 2 },
      timingPolicy: {}, // no 'standalone' entry — every drawn unit here is standalone
      rrule: "FREQ=WEEKLY;BYDAY=TU;BYHOUR=18;BYMINUTE=0",
    })

    const result = await materializeTemplates(deps(fakeBank(pool)), 7, T0)
    expect(result.quizIds).toEqual([])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.code).toBe("missing_timing_configuration")

    const draftCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM quizzes").first<{ n: number }>()
    expect(draftCount?.n).toBe(0)
    const claimed = await env.DB.prepare("SELECT COUNT(*) AS n FROM questions WHERE used_in_quiz_id IS NOT NULL").first<{ n: number }>()
    expect(claimed?.n).toBe(0) // no BANK claim occurred
  })

  it("never materializes an inactive template", async () => {
    const pool = await Promise.all([makeStandalone("quant", "easy"), makeStandalone("quant", "easy")])
    await insertTemplate({
      type: "quant",
      questionCount: 2,
      difficultyMix: { easy: 2 },
      timingPolicy: { standalone: 60 },
      rrule: "FREQ=WEEKLY;BYDAY=TU;BYHOUR=18;BYMINUTE=0",
      active: false,
    })
    const result = await materializeTemplates(deps(fakeBank(pool)), 7, T0)
    expect(result).toEqual({ quizIds: [], failures: [] })
  })

  it("returns only IDs/failures from this invocation, not ones from a prior call", async () => {
    const poolA = await Promise.all([makeStandalone("quant", "easy"), makeStandalone("quant", "easy")])
    await insertTemplate({
      type: "quant",
      questionCount: 2,
      difficultyMix: { easy: 2 },
      timingPolicy: { standalone: 60 },
      rrule: "FREQ=WEEKLY;BYDAY=TU;BYHOUR=18;BYMINUTE=0",
    })
    const bank = fakeBank(poolA)
    const first = await materializeTemplates(deps(bank), 7, T0)
    expect(first.quizIds).toHaveLength(1)

    // A later call finds the NEXT due (different) occurrence; the template's pool is now
    // exhausted, so this call's own result reflects only that fresh attempt — not the first
    // call's already-returned quizIds, and not a re-report of the same occurrence.
    const second = await materializeTemplates(deps(bank), 7, T0 + 30 * 24 * 60 * 60 * 1000)
    expect(second.quizIds).toEqual([])
    expect(second.failures).toHaveLength(1)
    expect(second.failures[0]?.code).toBe("pool_exhausted")
    expect(second.failures[0]?.scheduledAt).toBeGreaterThan(T0 + 20 * 24 * 60 * 60 * 1000) // a distinct, later occurrence
  })
})
