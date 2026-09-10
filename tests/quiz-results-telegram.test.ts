import { env } from "cloudflare:test"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { BankContract, CloseResult, QuestionFull, QuizType } from "../src/core/contracts"
import { createCloseQuiz, getLeaderboard, type ResultsDeps } from "../src/services/quiz-results"
import { join, type RunDeps } from "../src/services/quiz-run"

let creatorId: string
let quizNumberSeq = 0

beforeEach(async () => {
  for (const table of ["answers", "participant_units", "participants", "quiz_seats", "quiz_questions", "quiz_units", "questions", "passages", "quizzes", "users"]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run()
  }
  creatorId = await insertUser("admin")
  quizNumberSeq = 0
})

async function insertUser(role: "admin" | "student"): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare("INSERT INTO users (id, google_sub, email, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, crypto.randomUUID(), `${id}@example.com`, "User", role, Date.now())
    .run()
  return id
}

async function makeQuestion(type: QuizType): Promise<QuestionFull> {
  const id = `hq-${crypto.randomUUID()}`
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
  const byId = new Map(pool.map((q) => [q.id, q]))
  return {
    async listUnused() {
      return []
    },
    async claimUnused() {
      return []
    },
    async getByIds(ids) {
      return ids.map((id) => byId.get(id)).filter((q): q is QuestionFull => q !== undefined)
    },
  }
}

function runDeps(pool: QuestionFull[], now: number): RunDeps {
  return { db: env.DB, kv: env.CACHE, bank: fakeBank(pool), now: () => now, hash: async (s: string) => `h:${s}` }
}

async function createOpenQuiz(opts: { seatCap: number; joinWindowSec: number; timeLimitSec: number }): Promise<{ quizId: string; roomCode: string; endsAt: number; windowSec: number; question: QuestionFull }> {
  quizNumberSeq++
  const quizId = crypto.randomUUID()
  const roomCode = `QNT-${1000 + quizNumberSeq}`
  const q = await makeQuestion("quant")
  const scheduledAt = Date.now() - 1000
  const endsAt = scheduledAt + opts.joinWindowSec * 1000
  const lobbyOpensAt = scheduledAt - 300_000
  const windowSec = opts.timeLimitSec

  await env.DB.prepare(
    `INSERT INTO quizzes (id, quiz_number, title, type, question_count, unit_count, difficulty_mix, timing_policy, slack_sec, join_window_sec, scheduled_at, lobby_opens_at, ends_at, status, room_code, seat_cap, window_sec, marks_correct, marks_wrong, created_by, created_at, opened_at)
     VALUES (?, ?, 'Hook Test Quiz', 'quant', 1, 1, '{}', '{}', 0, ?, ?, ?, ?, 'open', ?, ?, ?, 4, -1, ?, ?, ?)`
  )
    .bind(quizId, quizNumberSeq, opts.joinWindowSec, scheduledAt, lobbyOpensAt, endsAt, roomCode, opts.seatCap, windowSec, creatorId, Date.now(), Date.now())
    .run()
  await env.DB.prepare("INSERT INTO quiz_units (quiz_id, unit_position, kind, passage_id, time_limit_sec) VALUES (?, 1, 'standalone', NULL, ?)").bind(quizId, opts.timeLimitSec).run()
  await env.DB.prepare("INSERT INTO quiz_questions (quiz_id, question_id, position, unit_position, sub_position) VALUES (?, ?, 1, 1, 1)").bind(quizId, q.id).run()
  for (let seatNo = 1; seatNo <= opts.seatCap; seatNo++) {
    await env.DB.prepare("INSERT INTO quiz_seats (quiz_id, seat_no) VALUES (?, ?)").bind(quizId, seatNo).run()
  }
  return { quizId, roomCode, endsAt, windowSec, question: q }
}

describe("onQuizClosed — fires exactly once per fresh close", () => {
  it("fires from the scheduler-pass closeQuiz adapter with the exact committed CloseResult", async () => {
    const { quizId, roomCode, endsAt, windowSec, question } = await createOpenQuiz({ seatCap: 5, joinWindowSec: 600, timeLimitSec: 60 })
    await join(runDeps([question], Date.now()), roomCode, await insertUser("student"))
    const onQuizClosed = vi.fn(async () => undefined)
    const closeQuiz = createCloseQuiz(env.DB, env.CACHE, onQuizClosed)

    const safeCloseAt = endsAt + windowSec * 1000 + 5000
    const result = await closeQuiz(quizId, safeCloseAt + 1)

    expect(onQuizClosed).toHaveBeenCalledTimes(1)
    expect(onQuizClosed).toHaveBeenCalledWith(quizId, result satisfies CloseResult)
  })

  it("fires from the lazy participant-result path (getLeaderboard) identically to the cron path", async () => {
    const { quizId, roomCode, endsAt, windowSec, question } = await createOpenQuiz({ seatCap: 5, joinWindowSec: 600, timeLimitSec: 60 })
    const studentId = await insertUser("student")
    await join(runDeps([question], Date.now()), roomCode, studentId)
    const onQuizClosed = vi.fn(async () => undefined)

    const safeCloseAt = endsAt + windowSec * 1000 + 5000
    const deps: ResultsDeps = { db: env.DB, kv: env.CACHE, bank: fakeBank([]), now: () => safeCloseAt + 1, onQuizClosed }
    const outcome = await getLeaderboard(deps, quizId, studentId)

    expect(outcome.kind).toBe("ok")
    expect(onQuizClosed).toHaveBeenCalledTimes(1)
    expect(onQuizClosed).toHaveBeenCalledWith(quizId, expect.objectContaining({ boardComputedAt: safeCloseAt + 1 }))
  })

  it("does not re-fire on a repeated close of an already-published quiz", async () => {
    const { quizId, roomCode, endsAt, windowSec, question } = await createOpenQuiz({ seatCap: 5, joinWindowSec: 600, timeLimitSec: 60 })
    await join(runDeps([question], Date.now()), roomCode, await insertUser("student"))
    const onQuizClosed = vi.fn(async () => undefined)
    const closeQuiz = createCloseQuiz(env.DB, env.CACHE, onQuizClosed)

    const safeCloseAt = endsAt + windowSec * 1000 + 5000
    await closeQuiz(quizId, safeCloseAt + 1)
    await closeQuiz(quizId, safeCloseAt + 999)

    expect(onQuizClosed).toHaveBeenCalledTimes(1)
  })

  it("a throwing callback never affects the committed close or its returned result", async () => {
    const { quizId, roomCode, endsAt, windowSec, question } = await createOpenQuiz({ seatCap: 5, joinWindowSec: 600, timeLimitSec: 60 })
    await join(runDeps([question], Date.now()), roomCode, await insertUser("student"))
    const onQuizClosed = vi.fn(async () => {
      throw new Error("telegram is down")
    })
    const closeQuiz = createCloseQuiz(env.DB, env.CACHE, onQuizClosed)

    const safeCloseAt = endsAt + windowSec * 1000 + 5000
    const result = await closeQuiz(quizId, safeCloseAt + 1)

    expect(result.boardComputedAt).toBe(safeCloseAt + 1)
    const row = await env.DB.prepare("SELECT status, board_computed_at FROM quizzes WHERE id = ?").bind(quizId).first<{ status: string; board_computed_at: number }>()
    expect(row?.status).toBe("ended")
    expect(row?.board_computed_at).toBe(safeCloseAt + 1)
  })
})
