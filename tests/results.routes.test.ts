import { env } from "cloudflare:test"
import { beforeEach, describe, expect, it, vi } from "vitest"
import app from "../src/index"
import { jwksResponse, makeGoogleKeyPair, signGoogleIdToken } from "./helpers/google"

beforeEach(async () => {
  for (const table of [
    "telegram_posts", // a leaderboard/review read can now trigger a lazy close, writing here
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
  if (role !== "student") {
    await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, body.id).run()
    await env.CACHE.delete(`role:${body.id}`)
  }
  return { cookie: extractCookie(res), id: body.id }
}

function authed(path: string, cookie: string | null, init: RequestInit = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
  if (cookie) headers.cookie = `quizzer_session=${cookie}`
  return app.request(path, { ...init, headers }, env)
}

let questionSeq = 0
let quizNumberSeq = 0

async function insertMcqQuestion(creatorId: string, correctOption: "A" | "B" | "C" | "D" = "A"): Promise<string> {
  questionSeq++
  const id = `res-q-${questionSeq}`
  await env.DB.prepare(
    `INSERT INTO questions (id, type, topic, difficulty, format, body_md, option_a, option_b, option_c, option_d, correct_option, explanation_md, created_by, created_at)
     VALUES (?, 'quant', 'Topic', 'easy', 'mcq', ?, 'Opt A', 'Opt B', 'Opt C', 'Opt D', ?, 'Explanation text', ?, ?)`
  )
    .bind(id, `Body ${questionSeq}`, correctOption, creatorId, Date.now())
    .run()
  return id
}

async function createOpenQuiz(
  creatorId: string,
  opts: { seatCap: number; joinWindowSec: number; timeLimitSec: number }
): Promise<{ quizId: string; roomCode: string; endsAt: number; windowSec: number }> {
  quizNumberSeq++
  const quizId = crypto.randomUUID()
  const roomCode = `QNT-${1000 + quizNumberSeq}`
  const questionId = await insertMcqQuestion(creatorId, "A")
  const scheduledAt = Date.now() - 1000
  const endsAt = scheduledAt + opts.joinWindowSec * 1000
  const lobbyOpensAt = scheduledAt - 300_000
  const windowSec = opts.timeLimitSec

  await env.DB.prepare(
    `INSERT INTO quizzes (id, quiz_number, title, type, question_count, unit_count, difficulty_mix, timing_policy, slack_sec, join_window_sec, scheduled_at, lobby_opens_at, ends_at, status, room_code, seat_cap, window_sec, marks_correct, marks_wrong, created_by, created_at, opened_at)
     VALUES (?, ?, 'Results Route Quiz', 'quant', 1, 1, '{}', '{}', 0, ?, ?, ?, ?, 'open', ?, ?, ?, 4, -1, ?, ?, ?)`
  )
    .bind(quizId, quizNumberSeq, opts.joinWindowSec, scheduledAt, lobbyOpensAt, endsAt, roomCode, opts.seatCap, windowSec, creatorId, Date.now(), Date.now())
    .run()

  await env.DB.prepare("INSERT INTO quiz_units (quiz_id, unit_position, kind, passage_id, time_limit_sec) VALUES (?, 1, 'standalone', NULL, ?)")
    .bind(quizId, opts.timeLimitSec)
    .run()
  await env.DB.prepare("INSERT INTO quiz_questions (quiz_id, question_id, position, unit_position, sub_position) VALUES (?, ?, 1, 1, 1)")
    .bind(quizId, questionId)
    .run()
  for (let seatNo = 1; seatNo <= opts.seatCap; seatNo++) {
    await env.DB.prepare("INSERT INTO quiz_seats (quiz_id, seat_no) VALUES (?, ?)").bind(quizId, seatNo).run()
  }

  return { quizId, roomCode, endsAt, windowSec }
}

describe("guard matrix", () => {
  it("requires authentication on all three result routes", async () => {
    const responses = await Promise.all([
      authed("/api/quizzes/some-id/leaderboard", null),
      authed("/api/quizzes/some-id/review", null),
      authed("/api/students/me/history", null),
    ])
    for (const res of responses) expect(res.status).toBe(401)
  })
})

describe("GET /api/quizzes/:quizId/leaderboard", () => {
  it("returns 404 for an unknown quiz", async () => {
    const { cookie } = await signInAs("student")
    expect((await authed("/api/quizzes/unknown/leaderboard", cookie)).status).toBe(404)
  })

  it("returns 403 for a signed-in nonparticipant", async () => {
    const { cookie } = await signInAs("student")
    const { id: creatorId } = await signInAs("admin")
    const { quizId } = await createOpenQuiz(creatorId, { seatCap: 5, joinWindowSec: 600, timeLimitSec: 60 })
    expect((await authed(`/api/quizzes/${quizId}/leaderboard`, cookie)).status).toBe(403)
  })

  it("returns 423 before the safe-close boundary and 200 with the viewer's own row after", async () => {
    const { cookie } = await signInAs("student")
    const { id: creatorId } = await signInAs("admin")
    const { quizId, roomCode } = await createOpenQuiz(creatorId, { seatCap: 5, joinWindowSec: 600, timeLimitSec: 60 })
    await authed(`/api/quizzes/${roomCode}/join`, cookie, { method: "POST" })

    const early = await authed(`/api/quizzes/${quizId}/leaderboard`, cookie)
    expect(early.status).toBe(423)

    // Force the safe-close boundary into the past directly so the route's lazy close fires.
    await env.DB.prepare("UPDATE quizzes SET scheduled_at = ?, lobby_opens_at = ?, ends_at = ? WHERE id = ?")
      .bind(Date.now() - 10_000_000 - 600_000, Date.now() - 10_000_000 - 600_000 - 300_000, Date.now() - 10_000_000, quizId)
      .run()

    const res = await authed(`/api/quizzes/${quizId}/leaderboard`, cookie)
    expect(res.status).toBe(200)
    const body = await res.json<{ rows: { isOwnRow: boolean }[]; participantCount: number }>()
    expect(body.participantCount).toBe(1)
    expect(body.rows.some((r) => r.isOwnRow)).toBe(true)
  })
})

describe("GET /api/quizzes/:quizId/review", () => {
  it("returns 403 for a signed-in nonparticipant and 404 for an unknown quiz", async () => {
    const { cookie } = await signInAs("student")
    const { id: creatorId } = await signInAs("admin")
    const { quizId } = await createOpenQuiz(creatorId, { seatCap: 5, joinWindowSec: 600, timeLimitSec: 60 })
    expect((await authed(`/api/quizzes/${quizId}/review`, cookie)).status).toBe(403)
    expect((await authed("/api/quizzes/unknown/review", cookie)).status).toBe(404)
  })

  it("returns 423 before publication and full solution content only after", async () => {
    const { cookie } = await signInAs("student")
    const { id: creatorId } = await signInAs("admin")
    const { quizId, roomCode } = await createOpenQuiz(creatorId, { seatCap: 5, joinWindowSec: 600, timeLimitSec: 60 })
    await authed(`/api/quizzes/${roomCode}/join`, cookie, { method: "POST" })

    const early = await authed(`/api/quizzes/${quizId}/review`, cookie)
    expect(early.status).toBe(423)
    expect(await early.text()).not.toContain("correctOption")

    await env.DB.prepare("UPDATE quizzes SET scheduled_at = ?, lobby_opens_at = ?, ends_at = ? WHERE id = ?")
      .bind(Date.now() - 10_000_000 - 600_000, Date.now() - 10_000_000 - 600_000 - 300_000, Date.now() - 10_000_000, quizId)
      .run()

    const res = await authed(`/api/quizzes/${quizId}/review`, cookie)
    expect(res.status).toBe(200)
    const body = await res.json<{ rows: { outcome: string; question: { correctOption: string | null } }[] }>()
    expect(body.rows).toHaveLength(1)
    expect(body.rows[0]?.question.correctOption).toBe("A") // solution content only ever appears post-publication
    expect(body.rows[0]?.outcome).toBe("unanswered") // abandoned unit, never submitted
  })
})

describe("GET /api/students/me/history", () => {
  it("rejects invalid pagination with 400", async () => {
    const { cookie } = await signInAs("student")
    expect((await authed("/api/students/me/history?limit=0", cookie)).status).toBe(400)
    expect((await authed("/api/students/me/history?offset=-1", cookie)).status).toBe(400)
    expect((await authed("/api/students/me/history?limit=1.5", cookie)).status).toBe(400)
  })

  it("returns only the caller's own history rows", async () => {
    const { cookie: cookieA } = await signInAs("student")
    const { cookie: cookieB } = await signInAs("student")
    const { id: creatorId } = await signInAs("admin")
    const { roomCode } = await createOpenQuiz(creatorId, { seatCap: 5, joinWindowSec: 600, timeLimitSec: 60 })
    await authed(`/api/quizzes/${roomCode}/join`, cookieA, { method: "POST" })

    const historyA = await authed("/api/students/me/history", cookieA)
    expect(historyA.status).toBe(200)
    const bodyA = await historyA.json<{ items: { quizId: string }[] }>()
    expect(bodyA.items).toHaveLength(1)

    const historyB = await authed("/api/students/me/history", cookieB)
    const bodyB = await historyB.json<{ items: unknown[] }>()
    expect(bodyB.items).toHaveLength(0)
  })
})
