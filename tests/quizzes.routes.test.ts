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

async function seedStandalonesWithTopic(creatorId: string, n: number, type: string, topic: string, difficulty = "easy"): Promise<void> {
  const statements = []
  for (let i = 0; i < n; i++) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO questions (id, type, topic, difficulty, format, body_md, option_a, option_b, option_c, option_d, correct_option, explanation_md, created_by, created_at)
         VALUES (?, ?, ?, ?, 'mcq', 'Body', 'A', 'B', 'C', 'D', 'A', 'Explanation', ?, ?)`
      ).bind(crypto.randomUUID(), type, topic, difficulty, creatorId, Date.now())
    )
  }
  await env.DB.batch(statements)
}

async function seedGroup(creatorId: string, type = "verbal", difficulty = "medium"): Promise<string[]> {
  const passageId = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO passages (id, type, topic, body_md, created_by, created_at) VALUES (?, ?, 'Topic', 'Passage body', ?, ?)"
  )
    .bind(passageId, type, creatorId, Date.now())
    .run()
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
  const statements = ids.map((id, i) =>
    env.DB.prepare(
      `INSERT INTO questions (id, type, topic, difficulty, format, passage_id, group_position, body_md, option_a, option_b, option_c, option_d, correct_option, explanation_md, created_by, created_at)
       VALUES (?, ?, 'Topic', ?, 'mcq', ?, ?, 'Body', 'A', 'B', 'C', 'D', 'A', 'Explanation', ?, ?)`
    ).bind(id, type, difficulty, passageId, i + 1, creatorId, Date.now())
  )
  await env.DB.batch(statements)
  return ids
}

async function unusedIds(type: string, difficulty: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT id FROM questions WHERE type = ? AND difficulty = ? AND passage_id IS NULL AND used_in_quiz_id IS NULL ORDER BY created_at ASC"
  )
    .bind(type, difficulty)
    .all<{ id: string }>()
  return results.map((r) => r.id)
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

  it("rejects a difficultyMix that sums to more than count", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalones(id, 5)
    const res = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...CREATE_BODY, difficultyMix: { easy: 5 }, count: 2 }),
    })
    expect(res.status).toBe(400)
  })

  it("fills the shortfall from any difficulty when difficultyMix sums to less than count", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalones(id, 1, "quant", "easy")
    await seedStandalones(id, 1, "quant", "medium")
    const res = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...CREATE_BODY, difficultyMix: { easy: 1 }, count: 2 }),
    })
    expect(res.status).toBe(200)
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

describe("POST /api/admin/quizzes — lr/verbal set-based auto draws", () => {
  it("lr setCount=1 draws one whole LRDI set, not a single question", async () => {
    const { cookie, id } = await signInAs("admin")
    const groupIds = await seedGroup(id, "lr", "medium")

    const res = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "LRDI quiz", scheduledAt: 1_700_100_000_000, type: "lr", setCount: 1 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json<{ questionCount: number; unitCount: number; units: { kind: string; questionPositions: number[] }[] }>()
    expect(body.questionCount).toBe(4)
    expect(body.unitCount).toBe(1)
    expect(body.units[0]).toMatchObject({ kind: "lrdi", questionPositions: [1, 2, 3, 4] })
    expect(groupIds).toHaveLength(4)
  })

  it("lr setCount=1 returns 409 with no write when no LRDI set exists", async () => {
    const { cookie } = await signInAs("admin")
    const res = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "LRDI quiz", scheduledAt: 1_700_100_000_000, type: "lr", setCount: 1 }),
    })
    expect(res.status).toBe(409)
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM quizzes").first<{ n: number }>()
    expect(row?.n).toBe(0)
  })

  it("lr rejects count/difficultyMix/standaloneCount alongside setCount", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedGroup(id, "lr", "medium")
    const res = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "LRDI quiz", scheduledAt: 1_700_100_000_000, type: "lr", setCount: 1, count: 4 }),
    })
    expect(res.status).toBe(400)
  })

  it("verbal setCount=1/standaloneCount=0 draws the RC passage, never substituting a standalone VA question", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedGroup(id, "verbal", "medium")
    await seedStandalones(id, 3, "verbal", "medium") // VA questions that must NOT be drawn instead

    const res = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "VARC quiz",
        scheduledAt: 1_700_100_000_000,
        type: "verbal",
        setCount: 1,
        standaloneCount: 0,
        standaloneDifficultyMix: {},
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json<{ questionCount: number; unitCount: number; units: { kind: string }[] }>()
    expect(body.questionCount).toBe(4)
    expect(body.unitCount).toBe(1)
    expect(body.units[0]?.kind).toBe("rc")
  })

  it("verbal setCount=0/standaloneCount=1 draws exactly one standalone VA question, no passage", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalones(id, 1, "verbal", "easy")

    const res = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "VARC quiz",
        scheduledAt: 1_700_100_000_000,
        type: "verbal",
        setCount: 0,
        standaloneCount: 1,
        standaloneDifficultyMix: {},
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json<{ questionCount: number; unitCount: number; units: { kind: string }[] }>()
    expect(body.questionCount).toBe(1)
    expect(body.unitCount).toBe(1)
    expect(body.units[0]?.kind).toBe("standalone")
  })

  it("verbal rejects setCount and standaloneCount both 0", async () => {
    const { cookie } = await signInAs("admin")
    const res = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "VARC quiz",
        scheduledAt: 1_700_100_000_000,
        type: "verbal",
        setCount: 0,
        standaloneCount: 0,
        standaloneDifficultyMix: {},
      }),
    })
    expect(res.status).toBe(400)
  })

  it("verbal rejects count/difficultyMix instead of setCount/standaloneCount", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalones(id, 1, "verbal", "easy")
    const res = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "VARC quiz", scheduledAt: 1_700_100_000_000, type: "verbal", count: 1, difficultyMix: {} }),
    })
    expect(res.status).toBe(400)
  })

  it("quant rejects setCount/standaloneCount/standaloneDifficultyMix", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalones(id, 1)
    const res = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Quant quiz", scheduledAt: 1_700_100_000_000, type: "quant", setCount: 1 }),
    })
    expect(res.status).toBe(400)
  })
})

describe("POST /api/admin/quizzes — quant topics filter", () => {
  it("BE-4: draws only from the given topics, 409 pool_exhausted when that subset can't satisfy count", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalonesWithTopic(id, 1, "quant", "Arithmetic")
    await seedStandalonesWithTopic(id, 5, "quant", "Algebra")
    const res = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...CREATE_BODY, difficultyMix: {}, count: 5, topics: ["Arithmetic"] }),
    })
    expect(res.status).toBe(409)
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM quizzes").first<{ n: number }>()
    expect(row?.n).toBe(0)
  })

  it("draws only from the given topic when the pool has enough", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalonesWithTopic(id, 2, "quant", "Arithmetic")
    await seedStandalonesWithTopic(id, 5, "quant", "Algebra")
    const res = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...CREATE_BODY, difficultyMix: {}, count: 2, topics: ["Arithmetic"] }),
    })
    expect(res.status).toBe(200)
    const body = await res.json<{ questions: { topic: string }[] }>()
    expect(body.questions.every((q) => q.topic === "Arithmetic")).toBe(true)
  })

  it("defaults to [] (no filter) when topics is omitted", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalones(id, 5)
    const res = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(CREATE_BODY),
    })
    expect(res.status).toBe(200)
  })

  it("rejects invalid topics: duplicates, non-strings, and over MAX_TOPICS_PER_DRAW", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalones(id, 5)
    for (const topics of [["A", "A"], [1, 2], Array.from({ length: 21 }, (_, i) => `t${i}`)]) {
      const res = await authed("/api/admin/quizzes", cookie, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...CREATE_BODY, topics }),
      })
      expect(res.status).toBe(400)
    }
  })

  it("BE-5: rejects topics sent with type lr or verbal", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedGroup(id, "lr", "medium")
    const lrRes = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "LRDI quiz", scheduledAt: 1_700_100_000_000, type: "lr", setCount: 1, topics: ["A"] }),
    })
    expect(lrRes.status).toBe(400)

    await seedStandalones(id, 1, "verbal", "easy")
    const verbalRes = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "VARC quiz",
        scheduledAt: 1_700_100_000_000,
        type: "verbal",
        setCount: 0,
        standaloneCount: 1,
        standaloneDifficultyMix: {},
        topics: ["A"],
      }),
    })
    expect(verbalRes.status).toBe(400)
  })

  it("BE-6: reshuffle redraws only within the topics stored on the draft", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalonesWithTopic(id, 3, "quant", "Arithmetic")
    await seedStandalonesWithTopic(id, 3, "quant", "Algebra")
    const created = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...CREATE_BODY, difficultyMix: {}, count: 2, topics: ["Arithmetic"] }),
    })
    const { quizId } = await created.json<{ quizId: string }>()

    const reshuffled = await authed(`/api/admin/quizzes/${quizId}/reshuffle`, cookie, { method: "POST" })
    expect(reshuffled.status).toBe(200)
    const body = await reshuffled.json<{ questions: { topic: string }[] }>()
    expect(body.questions.every((q) => q.topic === "Arithmetic")).toBe(true)
  })
})

describe("POST /api/admin/quizzes — manual mode", () => {
  it("BE-1: creates a manual draft from a whole standalone pair + a whole group", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalones(id, 2, "verbal", "easy")
    const standaloneIds = await unusedIds("verbal", "easy")
    const groupIds = await seedGroup(id, "verbal", "hard")

    const res = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Manual quiz",
        scheduledAt: 1_700_100_000_000,
        type: "verbal",
        mode: "manual",
        questionIds: [...standaloneIds, ...groupIds],
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json<{ quizId: string; questionCount: number; unitCount: number }>()
    expect(body.questionCount).toBe(6)
    expect(body.unitCount).toBe(3)

    const row = await env.DB.prepare("SELECT selection_mode FROM quizzes WHERE id = ?")
      .bind(body.quizId)
      .first<{ selection_mode: string }>()
    expect(row?.selection_mode).toBe("manual")
  })

  it("BE-2: rejects a partial group with no write", async () => {
    const { cookie, id } = await signInAs("admin")
    const groupIds = await seedGroup(id, "verbal", "hard")

    const res = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Manual quiz",
        scheduledAt: 1_700_100_000_000,
        type: "verbal",
        mode: "manual",
        questionIds: groupIds.slice(0, 3),
      }),
    })
    expect(res.status).toBe(400)
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM quizzes").first<{ n: number }>()
    expect(row?.n).toBe(0)
  })

  it("BE-3: rejects a duplicate id", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalones(id, 1, "verbal", "easy")
    const [standaloneId] = await unusedIds("verbal", "easy")

    const res = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Manual quiz",
        scheduledAt: 1_700_100_000_000,
        type: "verbal",
        mode: "manual",
        questionIds: [standaloneId, standaloneId],
      }),
    })
    expect(res.status).toBe(400)
  })

  it("BE-4: rejects an already-used id as no longer in the unused pool", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalones(id, 1, "verbal", "easy")
    const [standaloneId] = await unusedIds("verbal", "easy")
    await env.DB.prepare("INSERT INTO quizzes (id, title, type, scheduled_at, created_by, created_at) VALUES (?, 'Other', 'verbal', ?, ?, ?)")
      .bind("other-quiz", Date.now(), id, Date.now())
      .run()
    await env.DB.prepare("UPDATE questions SET used_in_quiz_id = ? WHERE id = ?").bind("other-quiz", standaloneId).run()

    const res = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Manual quiz",
        scheduledAt: 1_700_100_000_000,
        type: "verbal",
        mode: "manual",
        questionIds: [standaloneId],
      }),
    })
    expect(res.status).toBe(400)
  })

  it("BE-5: rejects difficultyMix sent alongside mode: manual", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalones(id, 1, "verbal", "easy")
    const [standaloneId] = await unusedIds("verbal", "easy")

    const res = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Manual quiz",
        scheduledAt: 1_700_100_000_000,
        type: "verbal",
        mode: "manual",
        questionIds: [standaloneId],
        difficultyMix: { easy: 1 },
      }),
    })
    expect(res.status).toBe(400)
  })

  it("rejects questionIds sent with mode: auto (or omitted)", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalones(id, 2)
    const res = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...CREATE_BODY, questionIds: ["x"] }),
    })
    expect(res.status).toBe(400)
  })

  it("BE-6: blocks reshuffle of a manual draft with 409 and no DB change", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalones(id, 2, "verbal", "easy")
    const standaloneIds = await unusedIds("verbal", "easy")
    const createRes = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Manual quiz",
        scheduledAt: 1_700_100_000_000,
        type: "verbal",
        mode: "manual",
        questionIds: standaloneIds,
      }),
    })
    const { quizId } = await createRes.json<{ quizId: string }>()
    const before = await env.DB.prepare("SELECT * FROM quiz_questions WHERE quiz_id = ?").bind(quizId).all()

    const res = await authed(`/api/admin/quizzes/${quizId}/reshuffle`, cookie, { method: "POST" })
    expect(res.status).toBe(409)
    const after = await env.DB.prepare("SELECT * FROM quiz_questions WHERE quiz_id = ?").bind(quizId).all()
    expect(after.results).toEqual(before.results)
  })

  it("BE-7/BE-8: auto mode create + reshuffle are unaffected", async () => {
    const { cookie, id } = await signInAs("admin")
    await seedStandalones(id, 4)
    const createRes = await authed("/api/admin/quizzes", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(CREATE_BODY),
    })
    expect(createRes.status).toBe(200)
    const { quizId } = await createRes.json<{ quizId: string }>()
    const row = await env.DB.prepare("SELECT selection_mode FROM quizzes WHERE id = ?")
      .bind(quizId)
      .first<{ selection_mode: string }>()
    expect(row?.selection_mode).toBe("auto")

    const reshuffleRes = await authed(`/api/admin/quizzes/${quizId}/reshuffle`, cookie, { method: "POST" })
    expect(reshuffleRes.status).toBe(200)
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
