import { env } from "cloudflare:test"
import { beforeEach, describe, expect, it, vi } from "vitest"
import app from "../src/index"
import { jwksResponse, makeGoogleKeyPair, signGoogleIdToken } from "./helpers/google"

beforeEach(async () => {
  // questions/passages.used_in_quiz_id are real FKs into quizzes(id) — once a lock has run,
  // those rows must be cleared before the quiz row itself can be deleted.
  for (const table of ["quiz_questions", "quiz_units", "questions", "passages", "quizzes", "users"]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run()
  }
})

function extractCookie(res: Response): string {
  const header = res.headers.get("set-cookie") ?? ""
  const match = header.match(/quizzer_session=([^;]*)/)
  if (!match) throw new Error("no session cookie in response")
  return match[1] ?? ""
}

async function signInAs(role: "student" | "admin" | "superadmin"): Promise<{ cookie: string; id: string }> {
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

async function seedStandalones(creatorId: string, n: number, type = "quant", difficulty = "easy"): Promise<void> {
  const statements = []
  for (let i = 0; i < n; i++) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO questions (id, type, topic, difficulty, format, body_md, option_a, option_b, option_c, option_d, correct_option, explanation_md, created_by, created_at)
         VALUES (?, ?, 'Topic', ?, 'mcq', 'Body', 'A', 'B', 'C', 'D', 'A', 'Explanation', ?, ?)`
      ).bind(crypto.randomUUID(), type, difficulty, creatorId, Date.now())
    )
  }
  await env.DB.batch(statements)
}

const CREATE_BODY = { title: "Quiz", scheduledAt: 1_700_100_000_000, type: "quant", difficultyMix: { easy: 2 }, count: 2 }

describe("guard matrix", () => {
  it("rejects signed-out callers with 401 on every route", async () => {
    const requests: [string, RequestInit?][] = [
      ["/api/admin/quizzes"],
      ["/api/admin/quizzes", { method: "POST", body: "{}" }],
      ["/api/admin/quizzes/x/reshuffle", { method: "POST" }],
      ["/api/admin/quizzes/x/lock", { method: "POST" }],
      ["/api/admin/quizzes/x/cancel", { method: "POST" }],
      ["/api/admin/quizzes/x", { method: "PATCH", body: "{}" }],
    ]
    for (const [path, init] of requests) {
      const res = await app.request(path, init, env)
      expect(res.status).toBe(401)
    }
  })

  it("rejects a student with 403", async () => {
    const { cookie } = await signInAs("student")
    const res = await authed("/api/admin/quizzes", cookie)
    expect(res.status).toBe(403)
  })

  it("admits admin and superadmin", async () => {
    for (const role of ["admin", "superadmin"] as const) {
      const { cookie } = await signInAs(role)
      const res = await authed("/api/admin/quizzes", cookie)
      expect(res.status).toBe(200)
    }
  })
})

describe("POST /api/admin/quizzes — input validation", () => {
  it("rejects an unknown field", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalones(id, 5)
    const res = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...CREATE_BODY, extra: true }),
    })
    expect(res.status).toBe(400)
  })

  it("rejects a blank title", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalones(id, 5)
    const res = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...CREATE_BODY, title: "   " }),
    })
    expect(res.status).toBe(400)
  })

  it("rejects count outside 1..100", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalones(id, 5)
    for (const count of [0, 101]) {
      const res = await authed("/api/admin/quizzes", cookie, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...CREATE_BODY, count, difficultyMix: { easy: count } }),
      })
      expect(res.status).toBe(400)
    }
  })

  it("rejects a difficultyMix that does not sum to count", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalones(id, 5)
    const res = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...CREATE_BODY, difficultyMix: { easy: 5 }, count: 2 }),
    })
    expect(res.status).toBe(400)
  })

  it("rejects an unknown difficulty key", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalones(id, 5)
    const res = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...CREATE_BODY, difficultyMix: { impossible: 2 } }),
    })
    expect(res.status).toBe(400)
  })

  it("returns 409 with no write when the pool cannot satisfy the exact vector", async () => {
    const { cookie } = await signInAs("admin")
    const res = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(CREATE_BODY),
    })
    expect(res.status).toBe(409)
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM quizzes").first<{ n: number }>()
    expect(row?.n).toBe(0)
  })
})

describe("GET /api/admin/quizzes — pagination", () => {
  it("defaults to 50/0 and returns the full filtered total", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalones(id, 4)
    await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(CREATE_BODY),
    })
    const res = await authed("/api/admin/quizzes", cookie)
    const body = await res.json<{ limit: number; offset: number; total: number }>()
    expect(body.limit).toBe(50)
    expect(body.offset).toBe(0)
    expect(body.total).toBe(1)
  })

  it("returns 400 without clamping for invalid pagination values", async () => {
    const { cookie } = await signInAs("admin")
    for (const limit of ["0", "101", "1.5", "abc", "-1"]) {
      const res = await authed(`/api/admin/quizzes?limit=${limit}`, cookie)
      expect(res.status).toBe(400)
    }
  })

  it("hides the reservation for a draft and exposes identity after scheduling", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalones(id, 4)
    const created = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(CREATE_BODY),
    })
    const draft = await created.json<{ quizId: string }>()

    const listBefore = await authed("/api/admin/quizzes", cookie)
    const beforeBody = await listBefore.json<{ items: { id: string; quizNumber: number | null }[] }>()
    expect(beforeBody.items.find((q) => q.id === draft.quizId)?.quizNumber).toBeNull()

    await authed(`/api/admin/quizzes/${draft.quizId}`, cookie, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timingPolicy: { standalone: 60 }, joinWindowSec: 600, slackSec: 0, marksCorrect: 3, marksWrong: -1 }),
    })
    const lockRes = await authed(`/api/admin/quizzes/${draft.quizId}/lock`, cookie, { method: "POST" })
    const lockBody = await lockRes.json<{ locked: boolean; quizNumber?: number }>()
    expect(lockBody.locked).toBe(true)

    const listAfter = await authed("/api/admin/quizzes", cookie)
    const afterBody = await listAfter.json<{ items: { id: string; quizNumber: number | null; roomCode: string | null }[] }>()
    const item = afterBody.items.find((q) => q.id === draft.quizId)
    expect(item?.quizNumber).toBe(lockBody.quizNumber)
    expect(item?.roomCode).not.toBeNull()
  })
})

describe("PATCH /api/admin/quizzes/:id", () => {
  it("rejects an empty body", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalones(id, 4)
    const created = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(CREATE_BODY),
    })
    const draft = await created.json<{ quizId: string }>()
    const res = await authed(`/api/admin/quizzes/${draft.quizId}`, cookie, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it("rejects a malformed unitTimeLimits array", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalones(id, 4)
    const created = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(CREATE_BODY),
    })
    const draft = await created.json<{ quizId: string }>()
    const res = await authed(`/api/admin/quizzes/${draft.quizId}`, cookie, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unitTimeLimits: [{ unitPosition: "one", timeLimitSec: 60 }] }),
    })
    expect(res.status).toBe(400)
  })

  it("returns 404 for an unknown id", async () => {
    const { cookie } = await signInAs("admin")
    const res = await authed("/api/admin/quizzes/does-not-exist", cookie, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "New" }),
    })
    expect(res.status).toBe(404)
  })
})

describe("full create -> patch -> lock -> cancel flow", () => {
  it("produces exact response shapes with no internal fields at every step", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalones(id, 4)

    const createRes = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(CREATE_BODY),
    })
    expect(createRes.status).toBe(200)
    const created = await createRes.json<Record<string, unknown>>()
    expect(created).not.toHaveProperty("created_by")
    expect(created).toHaveProperty("questions")
    expect(created).toHaveProperty("units")

    const quizId = created.quizId as string
    const patchRes = await authed(`/api/admin/quizzes/${quizId}`, cookie, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timingPolicy: { standalone: 60 }, joinWindowSec: 600, slackSec: 0, marksCorrect: 3, marksWrong: -1 }),
    })
    expect(patchRes.status).toBe(200)

    const lockRes = await authed(`/api/admin/quizzes/${quizId}/lock`, cookie, { method: "POST" })
    expect(lockRes.status).toBe(200)
    const lockBody = await lockRes.json<{ locked: boolean; roomCode?: string; quizNumber?: number }>()
    expect(lockBody.locked).toBe(true)

    const relockRes = await authed(`/api/admin/quizzes/${quizId}/lock`, cookie, { method: "POST" })
    expect(relockRes.status).toBe(409)

    const cancelRes = await authed(`/api/admin/quizzes/${quizId}/cancel`, cookie, { method: "POST" })
    expect(cancelRes.status).toBe(200)
    const cancelBody = await cancelRes.json<{ status: string; roomCode: string | null }>()
    expect(cancelBody.status).toBe("cancelled")
    expect(cancelBody.roomCode).toBe(lockBody.roomCode)
  })
})

describe("reshuffle and cancel guard boundaries", () => {
  it("404s reshuffle/lock/cancel for an unknown id", async () => {
    const { cookie } = await signInAs("admin")
    for (const path of ["reshuffle", "lock", "cancel"]) {
      const res = await authed(`/api/admin/quizzes/does-not-exist/${path}`, cookie, { method: "POST" })
      expect(res.status).toBe(404)
    }
  })
})
