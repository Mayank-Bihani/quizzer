import { env } from "cloudflare:test"
import { beforeEach, describe, expect, it } from "vitest"
import type { BankContract, QuestionFull, QuizType } from "../src/core/contracts"
import { closeQuizTransaction, getQuizLifecycle, isParticipant, safeCloseAtFor } from "../src/db/results"
import { getHistory, getLeaderboard, getReview } from "../src/services/quiz-results"
import { join, submit, type RunDeps } from "../src/services/quiz-run"

let creatorId: string
let questionSeq = 0
let quizNumberSeq = 0

beforeEach(async () => {
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
  creatorId = await insertUser("admin")
  questionSeq = 0
  quizNumberSeq = 0
})

async function insertUser(role: "admin" | "student", name = "User"): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare("INSERT INTO users (id, google_sub, email, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, crypto.randomUUID(), `${id}@example.com`, name, role, Date.now())
    .run()
  return id
}

async function makeQuestion(type: QuizType, correctOption: "A" | "B" | "C" | "D" = "A"): Promise<QuestionFull> {
  questionSeq++
  const id = `rq-${questionSeq}`
  await env.DB.prepare(
    `INSERT INTO questions (id, type, topic, difficulty, format, body_md, option_a, option_b, option_c, option_d, correct_option, explanation_md, created_by, created_at)
     VALUES (?, ?, 'Topic', 'easy', 'mcq', ?, 'Opt A', 'Opt B', 'Opt C', 'Opt D', ?, 'Explanation', ?, ?)`
  )
    .bind(id, type, `Body ${questionSeq}`, correctOption, creatorId, Date.now())
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
    bodyMd: `Body ${questionSeq}`,
    imageUrl: null,
    optionA: "Opt A",
    optionB: "Opt B",
    optionC: "Opt C",
    optionD: "Opt D",
    correctOption,
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
      const found: QuestionFull[] = []
      for (const id of ids) {
        const q = byId.get(id)
        if (q) found.push(q)
      }
      return found
    },
  }
}

function runDeps(pool: QuestionFull[], now: number): RunDeps {
  return { db: env.DB, kv: env.CACHE, bank: fakeBank(pool), now: () => now, hash: async (s: string) => `h:${s}` }
}

type UnitSpec = { timeLimitSec: number; questions: QuestionFull[] }

async function createOpenQuiz(opts: { seatCap: number; scheduledAt: number; joinWindowSec: number; units: UnitSpec[] }): Promise<{
  quizId: string
  roomCode: string
  windowSec: number
  endsAt: number
}> {
  quizNumberSeq++
  const quizId = crypto.randomUUID()
  const roomCode = `QNT-${1000 + quizNumberSeq}`
  const endsAt = opts.scheduledAt + opts.joinWindowSec * 1000
  const lobbyOpensAt = opts.scheduledAt - 300_000
  const windowSec = opts.units.reduce((sum, u) => sum + u.timeLimitSec, 0)
  const questionCount = opts.units.reduce((sum, u) => sum + u.questions.length, 0)

  await env.DB.prepare(
    `INSERT INTO quizzes (id, quiz_number, title, type, question_count, unit_count, difficulty_mix, timing_policy, slack_sec, join_window_sec, scheduled_at, lobby_opens_at, ends_at, status, room_code, seat_cap, window_sec, marks_correct, marks_wrong, created_by, created_at, opened_at)
     VALUES (?, ?, 'Results Test Quiz', 'quant', ?, ?, '{}', '{}', 0, ?, ?, ?, ?, 'open', ?, ?, ?, 4, -1, ?, ?, ?)`
  )
    .bind(
      quizId,
      quizNumberSeq,
      questionCount,
      opts.units.length,
      opts.joinWindowSec,
      opts.scheduledAt,
      lobbyOpensAt,
      endsAt,
      roomCode,
      opts.seatCap,
      windowSec,
      creatorId,
      Date.now(),
      Date.now()
    )
    .run()

  let position = 1
  let unitPosition = 1
  for (const unit of opts.units) {
    await env.DB.prepare("INSERT INTO quiz_units (quiz_id, unit_position, kind, passage_id, time_limit_sec) VALUES (?, ?, 'standalone', NULL, ?)")
      .bind(quizId, unitPosition, unit.timeLimitSec)
      .run()
    for (const q of unit.questions) {
      await env.DB.prepare("INSERT INTO quiz_questions (quiz_id, question_id, position, unit_position, sub_position) VALUES (?, ?, ?, ?, 1)")
        .bind(quizId, q.id, position, unitPosition)
        .run()
      position++
    }
    unitPosition++
  }
  for (let seatNo = 1; seatNo <= opts.seatCap; seatNo++) {
    await env.DB.prepare("INSERT INTO quiz_seats (quiz_id, seat_no) VALUES (?, ?)").bind(quizId, seatNo).run()
  }

  return { quizId, roomCode, windowSec, endsAt }
}

describe("closeQuizTransaction", () => {
  it("returns not_eligible strictly before and at the safe-close boundary, and publishes exactly after it", async () => {
    const q = await makeQuestion("quant")
    const { quizId, roomCode, endsAt, windowSec } = await createOpenQuiz({
      seatCap: 5,
      scheduledAt: Date.now(),
      joinWindowSec: 600,
      units: [{ timeLimitSec: 60, questions: [q] }],
    })
    const safeCloseAt = endsAt + windowSec * 1000 + 5000
    await join(runDeps([q], Date.now()), roomCode, await insertUser("student"))

    const before = await closeQuizTransaction(env.DB, quizId, safeCloseAt - 1)
    expect(before).toEqual({ kind: "not_eligible" })
    const atBoundary = await closeQuizTransaction(env.DB, quizId, safeCloseAt)
    expect(atBoundary).toEqual({ kind: "not_eligible" })

    const after = await closeQuizTransaction(env.DB, quizId, safeCloseAt + 1)
    expect(after.kind).toBe("ok")
    const lifecycle = await getQuizLifecycle(env.DB, quizId)
    expect(lifecycle?.status).toBe("ended")
    expect(lifecycle?.boardComputedAt).toBe(safeCloseAt + 1)
  })

  it("does nothing for a draft/scheduled/cancelled quiz", async () => {
    const q = await makeQuestion("quant")
    const { quizId } = await createOpenQuiz({ seatCap: 5, scheduledAt: Date.now(), joinWindowSec: 600, units: [{ timeLimitSec: 60, questions: [q] }] })
    await env.DB.prepare("UPDATE quizzes SET status = 'cancelled' WHERE id = ?").bind(quizId).run()
    const result = await closeQuizTransaction(env.DB, quizId, Date.now() + 10_000_000)
    expect(result).toEqual({ kind: "not_eligible" })
  })

  it("returns not_found for an unknown quiz", async () => {
    const result = await closeQuizTransaction(env.DB, "nope", Date.now())
    expect(result).toEqual({ kind: "not_found" })
  })

  it("settles an abandoned mid-unit participant, accounts unreached questions, and finishes them exactly once", async () => {
    const q1 = await makeQuestion("quant", "A")
    const q2 = await makeQuestion("quant", "B")
    const { quizId, roomCode, endsAt, windowSec } = await createOpenQuiz({
      seatCap: 5,
      scheduledAt: Date.now(),
      joinWindowSec: 600,
      units: [
        { timeLimitSec: 60, questions: [q1] },
        { timeLimitSec: 60, questions: [q2] },
      ],
    })
    const studentId = await insertUser("student")
    const joinedAt = Date.now()
    await join(runDeps([q1, q2], joinedAt), roomCode, studentId)
    // Never submit — abandoned mid unit 1.

    const safeCloseAt = endsAt + windowSec * 1000 + 5000
    const result = await closeQuizTransaction(env.DB, quizId, safeCloseAt + 1)
    expect(result.kind).toBe("ok")

    const participant = await env.DB.prepare(
      "SELECT finished_at, correct_count, wrong_count, skipped_count, unanswered_count, rank FROM participants WHERE quiz_id=? AND user_id=?"
    )
      .bind(quizId, studentId)
      .first<{ finished_at: number | null; correct_count: number; wrong_count: number; skipped_count: number; unanswered_count: number; rank: number | null }>()
    expect(participant?.finished_at).not.toBeNull()
    expect(participant?.correct_count ?? 0 + (participant?.wrong_count ?? 0) + (participant?.skipped_count ?? 0)).toBe(0)
    expect(participant?.unanswered_count).toBe(2) // unit 1 abandoned + unit 2 unreached
    expect(participant?.rank).toBe(1)

    const unit2Row = await env.DB.prepare("SELECT 1 FROM participant_units WHERE quiz_id=? AND user_id=? AND unit_position=2").bind(quizId, studentId).first()
    expect(unit2Row).toBeNull() // never started
  })

  it("closes a zero-participant quiz cleanly and remains idempotent", async () => {
    const q = await makeQuestion("quant")
    const { quizId, endsAt, windowSec } = await createOpenQuiz({ seatCap: 5, scheduledAt: Date.now(), joinWindowSec: 600, units: [{ timeLimitSec: 60, questions: [q] }] })
    const safeCloseAt = endsAt + windowSec * 1000 + 5000
    const result = await closeQuizTransaction(env.DB, quizId, safeCloseAt + 1)
    expect(result).toEqual({ kind: "ok", result: { participantCount: 0, top10: [], boardComputedAt: safeCloseAt + 1 }, fresh: true })

    const again = await closeQuizTransaction(env.DB, quizId, safeCloseAt + 999)
    // unchanged, reconstructed — fresh:false is exactly what tells Sprint 6's onQuizClosed hook
    // not to re-fire TG-4 on this idempotent re-read.
    expect(again).toEqual({ kind: "ok", result: { participantCount: 0, top10: [], boardComputedAt: safeCloseAt + 1 }, fresh: false })
  })

  it("converges concurrent closes on one committed result with no duplicate settlement", async () => {
    const q = await makeQuestion("quant")
    const { quizId, roomCode, endsAt, windowSec } = await createOpenQuiz({
      seatCap: 5,
      scheduledAt: Date.now(),
      joinWindowSec: 600,
      units: [{ timeLimitSec: 60, questions: [q] }],
    })
    const studentId = await insertUser("student")
    await join(runDeps([q], Date.now()), roomCode, studentId)
    const safeCloseAt = endsAt + windowSec * 1000 + 5000

    const [a, b] = await Promise.all([closeQuizTransaction(env.DB, quizId, safeCloseAt + 1), closeQuizTransaction(env.DB, quizId, safeCloseAt + 1)])
    expect(a.kind).toBe("ok")
    expect(b.kind).toBe("ok")
    if (a.kind === "ok" && b.kind === "ok") expect(a.result).toEqual(b.result)

    const participant = await env.DB.prepare("SELECT unanswered_count FROM participants WHERE quiz_id=? AND user_id=?").bind(quizId, studentId).first<{ unanswered_count: number }>()
    expect(participant?.unanswered_count).toBe(1) // settled exactly once, not twice
  })

  it("finished participants keep their committed score unchanged by close", async () => {
    const q = await makeQuestion("quant", "A")
    const { quizId, roomCode, endsAt, windowSec } = await createOpenQuiz({
      seatCap: 5,
      scheduledAt: Date.now(),
      joinWindowSec: 600,
      units: [{ timeLimitSec: 60, questions: [q] }],
    })
    const studentId = await insertUser("student")
    const joinedAt = Date.now()
    await join(runDeps([q], joinedAt), roomCode, studentId)
    await submit(runDeps([q], joinedAt + 1000), quizId, studentId, 1, {
      submissionId: "s1",
      reason: "complete",
      answers: [{ position: 1, status: "answered", format: "mcq", chosenOption: "A" }],
    })

    const safeCloseAt = endsAt + windowSec * 1000 + 5000
    await closeQuizTransaction(env.DB, quizId, safeCloseAt + 1)
    const participant = await env.DB.prepare("SELECT total_score, finished_at FROM participants WHERE quiz_id=? AND user_id=?").bind(quizId, studentId).first<{ total_score: number; finished_at: number }>()
    expect(participant?.total_score).toBe(4)
  })
})

describe("getLeaderboard (service) — lazy close + gating", () => {
  it("returns locked before the safe-close boundary and lazily publishes once it has passed", async () => {
    const q = await makeQuestion("quant")
    const { quizId, roomCode, endsAt, windowSec } = await createOpenQuiz({
      seatCap: 5,
      scheduledAt: Date.now(),
      joinWindowSec: 600,
      units: [{ timeLimitSec: 60, questions: [q] }],
    })
    const studentId = await insertUser("student")
    await join(runDeps([q], Date.now()), roomCode, studentId)
    const safeCloseAt = endsAt + windowSec * 1000 + 5000

    const deps = { db: env.DB, kv: env.CACHE, bank: fakeBank([q]), now: () => safeCloseAt - 1 }
    const early = await getLeaderboard(deps, quizId, studentId)
    expect(early.kind).toBe("locked")

    const late = await getLeaderboard({ ...deps, now: () => safeCloseAt + 1 }, quizId, studentId)
    expect(late.kind).toBe("ok")
    if (late.kind === "ok") {
      expect(late.response.rows).toHaveLength(1)
      expect(late.response.rows[0]?.isOwnRow).toBe(true)
    }
  })

  it("returns forbidden for a signed-in nonparticipant and not_found for an unknown quiz", async () => {
    const q = await makeQuestion("quant")
    const { quizId } = await createOpenQuiz({ seatCap: 5, scheduledAt: Date.now(), joinWindowSec: 600, units: [{ timeLimitSec: 60, questions: [q] }] })
    const outsider = await insertUser("student")
    const deps = { db: env.DB, kv: env.CACHE, bank: fakeBank([q]), now: () => Date.now() }
    expect((await getLeaderboard(deps, quizId, outsider)).kind).toBe("forbidden")
    expect((await getLeaderboard(deps, "nope", outsider)).kind).toBe("not_found")
  })
})

describe("getReview (service) — outcomes and distribution", () => {
  it("distinguishes correct/wrong/skipped/unanswered/not_reached and conserves the MCQ denominator", async () => {
    const qCorrect = await makeQuestion("quant", "A")
    const qWrong = await makeQuestion("quant", "B")
    const qSkipped = await makeQuestion("quant", "C")
    const qNeverReached = await makeQuestion("quant", "D")
    const pool = [qCorrect, qWrong, qSkipped, qNeverReached]
    const { quizId, roomCode, endsAt, windowSec } = await createOpenQuiz({
      seatCap: 5,
      scheduledAt: Date.now(),
      joinWindowSec: 600,
      units: [
        { timeLimitSec: 60, questions: [qCorrect] },
        { timeLimitSec: 60, questions: [qWrong] },
        { timeLimitSec: 60, questions: [qSkipped] },
        { timeLimitSec: 60, questions: [qNeverReached] },
      ],
    })
    const studentId = await insertUser("student")
    const joinedAt = Date.now()
    await join(runDeps(pool, joinedAt), roomCode, studentId)
    await submit(runDeps(pool, joinedAt + 1000), quizId, studentId, 1, {
      submissionId: "u1",
      reason: "complete",
      answers: [{ position: 1, status: "answered", format: "mcq", chosenOption: "A" }],
    })
    await submit(runDeps(pool, joinedAt + 2000), quizId, studentId, 2, {
      submissionId: "u2",
      reason: "complete",
      answers: [{ position: 2, status: "answered", format: "mcq", chosenOption: "A" }], // wrong: correct is B
    })
    await submit(runDeps(pool, joinedAt + 3000), quizId, studentId, 3, {
      submissionId: "u3",
      reason: "complete",
      answers: [{ position: 3, status: "skipped" }],
    })
    // Unit 4 abandoned — never submitted.

    const safeCloseAt = endsAt + windowSec * 1000 + 5000
    await closeQuizTransaction(env.DB, quizId, safeCloseAt + 1)

    const deps = { db: env.DB, kv: env.CACHE, bank: fakeBank(pool), now: () => safeCloseAt + 1 }
    const result = await getReview(deps, quizId, studentId)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return

    const byPosition = Object.fromEntries(result.response.rows.map((r) => [r.position, r]))
    expect(byPosition[1]?.outcome).toBe("correct")
    expect(byPosition[2]?.outcome).toBe("wrong")
    expect(byPosition[3]?.outcome).toBe("skipped")
    expect(byPosition[4]?.outcome).toBe("unanswered") // reached (abandoned mid-unit), no answer row

    for (const row of result.response.rows) {
      if (row.distribution) {
        const { optionCounts, notAnsweredCount, participantCount } = row.distribution
        expect(optionCounts.A + optionCounts.B + optionCounts.C + optionCounts.D + notAnsweredCount).toBe(participantCount)
      }
    }
    expect(byPosition[1]?.distribution?.optionCounts.A).toBe(1)
    expect(byPosition[3]?.distribution?.notAnsweredCount).toBe(1) // the skip
  })

  it("maps a truly unreached unit (never joined that far, quiz closed with time exhausted) to not_reached, not unanswered", async () => {
    const q1 = await makeQuestion("quant", "A")
    const q2 = await makeQuestion("quant", "B")
    const { quizId, roomCode, endsAt, windowSec } = await createOpenQuiz({
      seatCap: 5,
      scheduledAt: Date.now(),
      joinWindowSec: 600,
      units: [
        { timeLimitSec: 60, questions: [q1] },
        { timeLimitSec: 60, questions: [q2] },
      ],
    })
    const studentId = await insertUser("student")
    await join(runDeps([q1, q2], Date.now()), roomCode, studentId)
    // Abandoned before ever finishing unit 1 — unit 2 never gets a runtime row.

    const safeCloseAt = endsAt + windowSec * 1000 + 5000
    await closeQuizTransaction(env.DB, quizId, safeCloseAt + 1)

    const deps = { db: env.DB, kv: env.CACHE, bank: fakeBank([q1, q2]), now: () => safeCloseAt + 1 }
    const result = await getReview(deps, quizId, studentId)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    const byPosition = Object.fromEntries(result.response.rows.map((r) => [r.position, r]))
    expect(byPosition[1]?.outcome).toBe("unanswered") // reached
    expect(byPosition[2]?.outcome).toBe("not_reached") // never had a runtime row
  })

  it("returns exactly one timing row per unit with reached-only room averages", async () => {
    const q1 = await makeQuestion("quant", "A")
    const q2 = await makeQuestion("quant", "B")
    const { quizId, roomCode, endsAt, windowSec } = await createOpenQuiz({
      seatCap: 5,
      scheduledAt: Date.now(),
      joinWindowSec: 600,
      units: [
        { timeLimitSec: 60, questions: [q1] },
        { timeLimitSec: 60, questions: [q2] },
      ],
    })
    const studentId = await insertUser("student")
    const joinedAt = Date.now()
    await join(runDeps([q1, q2], joinedAt), roomCode, studentId)
    await submit(runDeps([q1, q2], joinedAt + 30_000), quizId, studentId, 1, {
      submissionId: "u1",
      reason: "complete",
      answers: [{ position: 1, status: "answered", format: "mcq", chosenOption: "A" }],
    })
    // unit 2 abandoned

    const safeCloseAt = endsAt + windowSec * 1000 + 5000
    await closeQuizTransaction(env.DB, quizId, safeCloseAt + 1)

    const deps = { db: env.DB, kv: env.CACHE, bank: fakeBank([q1, q2]), now: () => safeCloseAt + 1 }
    const result = await getReview(deps, quizId, studentId)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.response.units).toHaveLength(2)
    expect(result.response.units[0]?.closeReason).toBe("completed")
    expect(result.response.units[0]?.elapsedMs).toBe(30_000)
    expect(result.response.units[1]?.closeReason).toBe("timed_out")
    expect(result.response.units[1]?.roomAvgElapsedMs).toBe(result.response.units[1]?.elapsedMs) // sole reached participant for unit 2
  })
})

describe("getHistory (service)", () => {
  it("hides active score and unpublished rank/count, and shows a finished score before publication", async () => {
    const q1 = await makeQuestion("quant", "A")
    const q2 = await makeQuestion("quant", "A")
    const { quizId: activeQuizId, roomCode: activeRoom } = await createOpenQuiz({ seatCap: 5, scheduledAt: Date.now(), joinWindowSec: 600, units: [{ timeLimitSec: 60, questions: [q1] }] })
    const { quizId: finishedQuizId, roomCode: finishedRoom } = await createOpenQuiz({ seatCap: 5, scheduledAt: Date.now(), joinWindowSec: 600, units: [{ timeLimitSec: 60, questions: [q2] }] })

    const studentId = await insertUser("student")
    const now = Date.now()
    const pool = [q1, q2]
    await join(runDeps(pool, now), activeRoom, studentId) // still active
    await join(runDeps(pool, now), finishedRoom, studentId)
    await submit(runDeps(pool, now + 1000), finishedQuizId, studentId, 1, {
      submissionId: "s1",
      reason: "complete",
      answers: [{ position: 1, status: "answered", format: "mcq", chosenOption: "A" }],
    })

    const deps = { db: env.DB, kv: env.CACHE, bank: fakeBank(pool), now: () => now }
    const history = await getHistory(deps, studentId, 50, 0)
    const byId = Object.fromEntries(history.items.map((e) => [e.quizId, e]))
    expect(byId[activeQuizId]?.totalScore).toBeNull()
    expect(byId[finishedQuizId]?.totalScore).toBe(4) // finished score visible before publication
    expect(byId[finishedQuizId]?.rank).toBeNull() // not published yet
    expect(byId[finishedQuizId]?.participantCount).toBeNull()
  })

  it("orders newest scheduled_at first and paginates", async () => {
    const studentId = await insertUser("student")
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const q = await makeQuestion("quant", "A")
      const { quizId, roomCode } = await createOpenQuiz({ seatCap: 5, scheduledAt: Date.now() - 100_000 + i * 10_000, joinWindowSec: 600, units: [{ timeLimitSec: 60, questions: [q] }] })
      await join(runDeps([q], Date.now()), roomCode, studentId)
      ids.push(quizId)
    }
    const deps = { db: env.DB, kv: env.CACHE, bank: fakeBank([]), now: () => Date.now() }
    const page1 = await getHistory(deps, studentId, 2, 0)
    expect(page1.items.map((e) => e.quizId)).toEqual([ids[2], ids[1]])
    expect(page1.total).toBe(3)
    const page2 = await getHistory(deps, studentId, 2, 2)
    expect(page2.items.map((e) => e.quizId)).toEqual([ids[0]])
  })

  it("returns only the caller's own rows", async () => {
    const q = await makeQuestion("quant", "A")
    const { roomCode } = await createOpenQuiz({ seatCap: 5, scheduledAt: Date.now(), joinWindowSec: 600, units: [{ timeLimitSec: 60, questions: [q] }] })
    const studentA = await insertUser("student")
    const studentB = await insertUser("student")
    await join(runDeps([q], Date.now()), roomCode, studentA)
    const deps = { db: env.DB, kv: env.CACHE, bank: fakeBank([q]), now: () => Date.now() }
    const historyB = await getHistory(deps, studentB, 50, 0)
    expect(historyB.items).toHaveLength(0)
  })
})

describe("isParticipant / safeCloseAtFor", () => {
  it("computes safeCloseAt as ends_at + windowSec*1000 + 5000", () => {
    expect(safeCloseAtFor({ endsAt: 1000, windowSec: 10 })).toBe(1000 + 10_000 + 5000)
    expect(safeCloseAtFor({ endsAt: null, windowSec: 10 })).toBeNull()
  })

  it("reflects real participation", async () => {
    const q = await makeQuestion("quant")
    const { quizId, roomCode } = await createOpenQuiz({ seatCap: 5, scheduledAt: Date.now(), joinWindowSec: 600, units: [{ timeLimitSec: 60, questions: [q] }] })
    const studentId = await insertUser("student")
    expect(await isParticipant(env.DB, quizId, studentId)).toBe(false)
    await join(runDeps([q], Date.now()), roomCode, studentId)
    expect(await isParticipant(env.DB, quizId, studentId)).toBe(true)
  })
})
