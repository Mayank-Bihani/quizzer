import { env } from "cloudflare:test"
import { beforeEach, describe, expect, it, vi } from "vitest"
import app from "../src/index"
import { jwksResponse, makeGoogleKeyPair, signGoogleIdToken } from "./helpers/google"

beforeEach(async () => {
  for (const table of ["quiz_templates", "quizzes", "users"]) {
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

const VALID_BODY = {
  name: "Weekly Quant",
  type: "quant",
  setCount: null,
  standaloneCount: 2,
  difficultyMix: { easy: 2 },
  timingPolicy: { standalone: 60, lrdi: 180 },
  slackSec: 30,
  joinWindowSec: 600,
  marksCorrect: 4,
  marksWrong: -1,
  seatCap: 120,
  rrule: "FREQ=WEEKLY;BYDAY=TU;BYHOUR=18;BYMINUTE=0",
}

function postJson(path: string, cookie: string | null, body: unknown) {
  return authed(path, cookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("guard matrix", () => {
  it("rejects signed-out callers with 401 on every route", async () => {
    const requests: [string, RequestInit?][] = [
      ["/api/admin/templates"],
      ["/api/admin/templates", { method: "POST", body: "{}" }],
      ["/api/admin/templates/x", { method: "PATCH", body: "{}" }],
      ["/api/admin/templates/x/deactivate", { method: "POST" }],
    ]
    for (const [path, init] of requests) {
      const res = await app.request(path, init, env)
      expect(res.status).toBe(401)
    }
  })

  it("rejects a student with 403 on every route", async () => {
    const { cookie } = await signInAs("student")
    const requests: [string, RequestInit?][] = [
      ["/api/admin/templates"],
      ["/api/admin/templates", { method: "POST", body: "{}" }],
      ["/api/admin/templates/x", { method: "PATCH", body: "{}" }],
      ["/api/admin/templates/x/deactivate", { method: "POST" }],
    ]
    for (const [path, init] of requests) {
      const res = await authed(path, cookie, init)
      expect(res.status).toBe(403)
    }
  })

  it("admits an admin", async () => {
    const { cookie } = await signInAs("admin")
    const res = await authed("/api/admin/templates", cookie)
    expect(res.status).toBe(200)
  })
})

describe("POST /api/admin/templates", () => {
  it("creates a valid template", async () => {
    const { cookie } = await signInAs("admin")
    const res = await postJson("/api/admin/templates", cookie, VALID_BODY)
    expect(res.status).toBe(200)
    const body = await res.json<{ active: boolean; name: string }>()
    expect(body.active).toBe(true)
    expect(body.name).toBe("Weekly Quant")
  })

  it("rejects an unknown field", async () => {
    const { cookie } = await signInAs("admin")
    const res = await postJson("/api/admin/templates", cookie, { ...VALID_BODY, extra: true })
    expect(res.status).toBe(400)
  })

  it("rejects a missing field", async () => {
    const { cookie } = await signInAs("admin")
    const { name: _name, ...withoutName } = VALID_BODY
    const res = await postJson("/api/admin/templates", cookie, withoutName)
    expect(res.status).toBe(400)
  })

  // AC-10 / BE-9: templates stay auto-only by construction — a manual-selection field is just
  // another unknown field to this route, never a mode a template can acquire.
  it("BE-9: rejects mode/questionIds as unknown fields (templates never gain manual mode)", async () => {
    const { cookie } = await signInAs("admin")
    const withMode = await postJson("/api/admin/templates", cookie, { ...VALID_BODY, mode: "manual" })
    expect(withMode.status).toBe(400)
    const withQuestionIds = await postJson("/api/admin/templates", cookie, { ...VALID_BODY, questionIds: ["x"] })
    expect(withQuestionIds.status).toBe(400)
  })

  it("accepts a timingPolicy that omits the type's implied group kind", async () => {
    const { cookie } = await signInAs("admin")
    const res = await postJson("/api/admin/templates", cookie, {
      ...VALID_BODY,
      type: "verbal",
      setCount: 0, // all-standalone VA draw — never groups, so no rc timing entry is needed
      timingPolicy: { standalone: 60 },
    })
    expect(res.status).toBe(200)
  })

  it("rejects a timingPolicy missing the always-required standalone kind", async () => {
    const { cookie } = await signInAs("admin")
    const res = await postJson("/api/admin/templates", cookie, {
      ...VALID_BODY,
      timingPolicy: { lrdi: 180 },
    })
    expect(res.status).toBe(400)
  })

  it("rejects an invalid rrule", async () => {
    const { cookie } = await signInAs("admin")
    const res = await postJson("/api/admin/templates", cookie, { ...VALID_BODY, rrule: "FREQ=DAILY" })
    expect(res.status).toBe(400)
  })
})

describe("GET /api/admin/templates", () => {
  it("lists created templates including inactive ones", async () => {
    const { cookie } = await signInAs("admin")
    const created = await postJson("/api/admin/templates", cookie, VALID_BODY)
    const { id } = await created.json<{ id: string }>()
    await authed(`/api/admin/templates/${id}/deactivate`, cookie, { method: "POST" })

    const res = await authed("/api/admin/templates", cookie)
    expect(res.status).toBe(200)
    const body = await res.json<{ items: { active: boolean }[]; total: number }>()
    expect(body.total).toBe(1)
    expect(body.items[0]?.active).toBe(false)
  })

  it("rejects invalid pagination parameters", async () => {
    const { cookie } = await signInAs("admin")
    const res = await authed("/api/admin/templates?limit=0", cookie)
    expect(res.status).toBe(400)
  })
})

describe("PATCH /api/admin/templates/:id", () => {
  it("applies a partial patch", async () => {
    const { cookie } = await signInAs("admin")
    const created = await postJson("/api/admin/templates", cookie, VALID_BODY)
    const { id } = await created.json<{ id: string }>()

    const res = await authed(`/api/admin/templates/${id}`, cookie, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seatCap: 90 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json<{ seatCap: number }>()
    expect(body.seatCap).toBe(90)
  })

  it("rejects a type-only patch incompatible with the stored timingPolicy", async () => {
    const { cookie } = await signInAs("admin")
    const created = await postJson("/api/admin/templates", cookie, VALID_BODY) // quant: standalone+lrdi
    const { id } = await created.json<{ id: string }>()

    const res = await authed(`/api/admin/templates/${id}`, cookie, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "verbal" }),
    })
    expect(res.status).toBe(400)
  })

  it("BE-9: rejects mode/questionIds as unknown fields on patch", async () => {
    const { cookie } = await signInAs("admin")
    const created = await postJson("/api/admin/templates", cookie, VALID_BODY)
    const { id } = await created.json<{ id: string }>()

    const res = await authed(`/api/admin/templates/${id}`, cookie, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "manual" }),
    })
    expect(res.status).toBe(400)
  })

  it("returns 404 for an unknown id", async () => {
    const { cookie } = await signInAs("admin")
    const res = await authed("/api/admin/templates/does-not-exist", cookie, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seatCap: 90 }),
    })
    expect(res.status).toBe(404)
  })
})

describe("POST /api/admin/templates/:id/deactivate", () => {
  it("deactivates once, then returns 409 on a second call", async () => {
    const { cookie } = await signInAs("admin")
    const created = await postJson("/api/admin/templates", cookie, VALID_BODY)
    const { id } = await created.json<{ id: string }>()

    const first = await authed(`/api/admin/templates/${id}/deactivate`, cookie, { method: "POST" })
    expect(first.status).toBe(200)
    const second = await authed(`/api/admin/templates/${id}/deactivate`, cookie, { method: "POST" })
    expect(second.status).toBe(409)
  })

  it("returns 404 for an unknown id", async () => {
    const { cookie } = await signInAs("admin")
    const res = await authed("/api/admin/templates/does-not-exist/deactivate", cookie, { method: "POST" })
    expect(res.status).toBe(404)
  })
})
