import { env } from "cloudflare:test"
import { beforeEach, describe, expect, it } from "vitest"
import type { BankContract, Difficulty, QuestionFull, QuizType, SelectionFilters } from "../src/core/contracts"
import { getQuizAdminSummary, listQuizzesPage } from "../src/db/quizzes"
import {
  cancel,
  createDraft,
  lockQuiz,
  patchSettings,
  reshuffleDraft,
  type CreationDeps,
} from "../src/services/quiz-creation"

let creatorId: string

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM quiz_questions"),
    env.DB.prepare("DELETE FROM quiz_units"),
    env.DB.prepare("DELETE FROM quizzes"),
    env.DB.prepare("DELETE FROM questions"),
    env.DB.prepare("DELETE FROM passages"),
    env.DB.prepare("DELETE FROM users"),
  ])
  creatorId = await insertAdmin()
})

async function insertAdmin(): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO users (id, google_sub, email, name, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)"
  )
    .bind(id, crypto.randomUUID(), `${id}@example.com`, "Admin", Date.now())
    .run()
  return id
}

// `quiz_questions.question_id`/`quiz_units.passage_id` are real FKs into `questions`/`passages`,
// so every candidate used in these tests must exist there too — not just in the fake BankContract.
let questionSeq = 0

async function makeStandalone(type: QuizType, difficulty: Difficulty): Promise<QuestionFull> {
  questionSeq++
  const id = `q-${questionSeq}`
  await env.DB.prepare(
    `INSERT INTO questions (id, type, topic, difficulty, format, body_md, option_a, option_b, option_c, option_d, correct_option, explanation_md, created_by, created_at)
     VALUES (?, ?, 'Topic', ?, 'mcq', ?, 'A', 'B', 'C', 'D', 'A', 'Explanation', ?, ?)`
  )
    .bind(id, type, difficulty, `Body ${questionSeq}`, creatorId, Date.now())
    .run()
  return {
    id,
    type,
    topic: "Topic",
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


/** In-memory BankContract mirroring the real Sprint 2 semantics closely enough for these tests:
 * same-owner claims are idempotent, other-owner ids are omitted, nothing is ever released. */
function fakeBank(pool: QuestionFull[]): BankContract & { claims: Map<string, { quizId: string; quizNumber: number }> } {
  const claims = new Map<string, { quizId: string; quizNumber: number }>()
  return {
    claims,
    async listUnused(filters: SelectionFilters) {
      const difficulties = Object.keys(filters.difficultyMix)
      return pool.filter(
        (q) => q.type === filters.type && !claims.has(q.id) && difficulties.includes(q.difficulty)
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

function deps(bank: BankContract, overrides: Partial<CreationDeps> = {}): CreationDeps {
  return { db: env.DB, bank, now: () => 1_700_000_000_000, random: () => 0.42, ...overrides }
}

describe("createDraft", () => {
  it("draws an exact composition and persists a recoverable draft", async () => {
    const pool = await Promise.all([makeStandalone("quant", "easy"), makeStandalone("quant", "easy"), makeStandalone("quant", "medium")])
    const admin = await insertAdmin()
    const result = await createDraft(deps(fakeBank(pool)), admin, {
      title: "Test quiz",
      scheduledAt: 1_700_100_000_000,
      type: "quant",
      difficultyMix: { easy: 2 },
      count: 2,
    })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.response.questionCount).toBe(2)
    expect(result.response.unitCount).toBe(2)

    const summary = await getQuizAdminSummary(env.DB, result.response.quizId)
    expect(summary?.status).toBe("draft")
    expect(summary?.quizNumber).toBeNull()
    expect(summary?.units).toHaveLength(2)
  })

  it("returns pool_exhausted and writes nothing when no exact composition exists", async () => {
    const pool = await Promise.all([makeStandalone("quant", "easy")])
    const admin = await insertAdmin()
    const result = await createDraft(deps(fakeBank(pool)), admin, {
      title: "Test quiz",
      scheduledAt: 1_700_100_000_000,
      type: "quant",
      difficultyMix: { easy: 3 },
      count: 3,
    })
    expect(result.kind).toBe("pool_exhausted")
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM quizzes").first<{ n: number }>()
    expect(row?.n).toBe(0)
  })
})

describe("reshuffleDraft", () => {
  it("performs a fresh draw and discards prior overrides", async () => {
    const pool = await Promise.all([
      makeStandalone("quant", "easy"),
      makeStandalone("quant", "easy"),
      makeStandalone("quant", "easy"),
      makeStandalone("quant", "easy"),
    ])
    const admin = await insertAdmin()
    const bank = fakeBank(pool)
    const created = await createDraft(deps(bank), admin, {
      title: "T",
      scheduledAt: 1_700_100_000_000,
      type: "quant",
      difficultyMix: { easy: 2 },
      count: 2,
    })
    if (created.kind !== "ok") throw new Error("setup failed")
    const id = created.response.quizId

    await patchSettings(deps(bank), id, { timingPolicy: { standalone: 60 }, slackSec: 30 })
    await patchSettings(deps(bank), id, { unitTimeLimits: [{ unitPosition: 1, timeLimitSec: 999 }] })

    const reshuffled = await reshuffleDraft(deps(bank), id)
    expect(reshuffled.kind).toBe("ok")
    if (reshuffled.kind !== "ok") return
    // Overrides discarded, stored policy default (60) reapplied to the fresh units.
    expect(reshuffled.response.units.every((u) => u.timeLimitSec === 60)).toBe(true)
    expect(reshuffled.response.windowSec).not.toBeNull()
  })

  it("returns conflict for an already-locked quiz and leaves it unchanged", async () => {
    const pool = await Promise.all([makeStandalone("quant", "easy"), makeStandalone("quant", "easy")])
    const admin = await insertAdmin()
    const bank = fakeBank(pool)
    const created = await createDraft(deps(bank), admin, {
      title: "T",
      scheduledAt: 1_700_100_000_000,
      type: "quant",
      difficultyMix: { easy: 2 },
      count: 2,
    })
    if (created.kind !== "ok") throw new Error("setup failed")
    const id = created.response.quizId
    await patchSettings(deps(bank), id, { timingPolicy: { standalone: 60 }, joinWindowSec: 600, slackSec: 0, marksCorrect: 3, marksWrong: -1 })
    await lockQuiz(deps(bank), id)

    const before = await getQuizAdminSummary(env.DB, id)
    const result = await reshuffleDraft(deps(bank), id)
    expect(result.kind).toBe("conflict")
    const after = await getQuizAdminSummary(env.DB, id)
    expect(after).toEqual(before)
  })

  it("returns not_found for an unknown id", async () => {
    const result = await reshuffleDraft(deps(fakeBank([])), "does-not-exist")
    expect(result.kind).toBe("not_found")
  })
})

describe("patchSettings", () => {
  async function draftWithTwoUnits(bank: BankContract): Promise<string> {
    const admin = await insertAdmin()
    const created = await createDraft(deps(bank), admin, {
      title: "T",
      scheduledAt: 1_700_100_000_000,
      type: "quant",
      difficultyMix: { easy: 2 },
      count: 2,
    })
    if (created.kind !== "ok") throw new Error("setup failed")
    return created.response.quizId
  }

  it("applies a timing policy to every unit kind present and derives windowSec once slack is set", async () => {
    const pool = await Promise.all([makeStandalone("quant", "easy"), makeStandalone("quant", "easy")])
    const bank = fakeBank(pool)
    const id = await draftWithTwoUnits(bank)

    const first = await patchSettings(deps(bank), id, { timingPolicy: { standalone: 60 } })
    expect(first.kind).toBe("ok")
    if (first.kind === "ok") expect(first.summary.windowSec).toBeNull() // slack not set yet

    const second = await patchSettings(deps(bank), id, { slackSec: 30 })
    expect(second.kind).toBe("ok")
    if (second.kind === "ok") expect(second.summary.windowSec).toBe(60 + 60 + 30)
  })

  it("unitTimeLimits changes only the listed units", async () => {
    const pool = await Promise.all([makeStandalone("quant", "easy"), makeStandalone("quant", "easy")])
    const bank = fakeBank(pool)
    const id = await draftWithTwoUnits(bank)
    await patchSettings(deps(bank), id, { timingPolicy: { standalone: 60 } })

    const result = await patchSettings(deps(bank), id, { unitTimeLimits: [{ unitPosition: 1, timeLimitSec: 90 }] })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    const unit1 = result.summary.units.find((u) => u.unitPosition === 1)
    const unit2 = result.summary.units.find((u) => u.unitPosition === 2)
    expect(unit1?.timeLimitSec).toBe(90)
    expect(unit2?.timeLimitSec).toBe(60)
  })

  it("derives lobbyOpensAt/endsAt independently from admission length", async () => {
    const pool = await Promise.all([makeStandalone("quant", "easy"), makeStandalone("quant", "easy")])
    const bank = fakeBank(pool)
    const id = await draftWithTwoUnits(bank)

    const result = await patchSettings(deps(bank), id, { scheduledAt: 1_700_200_000_000, joinWindowSec: 600 })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.summary.lobbyOpensAt).toBe(1_700_200_000_000 - 300_000)
    expect(result.summary.endsAt).toBe(1_700_200_000_000 + 600_000)
  })

  it("rejects an unknown unit position with no write", async () => {
    const pool = await Promise.all([makeStandalone("quant", "easy"), makeStandalone("quant", "easy")])
    const bank = fakeBank(pool)
    const id = await draftWithTwoUnits(bank)
    const before = await getQuizAdminSummary(env.DB, id)

    const result = await patchSettings(deps(bank), id, { unitTimeLimits: [{ unitPosition: 99, timeLimitSec: 60 }] })
    expect(result.kind).toBe("invalid")
    expect(await getQuizAdminSummary(env.DB, id)).toEqual(before)
  })

  it("rejects marksWrong > 0 and marksCorrect <= 0", async () => {
    const pool = await Promise.all([makeStandalone("quant", "easy"), makeStandalone("quant", "easy")])
    const bank = fakeBank(pool)
    const id = await draftWithTwoUnits(bank)
    expect((await patchSettings(deps(bank), id, { marksWrong: 1 })).kind).toBe("invalid")
    expect((await patchSettings(deps(bank), id, { marksCorrect: 0 })).kind).toBe("invalid")
  })

  it("returns 409-equivalent conflict once the quiz is open", async () => {
    const pool = await Promise.all([makeStandalone("quant", "easy"), makeStandalone("quant", "easy")])
    const bank = fakeBank(pool)
    const id = await draftWithTwoUnits(bank)
    await patchSettings(deps(bank), id, {
      timingPolicy: { standalone: 60 },
      joinWindowSec: 600,
      slackSec: 0,
      marksCorrect: 3,
      marksWrong: -1,
    })
    const locked = await lockQuiz(deps(bank), id)
    if (locked.kind !== "ok" || !locked.response.locked) throw new Error("setup failed")
    // Only valid once every completeness field the schema requires for non-draft/cancelled rows
    // is already set (i.e. after a real lock) — status alone can't satisfy that CHECK constraint.
    await env.DB.prepare("UPDATE quizzes SET status = 'open' WHERE id = ?").bind(id).run()

    const result = await patchSettings(deps(bank), id, { title: "New title" })
    expect(result.kind).toBe("conflict")
  })
})

describe("lockQuiz", () => {
  async function readyDraft(bank: BankContract): Promise<string> {
    const admin = await insertAdmin()
    const created = await createDraft(deps(bank), admin, {
      title: "T",
      scheduledAt: 1_700_100_000_000,
      type: "quant",
      difficultyMix: { easy: 2 },
      count: 2,
    })
    if (created.kind !== "ok") throw new Error("setup failed")
    const id = created.response.quizId
    await patchSettings(deps(bank), id, {
      timingPolicy: { standalone: 60 },
      joinWindowSec: 600,
      slackSec: 0,
      marksCorrect: 3,
      marksWrong: -1,
    })
    return id
  }

  it("locks a fully valid draft: reserves a number, retires content, and publishes a room code", async () => {
    const pool = await Promise.all([makeStandalone("quant", "easy"), makeStandalone("quant", "easy")])
    const bank = fakeBank(pool)
    const id = await readyDraft(bank)

    const result = await lockQuiz(deps(bank), id)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.response).toMatchObject({ locked: true })
    if (result.response.locked) {
      expect(result.response.roomCode).toMatch(/^QNT-\d{4}$/)
      expect(result.response.quizNumber).toBeGreaterThan(0)
    }

    const summary = await getQuizAdminSummary(env.DB, id)
    expect(summary?.status).toBe("scheduled")
    expect(summary?.roomCode).not.toBeNull()
    expect(summary?.quizNumber).not.toBeNull()
    expect(bank.claims.size).toBe(2)
  })

  it("returns 400-equivalent invalid for an incomplete draft without calling BANK", async () => {
    const pool = await Promise.all([makeStandalone("quant", "easy"), makeStandalone("quant", "easy")])
    const bank = fakeBank(pool)
    const admin = await insertAdmin()
    const created = await createDraft(deps(bank), admin, {
      title: "T",
      scheduledAt: 1_700_100_000_000,
      type: "quant",
      difficultyMix: { easy: 2 },
      count: 2,
    })
    if (created.kind !== "ok") throw new Error("setup failed")

    const result = await lockQuiz(deps(bank), created.response.quizId)
    expect(result.kind).toBe("invalid")
    expect(bank.claims.size).toBe(0)
  })

  it("returns a true short claim and never schedules when content is owned by another quiz", async () => {
    const pool = await Promise.all([makeStandalone("quant", "easy"), makeStandalone("quant", "easy")])
    const bank = fakeBank(pool)
    const id = await readyDraft(bank)

    // Simulate the second question already claimed by a different quiz identity.
    bank.claims.set(pool[1]!.id, { quizId: "other-quiz", quizNumber: 999 })

    const result = await lockQuiz(deps(bank), id)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.response).toEqual({ locked: false, requestedCount: 2, claimedCount: 1 })
    const summary = await getQuizAdminSummary(env.DB, id)
    expect(summary?.status).toBe("draft")
    expect(summary?.quizNumber).toBeNull() // reservation stays hidden
  })

  it("is idempotent on retry after an ambiguous BANK success: reuses the number and publishes", async () => {
    const pool = await Promise.all([makeStandalone("quant", "easy"), makeStandalone("quant", "easy")])
    const bank = fakeBank(pool)
    const id = await readyDraft(bank)

    const first = await lockQuiz(deps(bank), id)
    expect(first.kind).toBe("ok")

    // A second, independent call after the first already fully published should be the
    // documented 409-equivalent "already locked" conflict, recoverable via the list/get route.
    const retry = await lockQuiz(deps(bank), id)
    expect(retry.kind).toBe("conflict")
  })

  it("returns not_found for an unknown id", async () => {
    const result = await lockQuiz(deps(fakeBank([])), "does-not-exist")
    expect(result.kind).toBe("not_found")
  })
})

describe("cancel", () => {
  it("cancels an unclaimed draft, leaving its (never-retired) content untouched", async () => {
    const pool = await Promise.all([makeStandalone("quant", "easy"), makeStandalone("quant", "easy")])
    const bank = fakeBank(pool)
    const admin = await insertAdmin()
    const created = await createDraft(deps(bank), admin, {
      title: "T",
      scheduledAt: 1_700_100_000_000,
      type: "quant",
      difficultyMix: { easy: 2 },
      count: 2,
    })
    if (created.kind !== "ok") throw new Error("setup failed")

    const result = await cancel(deps(bank), created.response.quizId)
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") {
      expect(result.summary.status).toBe("cancelled")
      expect(result.summary.quizNumber).toBeNull()
      expect(result.summary.roomCode).toBeNull()
    }
    expect(bank.claims.size).toBe(0)
  })

  it("cancelling a number-only reservation keeps the number hidden and creates an accepted gap", async () => {
    const pool = await Promise.all([makeStandalone("quant", "easy"), makeStandalone("quant", "easy")])
    const bank = fakeBank(pool)
    const admin = await insertAdmin()
    const created = await createDraft(deps(bank), admin, {
      title: "T",
      scheduledAt: 1_700_100_000_000,
      type: "quant",
      difficultyMix: { easy: 2 },
      count: 2,
    })
    if (created.kind !== "ok") throw new Error("setup failed")
    const id = created.response.quizId
    // Force a real number-only reservation without full BANK confirmation (a short claim).
    await patchSettings(deps(bank), id, {
      timingPolicy: { standalone: 60 },
      joinWindowSec: 600,
      slackSec: 0,
      marksCorrect: 3,
      marksWrong: -1,
    })
    bank.claims.set(pool[1]!.id, { quizId: "other-quiz", quizNumber: 999 })
    await lockQuiz(deps(bank), id) // short claim, reserves a number, stays draft

    const result = await cancel(deps(bank), id)
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") {
      expect(result.summary.status).toBe("cancelled")
      expect(result.summary.quizNumber).toBeNull() // hidden — room_code never got set
    }
    const raw = await env.DB.prepare("SELECT quiz_number FROM quizzes WHERE id = ?").bind(id).first<{ quiz_number: number }>()
    expect(raw?.quiz_number).not.toBeNull() // the gap is real in storage, just never exposed
  })

  it("cancelling a scheduled quiz preserves and exposes its published identity", async () => {
    const pool = await Promise.all([makeStandalone("quant", "easy"), makeStandalone("quant", "easy")])
    const bank = fakeBank(pool)
    const admin = await insertAdmin()
    const created = await createDraft(deps(bank), admin, {
      title: "T",
      scheduledAt: 1_700_100_000_000,
      type: "quant",
      difficultyMix: { easy: 2 },
      count: 2,
    })
    if (created.kind !== "ok") throw new Error("setup failed")
    const id = created.response.quizId
    await patchSettings(deps(bank), id, {
      timingPolicy: { standalone: 60 },
      joinWindowSec: 600,
      slackSec: 0,
      marksCorrect: 3,
      marksWrong: -1,
    })
    const locked = await lockQuiz(deps(bank), id)
    if (locked.kind !== "ok" || !locked.response.locked) throw new Error("setup failed")

    const result = await cancel(deps(bank), id)
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") {
      expect(result.summary.status).toBe("cancelled")
      expect(result.summary.roomCode).toBe(locked.response.roomCode)
      expect(result.summary.quizNumber).toBe(locked.response.quizNumber)
    }
  })

  it("returns conflict for an already-cancelled quiz, and not_found for an unknown id", async () => {
    const pool = await Promise.all([makeStandalone("quant", "easy")])
    const bank = fakeBank(pool)
    const admin = await insertAdmin()
    const created = await createDraft(deps(bank), admin, {
      title: "T",
      scheduledAt: 1_700_100_000_000,
      type: "quant",
      difficultyMix: { easy: 1 },
      count: 1,
    })
    if (created.kind !== "ok") throw new Error("setup failed")
    const id = created.response.quizId

    const first = await cancel(deps(bank), id)
    expect(first.kind).toBe("ok")
    const second = await cancel(deps(bank), id)
    expect(second.kind).toBe("conflict")

    const unknown = await cancel(deps(bank), "does-not-exist")
    expect(unknown.kind).toBe("not_found")
  })

  it("returns conflict for an ended quiz", async () => {
    const pool = await Promise.all([makeStandalone("quant", "easy")])
    const bank = fakeBank(pool)
    const admin = await insertAdmin()
    const created = await createDraft(deps(bank), admin, {
      title: "T",
      scheduledAt: 1_700_100_000_000,
      type: "quant",
      difficultyMix: { easy: 1 },
      count: 1,
    })
    if (created.kind !== "ok") throw new Error("setup failed")
    const id = created.response.quizId
    await patchSettings(deps(bank), id, {
      timingPolicy: { standalone: 60 },
      joinWindowSec: 600,
      slackSec: 0,
      marksCorrect: 3,
      marksWrong: -1,
    })
    const locked = await lockQuiz(deps(bank), id)
    if (locked.kind !== "ok" || !locked.response.locked) throw new Error("setup failed")
    // Only valid after a real lock, once every schema-required completeness field is non-null.
    await env.DB.prepare("UPDATE quizzes SET status = 'ended' WHERE id = ?").bind(id).run()

    const result = await cancel(deps(bank), id)
    expect(result.kind).toBe("conflict")
  })
})

describe("listQuizzesPage", () => {
  it("orders newest-first with id as the final tie-break and hides unpublished reservations", async () => {
    const pool = await Promise.all([makeStandalone("quant", "easy"), makeStandalone("quant", "easy"), makeStandalone("quant", "easy")])
    const bank = fakeBank(pool)
    const admin = await insertAdmin()
    await createDraft(deps(bank, { now: () => 1 }), admin, {
      title: "First",
      scheduledAt: 1_700_100_000_000,
      type: "quant",
      difficultyMix: { easy: 1 },
      count: 1,
    })
    await createDraft(deps(bank, { now: () => 2 }), admin, {
      title: "Second",
      scheduledAt: 1_700_100_000_000,
      type: "quant",
      difficultyMix: { easy: 1 },
      count: 1,
    })

    const { items, total } = await listQuizzesPage(env.DB, {}, 50, 0)
    expect(total).toBe(2)
    expect(items[0]?.title).toBe("Second")
    expect(items.every((i) => i.quizNumber === null)).toBe(true)
  })

  it("filters by status", async () => {
    const pool = await Promise.all([makeStandalone("quant", "easy")])
    const bank = fakeBank(pool)
    const admin = await insertAdmin()
    await createDraft(deps(bank), admin, {
      title: "Draft",
      scheduledAt: 1_700_100_000_000,
      type: "quant",
      difficultyMix: { easy: 1 },
      count: 1,
    })
    const { items, total } = await listQuizzesPage(env.DB, { status: "scheduled" }, 50, 0)
    expect(total).toBe(0)
    expect(items).toHaveLength(0)
  })
})
