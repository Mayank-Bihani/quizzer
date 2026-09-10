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
  const id = `rq-${questionSeq}`
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
  opts: { seatCap: number; scheduledAt: number; joinWindowSec: number; timeLimitSec: number }
): Promise<{ quizId: string; roomCode: string; questionId: string }> {
  quizNumberSeq++
  const quizId = crypto.randomUUID()
  const roomCode = `QNT-${1000 + quizNumberSeq}`
  const questionId = await insertMcqQuestion(creatorId, "A")
  const endsAt = opts.scheduledAt + opts.joinWindowSec * 1000
  const lobbyOpensAt = opts.scheduledAt - 300_000
  const windowSec = opts.timeLimitSec

  await env.DB.prepare(
    `INSERT INTO quizzes (id, quiz_number, title, type, question_count, unit_count, difficulty_mix, timing_policy, slack_sec, join_window_sec, scheduled_at, lobby_opens_at, ends_at, status, room_code, seat_cap, window_sec, marks_correct, marks_wrong, created_by, created_at, opened_at)
     VALUES (?, ?, 'Route Test Quiz', 'quant', 1, 1, '{}', '{}', 0, ?, ?, ?, ?, 'open', ?, ?, ?, 4, -1, ?, ?, ?)`
  )
    .bind(quizId, quizNumberSeq, opts.joinWindowSec, opts.scheduledAt, lobbyOpensAt, endsAt, roomCode, opts.seatCap, windowSec, creatorId, Date.now(), Date.now())
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

  return { quizId, roomCode, questionId }
}

const LEAKY_KEYS = ["correctOption", "numericAnswer", "numericTolerance", "explanationMd", "totalScore", "rank"]

function assertNoLeak(raw: string): void {
  for (const key of LEAKY_KEYS) expect(raw).not.toContain(key)
}

describe("guard matrix", () => {
  it("requires authentication on all five runtime routes", async () => {
    const responses = await Promise.all([
      authed("/api/quizzes/open", null),
      authed("/api/quizzes/ABC-1234/join", null, { method: "POST" }),
      authed("/api/play/some-id/current", null),
      authed("/api/play/some-id/units/1/submit", null, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      authed("/api/play/some-id/status", null),
    ])
    for (const res of responses) expect(res.status).toBe(401)
  })
})

describe("GET /api/quizzes/open", () => {
  it("returns the exact unpaginated list of currently joinable quizzes", async () => {
    const { cookie } = await signInAs("student")
    const { id: creatorId } = await signInAs("admin")
    await createOpenQuiz(creatorId, { seatCap: 5, scheduledAt: Date.now() - 1000, joinWindowSec: 600, timeLimitSec: 60 })
    const res = await authed("/api/quizzes/open", cookie)
    expect(res.status).toBe(200)
    const body = await res.json<{ quizzes: unknown[] }>()
    expect(body.quizzes).toHaveLength(1)
  })
})

describe("POST /api/quizzes/:code/join", () => {
  it("returns 404 for an unknown room code", async () => {
    const { cookie } = await signInAs("student")
    const res = await authed("/api/quizzes/NOPE-0000/join", cookie, { method: "POST" })
    expect(res.status).toBe(404)
  })

  it("joins successfully and the raw response never leaks solution/score fields", async () => {
    const { cookie } = await signInAs("student")
    const { id: creatorId } = await signInAs("admin")
    const { roomCode } = await createOpenQuiz(creatorId, { seatCap: 5, scheduledAt: Date.now() - 1000, joinWindowSec: 600, timeLimitSec: 60 })
    const res = await authed(`/api/quizzes/${roomCode}/join`, cookie, { method: "POST" })
    expect(res.status).toBe(200)
    const raw = await res.text()
    assertNoLeak(raw)
    const body = JSON.parse(raw) as { state: { status: string; unit?: { options: string[] | null } } }
    expect(body.state.status).toBe("active")
  })

  it("returns 409 full for the seat-cap+1th distinct user", async () => {
    const { id: creatorId } = await signInAs("admin")
    const { roomCode } = await createOpenQuiz(creatorId, { seatCap: 1, scheduledAt: Date.now() - 1000, joinWindowSec: 600, timeLimitSec: 60 })
    const first = await signInAs("student")
    const second = await signInAs("student")
    const r1 = await authed(`/api/quizzes/${roomCode}/join`, first.cookie, { method: "POST" })
    const r2 = await authed(`/api/quizzes/${roomCode}/join`, second.cookie, { method: "POST" })
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(409)
  })
})

describe("GET /api/play/:quizId/current", () => {
  it("returns 403 for a nonparticipant and 404 for an unknown quiz", async () => {
    const { cookie } = await signInAs("student")
    const { id: creatorId } = await signInAs("admin")
    const { quizId } = await createOpenQuiz(creatorId, { seatCap: 5, scheduledAt: Date.now() - 1000, joinWindowSec: 600, timeLimitSec: 60 })
    expect((await authed(`/api/play/${quizId}/current`, cookie)).status).toBe(403)
    expect((await authed("/api/play/unknown-quiz/current", cookie)).status).toBe(404)
  })

  it("returns the current active unit for a participant with no leaked fields", async () => {
    const { cookie } = await signInAs("student")
    const { id: creatorId } = await signInAs("admin")
    const { roomCode } = await createOpenQuiz(creatorId, { seatCap: 5, scheduledAt: Date.now() - 1000, joinWindowSec: 600, timeLimitSec: 60 })
    const joinRes = await authed(`/api/quizzes/${roomCode}/join`, cookie, { method: "POST" })
    const { meta } = await joinRes.json<{ meta: { quizId: string } }>()
    const res = await authed(`/api/play/${meta.quizId}/current`, cookie)
    expect(res.status).toBe(200)
    assertNoLeak(await res.text())
  })
})

describe("POST /api/play/:quizId/units/:unitPosition/submit", () => {
  async function joinedQuiz(seatCap = 5, timeLimitSec = 60) {
    const { cookie, id: studentId } = await signInAs("student")
    const { id: creatorId } = await signInAs("admin")
    const { quizId, roomCode, questionId } = await createOpenQuiz(creatorId, {
      seatCap,
      scheduledAt: Date.now() - 1000,
      joinWindowSec: 600,
      timeLimitSec,
    })
    const joinRes = await authed(`/api/quizzes/${roomCode}/join`, cookie, { method: "POST" })
    expect(joinRes.status).toBe(200)
    return { cookie, studentId, quizId, questionId }
  }

  it("rejects malformed JSON with 400", async () => {
    const { cookie, quizId } = await joinedQuiz()
    const res = await authed(`/api/play/${quizId}/units/1/submit`, cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    })
    expect(res.status).toBe(400)
  })

  it("rejects an invalid unit position with 400", async () => {
    const { cookie, quizId } = await joinedQuiz()
    const res = await authed(`/api/play/${quizId}/units/0/submit`, cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submissionId: "s1", reason: "complete", answers: [] }),
    })
    expect(res.status).toBe(400)
  })

  it("accepts a valid complete batch and returns finished state with no solution/rank leak", async () => {
    const { cookie, quizId } = await joinedQuiz()
    const res = await authed(`/api/play/${quizId}/units/1/submit`, cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submissionId: "s1", reason: "complete", answers: [{ position: 1, status: "answered", format: "mcq", chosenOption: "A" }] }),
    })
    expect(res.status).toBe(200)
    const raw = await res.text()
    // totalScore is legitimately present once finished (AC-7: "own totalScore"); only solution
    // fields and rank must never appear, here or anywhere else in the run surface.
    for (const key of ["correctOption", "numericAnswer", "numericTolerance", "explanationMd", "rank"]) expect(raw).not.toContain(key)
    const body = JSON.parse(raw) as { closedUnit: { unitPosition: number; reason: string }; state: { status: string } }
    expect(body.closedUnit).toEqual({ unitPosition: 1, reason: "completed" })
    expect(body.state.status).toBe("finished")
  })

  it("returns 403 for a different signed-in user who never joined", async () => {
    const { quizId } = await joinedQuiz()
    const outsider = await signInAs("student")
    const res = await authed(`/api/play/${quizId}/units/1/submit`, outsider.cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submissionId: "s1", reason: "complete", answers: [{ position: 1, status: "skipped" }] }),
    })
    expect(res.status).toBe(403)
  })

  it("returns 409 for a changed retry against an already-closed unit", async () => {
    const { cookie, quizId } = await joinedQuiz()
    await authed(`/api/play/${quizId}/units/1/submit`, cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submissionId: "s1", reason: "complete", answers: [{ position: 1, status: "answered", format: "mcq", chosenOption: "A" }] }),
    })
    const res = await authed(`/api/play/${quizId}/units/1/submit`, cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submissionId: "s2", reason: "complete", answers: [{ position: 1, status: "skipped" }] }),
    })
    expect(res.status).toBe(409)
  })
})

describe("GET /api/play/:quizId/status", () => {
  it("returns 409 while active and 200 with finished-only holding data after finish", async () => {
    const { cookie } = await signInAs("student")
    const { id: creatorId } = await signInAs("admin")
    const { quizId, roomCode } = await createOpenQuiz(creatorId, { seatCap: 5, scheduledAt: Date.now() - 1000, joinWindowSec: 600, timeLimitSec: 60 })
    await authed(`/api/quizzes/${roomCode}/join`, cookie, { method: "POST" })

    const active = await authed(`/api/play/${quizId}/status`, cookie)
    expect(active.status).toBe(409)

    await authed(`/api/play/${quizId}/units/1/submit`, cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submissionId: "s1", reason: "complete", answers: [{ position: 1, status: "answered", format: "mcq", chosenOption: "A" }] }),
    })

    const finished = await authed(`/api/play/${quizId}/status`, cookie)
    expect(finished.status).toBe(200)
    const body = await finished.json<{ totalScore: number; finishedCount: number; participantCount: number }>()
    expect(body.totalScore).toBe(4)
    expect(body.finishedCount).toBe(1)
  })

  it("returns 403 for a nonparticipant and 404 for an unknown quiz", async () => {
    const { cookie } = await signInAs("student")
    const { id: creatorId } = await signInAs("admin")
    const { quizId } = await createOpenQuiz(creatorId, { seatCap: 5, scheduledAt: Date.now() - 1000, joinWindowSec: 600, timeLimitSec: 60 })
    expect((await authed(`/api/play/${quizId}/status`, cookie)).status).toBe(403)
    expect((await authed("/api/play/unknown-quiz/status", cookie)).status).toBe(404)
  })
})

const VOLATILE_KEYS = new Set(["quizId", "startedAt", "deadlineAt", "submitByAt", "endsAt", "serverNow"])

// toMatchFileSnapshot compares against the previously written file on every later run — a
// snapshot's whole point. This artifact isn't a regression snapshot, just a stable place to grep
// for leaks, so its volatile fields (fresh UUID/timestamps every run) are normalized to fixed
// placeholders first, keeping the written content — and therefore the comparison — stable.
function normalizeVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeVolatile)
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) {
      out[key] = VOLATILE_KEYS.has(key) ? (typeof v === "string" ? "<redacted>" : 0) : normalizeVolatile(v)
    }
    return out
  }
  return value
}

describe("raw runtime artifacts (§12a leak inspection)", () => {
  it("captures raw join/current/submit HTTP bodies and the raw KV unit-cache value, all while still active", async () => {
    const { cookie } = await signInAs("student")
    const { id: creatorId } = await signInAs("admin")

    // Two units so the captured submit response stays 'active' (progresses to unit 2) rather than
    // 'finished' — a finished PlayState legitimately carries the participant's own totalScore
    // (AC-7), which would otherwise trip this artifact's blanket "never contains totalScore" scan.
    const quizId = crypto.randomUUID()
    const roomCode = "QNT-8001"
    const q1 = await insertMcqQuestion(creatorId, "A")
    const q2 = await insertMcqQuestion(creatorId, "B")
    const scheduledAt = Date.now() - 1000
    const joinWindowSec = 600
    await env.DB.prepare(
      `INSERT INTO quizzes (id, quiz_number, title, type, question_count, unit_count, difficulty_mix, timing_policy, slack_sec, join_window_sec, scheduled_at, lobby_opens_at, ends_at, status, room_code, seat_cap, window_sec, marks_correct, marks_wrong, created_by, created_at, opened_at)
       VALUES (?, 9001, 'Artifact Quiz', 'quant', 2, 2, '{}', '{}', 0, ?, ?, ?, ?, 'open', ?, 5, 120, 4, -1, ?, ?, ?)`
    )
      .bind(quizId, joinWindowSec, scheduledAt, scheduledAt - 300_000, scheduledAt + joinWindowSec * 1000, roomCode, creatorId, Date.now(), Date.now())
      .run()
    await env.DB.batch([
      env.DB.prepare("INSERT INTO quiz_units (quiz_id, unit_position, kind, passage_id, time_limit_sec) VALUES (?, 1, 'standalone', NULL, 60)").bind(quizId),
      env.DB.prepare("INSERT INTO quiz_units (quiz_id, unit_position, kind, passage_id, time_limit_sec) VALUES (?, 2, 'standalone', NULL, 60)").bind(quizId),
      env.DB.prepare("INSERT INTO quiz_questions (quiz_id, question_id, position, unit_position, sub_position) VALUES (?, ?, 1, 1, 1)").bind(quizId, q1),
      env.DB.prepare("INSERT INTO quiz_questions (quiz_id, question_id, position, unit_position, sub_position) VALUES (?, ?, 2, 2, 1)").bind(quizId, q2),
      ...Array.from({ length: 5 }, (_, i) => env.DB.prepare("INSERT INTO quiz_seats (quiz_id, seat_no) VALUES (?, ?)").bind(quizId, i + 1)),
    ])

    const joinRes = await authed(`/api/quizzes/${roomCode}/join`, cookie, { method: "POST" })
    const joinBody = JSON.parse(await joinRes.text())

    const currentRes = await authed(`/api/play/${quizId}/current`, cookie)
    const currentBody = JSON.parse(await currentRes.text())

    const submitRes = await authed(`/api/play/${quizId}/units/1/submit`, cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submissionId: "art-1", reason: "complete", answers: [{ position: 1, status: "answered", format: "mcq", chosenOption: "A" }] }),
    })
    const submitBody = JSON.parse(await submitRes.text())
    expect(submitBody.state.status).toBe("active") // confirms this capture avoids the legitimate finished-state totalScore

    const cacheRaw = await env.CACHE.get(`unit:${quizId}:1`)

    const httpArtifact = normalizeVolatile({ join: joinBody, current: currentBody, submit: submitBody })
    await expect(JSON.stringify(httpArtifact, null, 2)).toMatchFileSnapshot("./artifacts/runtime-http.json")
    await expect(JSON.stringify(normalizeVolatile(JSON.parse(cacheRaw ?? "null")))).toMatchFileSnapshot("./artifacts/unit-cache.json")
  })
})
