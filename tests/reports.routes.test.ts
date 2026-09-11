import { env } from "cloudflare:test"
import { beforeEach, describe, expect, it, vi } from "vitest"
import app from "../src/index"
import { jwksResponse, makeGoogleKeyPair, signGoogleIdToken } from "./helpers/google"

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
})

function extractCookie(res: Response): string {
  const header = res.headers.get("set-cookie") ?? ""
  const match = header.match(/quizzer_session=([^;]*)/)
  if (!match) throw new Error("no session cookie in response")
  return match[1] ?? ""
}

async function signInAs(role: "student" | "admin"): Promise<{ cookie: string; id: string }> {
  const kid = crypto.randomUUID()
  const { privateKey, jwk } = await makeGoogleKeyPair(kid)
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jwksResponse([jwk]))
  )
  const sub = crypto.randomUUID()
  const idToken = await signGoogleIdToken(privateKey, kid, env.GOOGLE_CLIENT_ID, { sub, email: `${sub}@example.com` })
  const res = await app.request(
    "/api/auth/google",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }) },
    env
  )
  const body = await res.json<{ id: string }>()
  vi.unstubAllGlobals()
  if (role === "admin") {
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(body.id).run()
    await env.CACHE.delete(`role:${body.id}`)
  }
  return { cookie: extractCookie(res), id: body.id }
}

function authed(path: string, cookie: string | null, init: RequestInit = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
  if (cookie) headers.cookie = `quizzer_session=${cookie}`
  return app.request(path, { ...init, headers }, env)
}

let creatorId: string
let questionSeq = 0

async function insertQuestion(type: "quant" = "quant"): Promise<string> {
  questionSeq++
  const id = `rep-q-${questionSeq}`
  await env.DB.prepare(
    `INSERT INTO questions (id, type, topic, difficulty, format, body_md, option_a, option_b, option_c, option_d, correct_option, explanation_md, created_by, created_at)
     VALUES (?, ?, 'Topic', 'easy', 'mcq', 'Body', 'A', 'B', 'C', 'D', 'A', 'Explanation', ?, ?)`
  )
    .bind(id, type, creatorId, Date.now())
    .run()
  return id
}

async function insertQuiz(opts: { boardComputedAt: number | null; status?: "open" | "ended" }): Promise<string> {
  const id = crypto.randomUUID()
  const scheduledAt = Date.now()
  await env.DB.prepare(
    `INSERT INTO quizzes (id, quiz_number, title, type, question_count, unit_count, timing_policy, slack_sec, join_window_sec, scheduled_at, lobby_opens_at, ends_at, status, room_code, window_sec, marks_correct, marks_wrong, created_by, created_at, board_computed_at)
     VALUES (?, ?, 'Report Quiz', 'quant', 2, 1, ?, 30, 600, ?, ?, ?, ?, ?, 90, 4, -1, ?, ?, ?)`
  )
    .bind(
      id,
      Math.floor(Math.random() * 1_000_000),
      JSON.stringify({ standalone: 60 }),
      scheduledAt,
      scheduledAt - 300000,
      scheduledAt + 600000,
      opts.status ?? (opts.boardComputedAt !== null ? "ended" : "open"),
      `RPT${Math.floor(Math.random() * 1_000_000)}`,
      creatorId,
      Date.now(),
      opts.boardComputedAt
    )
    .run()
  return id
}

async function insertUnit(quizId: string, unitPosition: number, timeLimitSec = 60): Promise<void> {
  await env.DB.prepare("INSERT INTO quiz_units (quiz_id, unit_position, kind, time_limit_sec) VALUES (?, ?, 'standalone', ?)")
    .bind(quizId, unitPosition, timeLimitSec)
    .run()
}

async function insertQuizQuestion(quizId: string, position: number, unitPosition: number, questionId: string): Promise<void> {
  await env.DB.prepare("INSERT INTO quiz_questions (quiz_id, question_id, position, unit_position, sub_position) VALUES (?, ?, ?, ?, 1)")
    .bind(quizId, questionId, position, unitPosition)
    .run()
}

async function insertParticipant(
  quizId: string,
  userId: string,
  opts: { seatNo: number; totalScore?: number; correctCount?: number; wrongCount?: number; skippedCount?: number; unansweredCount?: number; totalTimeMs?: number; rank?: number | null }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO participants (quiz_id, user_id, seat_no, started_at, total_score, correct_count, wrong_count, skipped_count, unanswered_count, total_time_ms, rank)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      quizId,
      userId,
      opts.seatNo,
      Date.now(),
      opts.totalScore ?? 0,
      opts.correctCount ?? 0,
      opts.wrongCount ?? 0,
      opts.skippedCount ?? 0,
      opts.unansweredCount ?? 0,
      opts.totalTimeMs ?? 0,
      opts.rank ?? null
    )
    .run()
}

async function insertAnswer(
  quizId: string,
  userId: string,
  questionId: string,
  position: number,
  unitPosition: number,
  status: "answered" | "skipped" | "unanswered",
  opts: { isCorrect?: boolean } = {}
): Promise<void> {
  const isCorrect = status === "answered" ? (opts.isCorrect ?? true) : null
  await env.DB.prepare(
    `INSERT INTO answers (quiz_id, user_id, question_id, position, unit_position, status, chosen_option, is_correct, marks)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(quizId, userId, questionId, position, unitPosition, status, status === "answered" ? "A" : null, isCorrect === null ? null : isCorrect ? 1 : 0, status === "answered" ? (isCorrect ? 4 : -1) : 0)
    .run()
}

async function insertParticipantUnit(
  quizId: string,
  userId: string,
  unitPosition: number,
  opts: { closeReason?: "completed" | "timed_out"; elapsedMs?: number } = {}
): Promise<void> {
  const startedAt = Date.now() - 60000
  const deadlineAt = startedAt + 60000
  await env.DB.prepare(
    `INSERT INTO participant_units (quiz_id, user_id, unit_position, started_at, deadline_at, submit_by_at, closed_at, close_reason, elapsed_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      quizId,
      userId,
      unitPosition,
      startedAt,
      deadlineAt,
      deadlineAt + 5000,
      opts.closeReason ? Date.now() : null,
      opts.closeReason ?? null,
      opts.closeReason ? (opts.elapsedMs ?? 30000) : null
    )
    .run()
}

async function insertStudent(name: string): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare("INSERT INTO users (id, google_sub, email, name, role, created_at) VALUES (?, ?, ?, ?, 'student', ?)")
    .bind(id, crypto.randomUUID(), `${id}@example.com`, name, Date.now())
    .run()
  return id
}

beforeEach(async () => {
  const { id } = await signInAs("admin")
  creatorId = id
  questionSeq = 0
})

describe("GET /api/admin/quizzes/:id/report", () => {
  it("401s signed out, 403s as student", async () => {
    expect((await authed("/api/admin/quizzes/some-id/report", null)).status).toBe(401)
    const { cookie } = await signInAs("student")
    expect((await authed("/api/admin/quizzes/some-id/report", cookie)).status).toBe(403)
  })

  it("404s for an unknown quiz as admin", async () => {
    const { cookie } = await signInAs("admin")
    expect((await authed("/api/admin/quizzes/unknown-quiz/report", cookie)).status).toBe(404)
  })

  it("423s before board_computed_at is set", async () => {
    const { cookie } = await signInAs("admin")
    const quizId = await insertQuiz({ boardComputedAt: null })
    expect((await authed(`/api/admin/quizzes/${quizId}/report`, cookie)).status).toBe(423)
  })

  it("400s on invalid pagination without clamping", async () => {
    const { cookie } = await signInAs("admin")
    const quizId = await insertQuiz({ boardComputedAt: Date.now() })
    expect((await authed(`/api/admin/quizzes/${quizId}/report?limit=0`, cookie)).status).toBe(400)
    expect((await authed(`/api/admin/quizzes/${quizId}/report?offset=-1`, cookie)).status).toBe(400)
  })

  it("returns exact participant rows, paginated, in stable rank/seat/user order", async () => {
    const { cookie } = await signInAs("admin")
    const quizId = await insertQuiz({ boardComputedAt: Date.now() })
    const alice = await insertStudent("Alice")
    const bob = await insertStudent("Bob")
    await insertParticipant(quizId, alice, { seatNo: 1, totalScore: 10, rank: 1 })
    await insertParticipant(quizId, bob, { seatNo: 2, totalScore: 5, rank: 2 })

    const res = await authed(`/api/admin/quizzes/${quizId}/report`, cookie)
    expect(res.status).toBe(200)
    const body = await res.json<{ quizId: string; participants: { items: unknown[]; total: number; limit: number; offset: number } }>()
    expect(body.quizId).toBe(quizId)
    expect(body.participants.total).toBe(2)
    expect(body.participants.items).toEqual([
      { userId: alice, name: "Alice", seatNo: 1, totalScore: 10, correctCount: 0, wrongCount: 0, skippedCount: 0, unansweredCount: 0, totalTimeMs: 0, rank: 1 },
      { userId: bob, name: "Bob", seatNo: 2, totalScore: 5, correctCount: 0, wrongCount: 0, skippedCount: 0, unansweredCount: 0, totalTimeMs: 0, rank: 2 },
    ])

    const page2 = await authed(`/api/admin/quizzes/${quizId}/report?limit=1&offset=1`, cookie)
    const page2Body = await page2.json<{ participants: { items: { userId: string }[]; total: number; limit: number; offset: number } }>()
    expect(page2Body.participants.items).toEqual([expect.objectContaining({ userId: bob })])
    expect(page2Body.participants.total).toBe(2)
    expect(page2Body.participants.limit).toBe(1)
    expect(page2Body.participants.offset).toBe(1)
  })

  it("conserves question counts across answered, skipped, explicit-unanswered, and unreached participants", async () => {
    const { cookie } = await signInAs("admin")
    const quizId = await insertQuiz({ boardComputedAt: Date.now() })
    const q1 = await insertQuestion()
    await insertUnit(quizId, 1)
    await insertQuizQuestion(quizId, 1, 1, q1)

    const answered = await insertStudent("Answered")
    const skipped = await insertStudent("Skipped")
    const expiredNoRow = await insertStudent("ExpiredNoRow")
    const explicitUnanswered = await insertStudent("ExplicitUnanswered")
    await insertParticipant(quizId, answered, { seatNo: 1 })
    await insertParticipant(quizId, skipped, { seatNo: 2 })
    await insertParticipant(quizId, expiredNoRow, { seatNo: 3 })
    await insertParticipant(quizId, explicitUnanswered, { seatNo: 4 })

    // answers.(quiz_id, user_id, unit_position) FKs to participant_units — every unit a student was
    // ever served, closed one way or another, has a participant_units row even when the closure
    // produced zero answer rows (the schema's own "server-only expiry" comment).
    await insertParticipantUnit(quizId, answered, 1, { closeReason: "completed" })
    await insertParticipantUnit(quizId, skipped, 1, { closeReason: "completed" })
    await insertParticipantUnit(quizId, explicitUnanswered, 1, { closeReason: "timed_out" })

    await insertAnswer(quizId, answered, q1, 1, 1, "answered", { isCorrect: true })
    await insertAnswer(quizId, skipped, q1, 1, 1, "skipped")
    await insertAnswer(quizId, explicitUnanswered, q1, 1, 1, "unanswered")
    // expiredNoRow has no participant_units or answers row at all for q1 — truly unreached.

    const res = await authed(`/api/admin/quizzes/${quizId}/report`, cookie)
    const body = await res.json<{ questions: { position: number; correctCount: number; wrongCount: number; skippedCount: number; unansweredCount: number }[] }>()
    expect(body.questions).toHaveLength(1)
    const q = body.questions[0]!
    expect(q.correctCount).toBe(1)
    expect(q.wrongCount).toBe(0)
    expect(q.skippedCount).toBe(1)
    expect(q.unansweredCount).toBe(2) // explicit-unanswered row + totally-missing row
    expect(q.correctCount + q.wrongCount + q.skippedCount + q.unansweredCount).toBe(4) // == participant count
  })

  it("returns unit aggregates counting only reached finalized rows, null average when none reached", async () => {
    const { cookie } = await signInAs("admin")
    const quizId = await insertQuiz({ boardComputedAt: Date.now() })
    await insertUnit(quizId, 1)
    await insertUnit(quizId, 2)

    const completed = await insertStudent("Completed")
    const timedOut = await insertStudent("TimedOut")
    const neverJoined = await insertStudent("NeverJoined")
    await insertParticipant(quizId, completed, { seatNo: 1 })
    await insertParticipant(quizId, timedOut, { seatNo: 2 })
    await insertParticipant(quizId, neverJoined, { seatNo: 3 })

    await insertParticipantUnit(quizId, completed, 1, { closeReason: "completed", elapsedMs: 20000 })
    await insertParticipantUnit(quizId, timedOut, 1, { closeReason: "timed_out", elapsedMs: 60000 })
    // neverJoined has no participant_units row at all for unit 1, and unit 2 is entirely unreached by anyone.

    const res = await authed(`/api/admin/quizzes/${quizId}/report`, cookie)
    const body = await res.json<{ units: { unitPosition: number; completedCount: number; timedOutCount: number; avgElapsedMs: number | null }[] }>()
    expect(body.units).toEqual([
      { unitPosition: 1, completedCount: 1, timedOutCount: 1, avgElapsedMs: 40000 },
      { unitPosition: 2, completedCount: 0, timedOutCount: 0, avgElapsedMs: null },
    ])
  })

  it("returns questions/units with zero-valued aggregates (never omitted) for a zero-participant published quiz", async () => {
    const { cookie } = await signInAs("admin")
    const quizId = await insertQuiz({ boardComputedAt: Date.now() })
    const q1 = await insertQuestion()
    await insertUnit(quizId, 1)
    await insertQuizQuestion(quizId, 1, 1, q1)

    const res = await authed(`/api/admin/quizzes/${quizId}/report`, cookie)
    expect(res.status).toBe(200)
    const body = await res.json<{
      participants: { total: number; items: unknown[] }
      questions: { correctCount: number; wrongCount: number; skippedCount: number; unansweredCount: number }[]
      units: { completedCount: number; timedOutCount: number; avgElapsedMs: number | null }[]
    }>()
    expect(body.participants).toEqual({ total: 0, items: [], limit: 50, offset: 0 })
    expect(body.questions).toEqual([{ position: 1, unitPosition: 1, subPosition: 1, questionId: q1, correctCount: 0, wrongCount: 0, skippedCount: 0, unansweredCount: 0 }])
    expect(body.units).toEqual([{ unitPosition: 1, completedCount: 0, timedOutCount: 0, avgElapsedMs: null }])
  })
})
