import { env } from "cloudflare:test"
import { beforeEach, describe, expect, it } from "vitest"
import type { BankContract, QuestionFull, QuizType, UnitKind } from "../src/core/contracts"
import { listDueClose, listDuePrepare } from "../src/db/play"
import {
  current,
  join,
  listOpen,
  openRoom,
  status,
  submit,
  type RunDeps,
} from "../src/services/quiz-run"

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

async function insertUser(role: "admin" | "student"): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare("INSERT INTO users (id, google_sub, email, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, crypto.randomUUID(), `${id}@example.com`, "User", role, Date.now())
    .run()
  return id
}

async function insertPassage(type: QuizType): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO passages (id, type, topic, title, body_md, created_by, created_at) VALUES (?, ?, 'Topic', 'Title', 'Passage body', ?, ?)"
  )
    .bind(id, type, creatorId, Date.now())
    .run()
  return id
}

type QuestionSpec =
  | { format: "mcq"; correctOption: "A" | "B" | "C" | "D" }
  | { format: "tita"; numericAnswer: number; numericTolerance: number }

async function makeQuestion(type: QuizType, spec: QuestionSpec, passageId: string | null = null): Promise<QuestionFull> {
  questionSeq++
  const id = `q-${questionSeq}`
  const isMcq = spec.format === "mcq"
  await env.DB.prepare(
    `INSERT INTO questions (id, type, topic, difficulty, format, passage_id, body_md, option_a, option_b, option_c, option_d, correct_option, numeric_answer, numeric_tolerance, explanation_md, created_by, created_at)
     VALUES (?, ?, 'Topic', 'easy', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Explanation', ?, ?)`
  )
    .bind(
      id,
      type,
      spec.format,
      passageId,
      `Body ${questionSeq}`,
      isMcq ? "Option A" : null,
      isMcq ? "Option B" : null,
      isMcq ? "Option C" : null,
      isMcq ? "Option D" : null,
      isMcq ? spec.correctOption : null,
      isMcq ? null : spec.numericAnswer,
      isMcq ? null : spec.numericTolerance,
      creatorId,
      Date.now()
    )
    .run()
  return {
    id,
    type,
    topic: "Topic",
    subtopic: null,
    difficulty: "easy",
    format: spec.format,
    passageId,
    groupPosition: null,
    bodyMd: `Body ${questionSeq}`,
    imageUrl: null,
    optionA: isMcq ? "Option A" : null,
    optionB: isMcq ? "Option B" : null,
    optionC: isMcq ? "Option C" : null,
    optionD: isMcq ? "Option D" : null,
    correctOption: isMcq ? spec.correctOption : null,
    numericAnswer: isMcq ? null : spec.numericAnswer,
    numericTolerance: isMcq ? null : spec.numericTolerance,
    explanationMd: "Explanation",
    source: null,
    passage: passageId ? { title: "Title", bodyMd: "Passage body", imageUrl: null } : null,
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

type UnitSpec = { kind: UnitKind; timeLimitSec: number; questions: QuestionFull[] }

async function createScheduledQuiz(opts: {
  type: QuizType
  seatCap: number
  scheduledAt: number
  joinWindowSec: number
  marksCorrect: number
  marksWrong: number
  units: UnitSpec[]
  status?: "scheduled" | "open" | "cancelled"
}): Promise<{ quizId: string; roomCode: string; windowSec: number }> {
  quizNumberSeq++
  const quizId = crypto.randomUUID()
  const roomCode = `QNT-${1000 + quizNumberSeq}`
  const endsAt = opts.scheduledAt + opts.joinWindowSec * 1000
  const lobbyOpensAt = opts.scheduledAt - 300_000
  const windowSec = opts.units.reduce((sum, u) => sum + u.timeLimitSec, 0)
  const questionCount = opts.units.reduce((sum, u) => sum + u.questions.length, 0)
  const status = opts.status ?? "scheduled"

  await env.DB.prepare(
    `INSERT INTO quizzes (id, quiz_number, title, type, question_count, unit_count, difficulty_mix, timing_policy, slack_sec, join_window_sec, scheduled_at, lobby_opens_at, ends_at, status, room_code, seat_cap, window_sec, marks_correct, marks_wrong, created_by, created_at, opened_at)
     VALUES (?, ?, 'Test Quiz', ?, ?, ?, '{}', '{}', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      quizId,
      quizNumberSeq,
      opts.type,
      questionCount,
      opts.units.length,
      opts.joinWindowSec,
      opts.scheduledAt,
      lobbyOpensAt,
      endsAt,
      status,
      roomCode,
      opts.seatCap,
      windowSec,
      opts.marksCorrect,
      opts.marksWrong,
      creatorId,
      Date.now(),
      status === "open" ? Date.now() : null
    )
    .run()

  let position = 1
  let unitPosition = 1
  for (const unit of opts.units) {
    const passageId = unit.kind === "standalone" ? null : await insertPassage(opts.type)
    await env.DB.prepare("INSERT INTO quiz_units (quiz_id, unit_position, kind, passage_id, time_limit_sec) VALUES (?, ?, ?, ?, ?)")
      .bind(quizId, unitPosition, unit.kind, passageId, unit.timeLimitSec)
      .run()
    let subPosition = 1
    for (const q of unit.questions) {
      await env.DB.prepare(
        "INSERT INTO quiz_questions (quiz_id, question_id, position, unit_position, sub_position) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(quizId, q.id, position, unitPosition, subPosition)
        .run()
      position++
      subPosition++
    }
    unitPosition++
  }

  if (status === "open") {
    // Simulates a real openRoom() having already run: real join()/current() never seeds seats
    // themselves outside the scheduled->open catch-up path, so a test-created "open" quiz needs
    // its seats pre-seeded the same way openRoom would have.
    for (let seatNo = 1; seatNo <= opts.seatCap; seatNo++) {
      await env.DB.prepare("INSERT INTO quiz_seats (quiz_id, seat_no) VALUES (?, ?)").bind(quizId, seatNo).run()
    }
  }

  return { quizId, roomCode, windowSec }
}

// deterministic content-addressed hash — identical canonical bytes must always hash identically.
function stableDeps(pool: QuestionFull[], now: number, overrides: Partial<RunDeps> = {}): RunDeps {
  return {
    db: env.DB,
    kv: env.CACHE,
    bank: fakeBank(pool),
    now: () => now,
    hash: async (bytes: string) => `h:${bytes}`,
    ...overrides,
  }
}

const T0 = 1_700_000_000_000

describe("openRoom", () => {
  it("seeds seats, warms cache, and publishes open idempotently", async () => {
    const q = await makeQuestion("quant", { format: "mcq", correctOption: "A" })
    const { quizId } = await createScheduledQuiz({
      type: "quant",
      seatCap: 3,
      scheduledAt: T0,
      joinWindowSec: 600,
      marksCorrect: 4,
      marksWrong: -1,
      units: [{ kind: "standalone", timeLimitSec: 60, questions: [q] }],
    })

    const runDeps = stableDeps([q], T0 - 300_000)
    const first = await openRoom(runDeps, quizId)
    expect(first).toEqual({ seatsSeeded: 3, alreadyOpen: false })

    const seats = await env.DB.prepare("SELECT COUNT(*) AS n FROM quiz_seats WHERE quiz_id = ?").bind(quizId).first<{ n: number }>()
    expect(seats?.n).toBe(3)

    const cached = await env.CACHE.get(`unit:${quizId}:1`)
    expect(cached).not.toBeNull()
    expect(cached).not.toContain("correctOption")

    const second = await openRoom(runDeps, quizId)
    expect(second).toEqual({ seatsSeeded: 0, alreadyOpen: true })
  })

  it("does nothing before lobbyOpensAt", async () => {
    const q = await makeQuestion("quant", { format: "mcq", correctOption: "A" })
    const { quizId } = await createScheduledQuiz({
      type: "quant",
      seatCap: 3,
      scheduledAt: T0,
      joinWindowSec: 600,
      marksCorrect: 4,
      marksWrong: -1,
      units: [{ kind: "standalone", timeLimitSec: 60, questions: [q] }],
    })
    const result = await openRoom(stableDeps([q], T0 - 400_000), quizId)
    expect(result).toEqual({ seatsSeeded: 0, alreadyOpen: false })
    const row = await env.DB.prepare("SELECT status FROM quizzes WHERE id = ?").bind(quizId).first<{ status: string }>()
    expect(row?.status).toBe("scheduled")
  })
})

describe("listOpen", () => {
  it("lists only status='open' quizzes within their admission window", async () => {
    const q = await makeQuestion("quant", { format: "mcq", correctOption: "A" })
    const { quizId: openId } = await createScheduledQuiz({
      type: "quant",
      seatCap: 5,
      scheduledAt: T0,
      joinWindowSec: 600,
      marksCorrect: 4,
      marksWrong: -1,
      units: [{ kind: "standalone", timeLimitSec: 60, questions: [q] }],
      status: "open",
    })
    await createScheduledQuiz({
      type: "quant",
      seatCap: 5,
      scheduledAt: T0 + 10_000,
      joinWindowSec: 600,
      marksCorrect: 4,
      marksWrong: -1,
      units: [{ kind: "standalone", timeLimitSec: 60, questions: [q] }],
      status: "scheduled",
    })
    const response = await listOpen(stableDeps([q], T0 + 1000))
    expect(response.quizzes.map((x) => x.id)).toEqual([openId])
  })
})

describe("join", () => {
  async function openQuiz(seatCap: number) {
    const q1 = await makeQuestion("quant", { format: "mcq", correctOption: "A" })
    const q2 = await makeQuestion("quant", { format: "mcq", correctOption: "B" })
    const { quizId, roomCode } = await createScheduledQuiz({
      type: "quant",
      seatCap,
      scheduledAt: T0,
      joinWindowSec: 600,
      marksCorrect: 4,
      marksWrong: -1,
      units: [
        { kind: "standalone", timeLimitSec: 60, questions: [q1] },
        { kind: "standalone", timeLimitSec: 60, questions: [q2] },
      ],
      status: "open",
    })
    return { quizId, roomCode, pool: [q1, q2] }
  }

  it("returns 404 for an unknown room code", async () => {
    const result = await join(stableDeps([], T0), "NOPE-0000", await insertUser("student"))
    expect(result.kind).toBe("not_found")
  })

  it("accepts a new join within the admission window and starts unit 1", async () => {
    const { roomCode, pool } = await openQuiz(5)
    const studentId = await insertUser("student")
    const result = await join(stableDeps(pool, T0 + 1000), roomCode, studentId)
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") {
      expect(result.response.state.status).toBe("active")
      if (result.response.state.status === "active") {
        expect(result.response.state.unit.unitPosition).toBe(1)
        expect(result.response.state.unit.startedAt).toBe(T0 + 1000)
      }
    }
  })

  it("resumes an existing participant without resetting clocks", async () => {
    const { roomCode, pool } = await openQuiz(5)
    const studentId = await insertUser("student")
    const first = await join(stableDeps(pool, T0 + 1000), roomCode, studentId)
    const second = await join(stableDeps(pool, T0 + 50_000), roomCode, studentId)
    expect(first.kind === "ok" && second.kind === "ok").toBe(true)
    if (first.kind === "ok" && second.kind === "ok" && first.response.state.status === "active" && second.response.state.status === "active") {
      expect(second.response.state.unit.startedAt).toBe(first.response.state.unit.startedAt)
    }
  })

  it("rejects the 121st distinct user with full, while 120 concurrent joins each get exactly one seat", async () => {
    const { roomCode, pool } = await openQuiz(3)
    const students = await Promise.all([insertUser("student"), insertUser("student"), insertUser("student"), insertUser("student")])
    const results = await Promise.all(students.map((id) => join(stableDeps(pool, T0 + 1000), roomCode, id)))
    const okCount = results.filter((r) => r.kind === "ok").length
    const fullCount = results.filter((r) => r.kind === "full").length
    expect(okCount).toBe(3)
    expect(fullCount).toBe(1)
    const seatCount = await env.DB.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM quiz_seats WHERE quiz_id IS NOT NULL AND user_id IS NOT NULL").first<{ n: number }>()
    expect(seatCount?.n).toBe(3)
  })

  it("rejects admission before scheduledAt or after endsAt as unavailable", async () => {
    const q = await makeQuestion("quant", { format: "mcq", correctOption: "A" })
    const { roomCode } = await createScheduledQuiz({
      type: "quant",
      seatCap: 5,
      scheduledAt: T0,
      joinWindowSec: 600,
      marksCorrect: 4,
      marksWrong: -1,
      units: [{ kind: "standalone", timeLimitSec: 60, questions: [q] }],
      status: "open",
    })
    const early = await join(stableDeps([q], T0 - 1000), roomCode, await insertUser("student"))
    expect(early.kind).toBe("unavailable")
    const late = await join(stableDeps([q], T0 + 601_000), roomCode, await insertUser("student"))
    expect(late.kind).toBe("unavailable")
  })

  it("rejects a cancelled quiz as unavailable", async () => {
    const q = await makeQuestion("quant", { format: "mcq", correctOption: "A" })
    const { roomCode } = await createScheduledQuiz({
      type: "quant",
      seatCap: 5,
      scheduledAt: T0,
      joinWindowSec: 600,
      marksCorrect: 4,
      marksWrong: -1,
      units: [{ kind: "standalone", timeLimitSec: 60, questions: [q] }],
      status: "cancelled",
    })
    const result = await join(stableDeps([q], T0 + 1000), roomCode, await insertUser("student"))
    expect(result.kind).toBe("unavailable")
  })

  it("catches up a due-but-unprepared scheduled room before evaluating admission", async () => {
    const q = await makeQuestion("quant", { format: "mcq", correctOption: "A" })
    const { quizId, roomCode } = await createScheduledQuiz({
      type: "quant",
      seatCap: 5,
      scheduledAt: T0,
      joinWindowSec: 600,
      marksCorrect: 4,
      marksWrong: -1,
      units: [{ kind: "standalone", timeLimitSec: 60, questions: [q] }],
      status: "scheduled",
    })
    const result = await join(stableDeps([q], T0 + 1000), roomCode, await insertUser("student"))
    expect(result.kind).toBe("ok")
    const row = await env.DB.prepare("SELECT status FROM quizzes WHERE id = ?").bind(quizId).first<{ status: string }>()
    expect(row?.status).toBe("open")
  })
})

describe("current — server-only expiry settlement", () => {
  it("settles an expired unit and progresses to the next unit when overall time remains", async () => {
    const q1 = await makeQuestion("quant", { format: "mcq", correctOption: "A" })
    const q2 = await makeQuestion("quant", { format: "mcq", correctOption: "B" })
    const { quizId, roomCode } = await createScheduledQuiz({
      type: "quant",
      seatCap: 5,
      scheduledAt: T0,
      joinWindowSec: 600,
      marksCorrect: 4,
      marksWrong: -1,
      units: [
        { kind: "standalone", timeLimitSec: 60, questions: [q1] },
        { kind: "standalone", timeLimitSec: 60, questions: [q2] },
      ],
      status: "open",
    })
    const studentId = await insertUser("student")
    await join(stableDeps([q1, q2], T0 + 1000), roomCode, studentId)

    // unit 1 deadline = T0+1000+60000 = T0+61000; submitByAt = T0+66000. Let it expire silently.
    const result = await current(stableDeps([q1, q2], T0 + 70_000), quizId, studentId)
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") {
      expect(result.response.state.status).toBe("active")
      if (result.response.state.status === "active") {
        expect(result.response.state.unit.unitPosition).toBe(2)
        expect(result.response.state.unit.startedAt).toBe(T0 + 70_000)
      }
    }
    const unit1 = await env.DB.prepare("SELECT close_reason, elapsed_ms FROM participant_units WHERE quiz_id=? AND user_id=? AND unit_position=1")
      .bind(quizId, studentId)
      .first<{ close_reason: string; elapsed_ms: number }>()
    expect(unit1?.close_reason).toBe("timed_out")
    expect(unit1?.elapsed_ms).toBe(60_000)
    const participant = await env.DB.prepare("SELECT unanswered_count FROM participants WHERE quiz_id=? AND user_id=?").bind(quizId, studentId).first<{ unanswered_count: number }>()
    expect(participant?.unanswered_count).toBe(1)
  })

  it("finishes the participant and counts unreached questions as unanswered when overall time is exhausted", async () => {
    const q1 = await makeQuestion("quant", { format: "mcq", correctOption: "A" })
    const q2 = await makeQuestion("quant", { format: "mcq", correctOption: "B" })
    const { quizId, roomCode } = await createScheduledQuiz({
      type: "quant",
      seatCap: 5,
      scheduledAt: T0,
      joinWindowSec: 600,
      marksCorrect: 4,
      marksWrong: -1,
      units: [
        { kind: "standalone", timeLimitSec: 30, questions: [q1] },
        { kind: "standalone", timeLimitSec: 9999, questions: [q2] }, // capped by overall deadline
      ],
      status: "open",
    })
    // windowSec = 30+9999 = 10029; overall deadline = start + 10029000
    const studentId = await insertUser("student")
    await join(stableDeps([q1, q2], T0 + 1000), roomCode, studentId)
    const overallDeadline = T0 + 1000 + 10_029_000

    const result = await current(stableDeps([q1, q2], overallDeadline + 10_000), quizId, studentId)
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") expect(result.response.state.status).toBe("finished")

    const participant = await env.DB.prepare(
      "SELECT correct_count, wrong_count, skipped_count, unanswered_count, finished_at FROM participants WHERE quiz_id=? AND user_id=?"
    )
      .bind(quizId, studentId)
      .first<{ correct_count: number; wrong_count: number; skipped_count: number; unanswered_count: number; finished_at: number | null }>()
    expect(participant?.finished_at).not.toBeNull()
    expect((participant?.correct_count ?? 0) + (participant?.wrong_count ?? 0) + (participant?.skipped_count ?? 0) + (participant?.unanswered_count ?? 0)).toBe(2)
    expect(participant?.unanswered_count).toBe(2) // unit 1 expired unanswered, unit 2 never reached
  })

  it("returns 403 for a nonparticipant and 404 for an unknown quiz", async () => {
    const q = await makeQuestion("quant", { format: "mcq", correctOption: "A" })
    const { quizId } = await createScheduledQuiz({
      type: "quant",
      seatCap: 5,
      scheduledAt: T0,
      joinWindowSec: 600,
      marksCorrect: 4,
      marksWrong: -1,
      units: [{ kind: "standalone", timeLimitSec: 60, questions: [q] }],
      status: "open",
    })
    const outsider = await insertUser("student")
    expect((await current(stableDeps([q], T0 + 1000), quizId, outsider)).kind).toBe("forbidden")
    expect((await current(stableDeps([q], T0 + 1000), "nope", outsider)).kind).toBe("not_found")
  })
})

describe("submit", () => {
  async function setup(marksCorrect = 4, marksWrong = -1) {
    const q1 = await makeQuestion("quant", { format: "mcq", correctOption: "A" })
    const q2 = await makeQuestion("quant", { format: "tita", numericAnswer: 10, numericTolerance: 0.5 })
    const { quizId, roomCode } = await createScheduledQuiz({
      type: "quant",
      seatCap: 5,
      scheduledAt: T0,
      joinWindowSec: 600,
      marksCorrect,
      marksWrong,
      units: [
        { kind: "standalone", timeLimitSec: 60, questions: [q1] },
        { kind: "standalone", timeLimitSec: 60, questions: [q2] },
      ],
      status: "open",
    })
    const studentId = await insertUser("student")
    const d = stableDeps([q1, q2], T0 + 1000)
    await join(d, roomCode, studentId)
    return { quizId, studentId, q1, q2, pool: [q1, q2] }
  }

  it("grades a correct complete batch, applies marks once, and progresses to the next unit", async () => {
    const { quizId, studentId, q1, pool } = await setup()
    const body = { submissionId: "sub-1", reason: "complete", answers: [{ position: 1, status: "answered", format: "mcq", chosenOption: q1.correctOption }] }
    const result = await submit(stableDeps(pool, T0 + 5000), quizId, studentId, 1, body)
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") {
      expect(result.response.closedUnit).toEqual({ unitPosition: 1, reason: "completed" })
      expect(result.response.state.status).toBe("active")
      if (result.response.state.status === "active") expect(result.response.state.unit.unitPosition).toBe(2)
    }
    const participant = await env.DB.prepare("SELECT total_score, correct_count FROM participants WHERE quiz_id=? AND user_id=?")
      .bind(quizId, studentId)
      .first<{ total_score: number; correct_count: number }>()
    expect(participant?.total_score).toBe(4)
    expect(participant?.correct_count).toBe(1)
  })

  it("grades a wrong TITA answer within reach of tolerance boundary as correct", async () => {
    const { quizId, studentId, pool } = await setup()
    // close unit 1 first (skip) to reach unit 2
    await submit(stableDeps(pool, T0 + 2000), quizId, studentId, 1, { submissionId: "s1", reason: "complete", answers: [{ position: 1, status: "skipped" }] })
    const result = await submit(stableDeps(pool, T0 + 3000), quizId, studentId, 2, {
      submissionId: "s2",
      reason: "complete",
      answers: [{ position: 2, status: "answered", format: "tita", numericValue: 10.5 }],
    })
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") expect(result.response.state.status).toBe("finished")
    const participant = await env.DB.prepare("SELECT total_score, correct_count FROM participants WHERE quiz_id=? AND user_id=?")
      .bind(quizId, studentId)
      .first<{ total_score: number; correct_count: number }>()
    expect(participant?.correct_count).toBe(1)
  })

  it("rejects an invalid batch with 400 and writes nothing", async () => {
    const { quizId, studentId, pool } = await setup()
    const result = await submit(stableDeps(pool, T0 + 2000), quizId, studentId, 1, { submissionId: "s1", reason: "complete", answers: [] })
    expect(result.kind).toBe("invalid")
    const answers = await env.DB.prepare("SELECT COUNT(*) AS n FROM answers WHERE quiz_id=?").bind(quizId).first<{ n: number }>()
    expect(answers?.n).toBe(0)
  })

  it("returns 403 for a nonparticipant", async () => {
    const { quizId, pool } = await setup()
    const outsider = await insertUser("student")
    const result = await submit(stableDeps(pool, T0 + 2000), quizId, outsider, 1, { submissionId: "s1", reason: "complete", answers: [{ position: 1, status: "skipped" }] })
    expect(result.kind).toBe("forbidden")
  })

  it("returns conflict for a foreign/unreached unit position", async () => {
    const { quizId, studentId, pool } = await setup()
    const result = await submit(stableDeps(pool, T0 + 2000), quizId, studentId, 2, { submissionId: "s1", reason: "complete", answers: [{ position: 2, status: "skipped" }] })
    expect(result.kind).toBe("conflict")
  })

  it("accepts an identical accepted retry and returns current authoritative state without double-applying marks", async () => {
    const { quizId, studentId, q1, pool } = await setup()
    const body = { submissionId: "sub-1", reason: "complete", answers: [{ position: 1, status: "answered", format: "mcq", chosenOption: q1.correctOption }] }
    const first = await submit(stableDeps(pool, T0 + 5000), quizId, studentId, 1, body)
    const retry = await submit(stableDeps(pool, T0 + 9000), quizId, studentId, 1, body)
    expect(first.kind).toBe("ok")
    expect(retry.kind).toBe("ok")
    const participant = await env.DB.prepare("SELECT total_score, correct_count FROM participants WHERE quiz_id=? AND user_id=?")
      .bind(quizId, studentId)
      .first<{ total_score: number; correct_count: number }>()
    expect(participant?.total_score).toBe(4)
    expect(participant?.correct_count).toBe(1)
  })

  it("rejects a changed retry for an already-closed unit with 409", async () => {
    const { quizId, studentId, q1, pool } = await setup()
    const body = { submissionId: "sub-1", reason: "complete", answers: [{ position: 1, status: "answered", format: "mcq", chosenOption: q1.correctOption }] }
    await submit(stableDeps(pool, T0 + 5000), quizId, studentId, 1, body)
    const changed = await submit(stableDeps(pool, T0 + 6000), quizId, studentId, 1, {
      submissionId: "sub-2",
      reason: "complete",
      answers: [{ position: 1, status: "skipped" }],
    })
    expect(changed.kind).toBe("conflict")
  })

  it("rejects a timeout reason submitted before the deadline", async () => {
    const { quizId, studentId, pool } = await setup()
    const result = await submit(stableDeps(pool, T0 + 5000), quizId, studentId, 1, { submissionId: "s1", reason: "timeout", answers: [{ position: 1, status: "unanswered" }] })
    expect(result.kind).toBe("invalid")
  })

  it("returns 410 late for an unseen batch after submitByAt and settles the unit server-side", async () => {
    const { quizId, studentId, pool } = await setup()
    // deadlineAt = T0+1000+60000; submitByAt = +5000 more
    const result = await submit(stableDeps(pool, T0 + 200_000), quizId, studentId, 1, {
      submissionId: "s1",
      reason: "complete",
      answers: [{ position: 1, status: "skipped" }],
    })
    expect(result.kind).toBe("late")
    const unit1 = await env.DB.prepare("SELECT closed_at, close_reason FROM participant_units WHERE quiz_id=? AND user_id=? AND unit_position=1")
      .bind(quizId, studentId)
      .first<{ closed_at: number | null; close_reason: string | null }>()
    expect(unit1?.closed_at).not.toBeNull()
    expect(unit1?.close_reason).toBe("timed_out")
  })

  it("accepts an on-time complete batch delivered inside the transport window, after the edit deadline", async () => {
    const { quizId, studentId, q1, pool } = await setup()
    // deadlineAt = T0+1000+60000 = T0+61000; submitByAt = T0+66000. Submit at T0+63000 (past edit deadline, inside transport).
    const result = await submit(stableDeps(pool, T0 + 63_000), quizId, studentId, 1, {
      submissionId: "s1",
      reason: "complete",
      answers: [{ position: 1, status: "answered", format: "mcq", chosenOption: q1.correctOption }],
    })
    expect(result.kind).toBe("ok")
    const unit1 = await env.DB.prepare("SELECT elapsed_ms FROM participant_units WHERE quiz_id=? AND user_id=? AND unit_position=1")
      .bind(quizId, studentId)
      .first<{ elapsed_ms: number }>()
    expect(unit1?.elapsed_ms).toBe(60_000) // capped at the edit deadline, not the actual (later) delivery time
  })

  it("handles a duplicate concurrent submit as one winner and one accepted-retry/conflict, never double-scoring", async () => {
    const { quizId, studentId, q1, pool } = await setup()
    const body = { submissionId: "sub-1", reason: "complete", answers: [{ position: 1, status: "answered", format: "mcq", chosenOption: q1.correctOption }] }
    const [a, b] = await Promise.all([
      submit(stableDeps(pool, T0 + 5000), quizId, studentId, 1, body),
      submit(stableDeps(pool, T0 + 5000), quizId, studentId, 1, body),
    ])
    expect(a.kind).toBe("ok")
    expect(b.kind).toBe("ok")
    const participant = await env.DB.prepare("SELECT total_score, correct_count FROM participants WHERE quiz_id=? AND user_id=?")
      .bind(quizId, studentId)
      .first<{ total_score: number; correct_count: number }>()
    expect(participant?.total_score).toBe(4)
    expect(participant?.correct_count).toBe(1)
  })
})

describe("status", () => {
  it("returns 409 while active and finished-only holding data after finish", async () => {
    const q = await makeQuestion("quant", { format: "mcq", correctOption: "A" })
    const { quizId, roomCode } = await createScheduledQuiz({
      type: "quant",
      seatCap: 5,
      scheduledAt: T0,
      joinWindowSec: 600,
      marksCorrect: 4,
      marksWrong: -1,
      units: [{ kind: "standalone", timeLimitSec: 60, questions: [q] }],
      status: "open",
    })
    const studentId = await insertUser("student")
    await join(stableDeps([q], T0 + 1000), roomCode, studentId)

    const whileActive = await status(stableDeps([q], T0 + 2000), quizId, studentId)
    expect(whileActive.kind).toBe("active")

    await submit(stableDeps([q], T0 + 3000), quizId, studentId, 1, { submissionId: "s1", reason: "complete", answers: [{ position: 1, status: "answered", format: "mcq", chosenOption: q.correctOption }] })

    const afterFinish = await status(stableDeps([q], T0 + 4000), quizId, studentId)
    expect(afterFinish.kind).toBe("ok")
    if (afterFinish.kind === "ok") {
      expect(afterFinish.response.totalScore).toBe(4)
      expect(afterFinish.response.finishedCount).toBe(1)
      expect(afterFinish.response.participantCount).toBe(1)
    }
  })

  it("returns 403 for a nonparticipant and 404 for an unknown quiz", async () => {
    const q = await makeQuestion("quant", { format: "mcq", correctOption: "A" })
    const { quizId } = await createScheduledQuiz({
      type: "quant",
      seatCap: 5,
      scheduledAt: T0,
      joinWindowSec: 600,
      marksCorrect: 4,
      marksWrong: -1,
      units: [{ kind: "standalone", timeLimitSec: 60, questions: [q] }],
      status: "open",
    })
    const outsider = await insertUser("student")
    expect((await status(stableDeps([q], T0), quizId, outsider)).kind).toBe("forbidden")
    expect((await status(stableDeps([q], T0), "nope", outsider)).kind).toBe("not_found")
  })
})

describe("scheduler discovery bounds", () => {
  it("caps listDuePrepare/listDueClose at the requested limit and orders oldest-due first", async () => {
    const q = await makeQuestion("quant", { format: "mcq", correctOption: "A" })
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      const { quizId } = await createScheduledQuiz({
        type: "quant",
        seatCap: 5,
        scheduledAt: T0 + i * 1000,
        joinWindowSec: 600,
        marksCorrect: 4,
        marksWrong: -1,
        units: [{ kind: "standalone", timeLimitSec: 60, questions: [q] }],
        status: "scheduled",
      })
      ids.push(quizId)
    }
    const due = await listDuePrepare(env.DB, T0 + 10_000, 3)
    expect(due).toHaveLength(3)
    expect(due).toEqual(ids.slice(0, 3))
  })

  it("computes safeCloseAt as ends_at + windowSec*1000 + 5000 for due closes", async () => {
    const q = await makeQuestion("quant", { format: "mcq", correctOption: "A" })
    const { quizId, windowSec } = await createScheduledQuiz({
      type: "quant",
      seatCap: 5,
      scheduledAt: T0,
      joinWindowSec: 600,
      marksCorrect: 4,
      marksWrong: -1,
      units: [{ kind: "standalone", timeLimitSec: 60, questions: [q] }],
      status: "open",
    })
    const endsAt = T0 + 600_000
    const expectedSafeCloseAt = endsAt + windowSec * 1000 + 5000
    const notYetDue = await listDueClose(env.DB, expectedSafeCloseAt - 1, 10)
    expect(notYetDue.find((d) => d.quizId === quizId)).toBeUndefined()
    const due = await listDueClose(env.DB, expectedSafeCloseAt, 10)
    expect(due.find((d) => d.quizId === quizId)?.safeCloseAt).toBe(expectedSafeCloseAt)
  })
})
