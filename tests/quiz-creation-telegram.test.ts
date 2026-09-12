import { env } from "cloudflare:test"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { BankContract, CancelledPayload, QuestionFull, QuizType, SelectionFilters } from "../src/core/contracts"
import { cancel, createDraft, type CreationDeps } from "../src/services/quiz-creation"

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
  await env.DB.prepare("INSERT INTO users (id, google_sub, email, name, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)")
    .bind(id, crypto.randomUUID(), `${id}@example.com`, "Admin", Date.now())
    .run()
  return id
}

async function makeStandalone(type: QuizType): Promise<QuestionFull> {
  const id = `ct-q-${crypto.randomUUID()}`
  await env.DB.prepare(
    `INSERT INTO questions (id, type, topic, difficulty, format, body_md, option_a, option_b, option_c, option_d, correct_option, explanation_md, created_by, created_at)
     VALUES (?, ?, 'Topic', 'easy', 'mcq', 'Body', 'A', 'B', 'C', 'D', 'A', 'Explanation', ?, ?)`
  )
    .bind(id, type, creatorId, Date.now())
    .run()
  return {
    id,
    type,
    topic: "Topic",
    subtopic: null,
    difficulty: "easy",
    format: "mcq",
    passageId: null,
    groupPosition: null,
    bodyMd: "Body",
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

function fakeBank(pool: QuestionFull[]): BankContract {
  return {
    async listUnused(filters: SelectionFilters) {
      return pool.filter((q) => q.type === filters.type)
    },
    async claimUnused(ids) {
      return ids
    },
    async getByIds(ids) {
      const byId = new Map(pool.map((q) => [q.id, q]))
      return ids.map((id) => byId.get(id)).filter((q): q is QuestionFull => q !== undefined)
    },
  }
}

function deps(bank: BankContract, overrides: Partial<CreationDeps> = {}): CreationDeps {
  return { db: env.DB, bank, now: () => 1_700_000_000_000, random: () => 0.42, ...overrides }
}

async function createDraftQuiz(onQuizCancelled?: CreationDeps["onQuizCancelled"]) {
  const pool = await Promise.all([makeStandalone("quant"), makeStandalone("quant")])
  const created = await createDraft(deps(fakeBank(pool), { onQuizCancelled }), creatorId, {
    mode: "auto",
    title: "Cancel Hook Quiz",
    scheduledAt: 1_700_100_000_000,
    type: "quant",
    difficultyMix: { easy: 2 },
    count: 2,
  })
  if (created.kind !== "ok") throw new Error("test setup failed: draft creation did not succeed")
  return created.response.quizId
}

describe("onQuizCancelled — fires exactly once per successful cancellation", () => {
  it("fires with the exact CancelledPayload built from the draft's own title/scheduledAt", async () => {
    const onQuizCancelled = vi.fn(async () => undefined)
    const quizId = await createDraftQuiz(onQuizCancelled)

    const result = await cancel(deps(fakeBank([]), { onQuizCancelled }), quizId)

    expect(result.kind).toBe("ok")
    expect(onQuizCancelled).toHaveBeenCalledTimes(1)
    const expectedPayload: CancelledPayload = { title: "Cancel Hook Quiz", scheduledAt: 1_700_100_000_000 }
    expect(onQuizCancelled).toHaveBeenCalledWith(quizId, expectedPayload)
  })

  it("never fires for a not_found or conflict outcome", async () => {
    const onQuizCancelled = vi.fn(async () => undefined)
    const missing = await cancel(deps(fakeBank([]), { onQuizCancelled }), "unknown-quiz-id")
    expect(missing.kind).toBe("not_found")
    expect(onQuizCancelled).not.toHaveBeenCalled()

    const quizId = await createDraftQuiz(onQuizCancelled)
    await cancel(deps(fakeBank([]), { onQuizCancelled }), quizId) // first cancel succeeds
    onQuizCancelled.mockClear()
    const again = await cancel(deps(fakeBank([]), { onQuizCancelled }), quizId) // already cancelled
    expect(again.kind).toBe("conflict")
    expect(onQuizCancelled).not.toHaveBeenCalled()
  })

  it("a throwing callback never affects the committed cancellation or the route's response", async () => {
    const onQuizCancelled = vi.fn(async () => {
      throw new Error("telegram is down")
    })
    const quizId = await createDraftQuiz(onQuizCancelled)

    const result = await cancel(deps(fakeBank([]), { onQuizCancelled }), quizId)

    expect(result.kind).toBe("ok")
    if (result.kind === "ok") expect(result.summary.status).toBe("cancelled")
    const row = await env.DB.prepare("SELECT status FROM quizzes WHERE id = ?").bind(quizId).first<{ status: string }>()
    expect(row?.status).toBe("cancelled")
  })
})
