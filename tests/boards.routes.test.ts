import { env } from "cloudflare:test"
import { beforeEach, describe, expect, it, vi } from "vitest"
import app from "../src/index"
import { jwksResponse, makeGoogleKeyPair, signGoogleIdToken } from "./helpers/google"

beforeEach(async () => {
  for (const table of ["weekly_boards", "participants", "quiz_seats", "quiz_questions", "quiz_units", "quizzes", "users"]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run()
  }
})

function extractCookie(res: Response): string {
  const header = res.headers.get("set-cookie") ?? ""
  const match = header.match(/quizzer_session=([^;]*)/)
  if (!match) throw new Error("no session cookie in response")
  return match[1] ?? ""
}

async function signInAsStudent(): Promise<{ cookie: string; id: string }> {
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
  return { cookie: extractCookie(res), id: body.id }
}

function authed(path: string, cookie: string | null, init: RequestInit = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
  if (cookie) headers.cookie = `quizzer_session=${cookie}`
  return app.request(path, { ...init, headers }, env)
}

async function seedOneWeek(weekStart: string, userId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO weekly_boards (week_start, type, user_id, quizzes_taken, total_score, rank) VALUES (?, 'overall', ?, 1, 10, 1)"
  )
    .bind(weekStart, userId)
    .run()
}

describe("GET /api/boards/weekly", () => {
  it("401s when signed out", async () => {
    const res = await authed("/api/boards/weekly", null)
    expect(res.status).toBe(401)
  })

  it("400s on an invalid type", async () => {
    const { cookie } = await signInAsStudent()
    const res = await authed("/api/boards/weekly?type=bogus", cookie)
    expect(res.status).toBe(400)
  })

  it("400s on a malformed weekStart", async () => {
    const { cookie } = await signInAsStudent()
    const res = await authed("/api/boards/weekly?weekStart=not-a-date", cookie)
    expect(res.status).toBe(400)
  })

  it("400s on invalid pagination params without clamping", async () => {
    const { cookie } = await signInAsStudent()
    const res = await authed("/api/boards/weekly?limit=0", cookie)
    expect(res.status).toBe(400)
    const res2 = await authed("/api/boards/weekly?offset=-1", cookie)
    expect(res2.status).toBe(400)
  })

  it("defaults type to overall and weekStart to the most recently published week, with no 404 path", async () => {
    const { cookie, id } = await signInAsStudent()
    await seedOneWeek("2026-09-07", id)
    await seedOneWeek("2026-09-14", id)

    const res = await authed("/api/boards/weekly", cookie)
    expect(res.status).toBe(200)
    const body = await res.json<{ weekStart: string; type: string; total: number; items: unknown[] }>()
    expect(body.weekStart).toBe("2026-09-14")
    expect(body.type).toBe("overall")
    expect(body.total).toBe(1)
  })

  it("returns an empty PageResponse with 200 when no week has ever been published", async () => {
    const { cookie } = await signInAsStudent()
    const res = await authed("/api/boards/weekly", cookie)
    expect(res.status).toBe(200)
    const body = await res.json<{ total: number; items: unknown[] }>()
    expect(body.total).toBe(0)
    expect(body.items).toEqual([])
  })

  it("returns an empty PageResponse (not 404) for an unpublished weekStart", async () => {
    const { cookie } = await signInAsStudent()
    const res = await authed("/api/boards/weekly?weekStart=2099-01-05", cookie)
    expect(res.status).toBe(200)
    const body = await res.json<{ total: number }>()
    expect(body.total).toBe(0)
  })

  it("serves an explicit weekStart/type combination", async () => {
    const { cookie, id } = await signInAsStudent()
    await env.DB.prepare(
      "INSERT INTO weekly_boards (week_start, type, user_id, quizzes_taken, total_score, rank) VALUES ('2026-09-07', 'quant', ?, 2, 25, 1)"
    )
      .bind(id)
      .run()

    const res = await authed("/api/boards/weekly?weekStart=2026-09-07&type=quant", cookie)
    expect(res.status).toBe(200)
    const body = await res.json<{ items: { userId: string; totalScore: number; quizzesTaken: number }[] }>()
    expect(body.items).toEqual([{ rank: 1, userId: id, name: expect.any(String), totalScore: 25, quizzesTaken: 2 }])
  })
})
