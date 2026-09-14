import { env } from "cloudflare:test"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Bindings } from "../src/core/config"
import { assertProductionConfig, ProductionConfigError } from "../src/core/config"
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

// ============================================================================
// AC-8 — API response hardening headers + generic error handling
// ============================================================================

describe("AC-8: API response hardening", () => {
  it("sets Cache-Control: no-store and X-Content-Type-Options: nosniff on every /api/* response", async () => {
    const res = await app.request("/api/auth/google", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, env)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
  })

  it("sets the hardening headers even on a 404 for an unmounted /api path", async () => {
    const res = await app.request("/api/does-not-exist", {}, env)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
  })

  it("returns only a generic {message} body (never the missing-binding name) when the fail-closed config gate throws", async () => {
    // Forces src/core/config.ts's assertProductionConfig to throw via the request-path gate —
    // the HTTP response must stay fully generic even though the server-side log (not asserted
    // here) is allowed to name the missing binding.
    const brokenEnv = { ...env, GOOGLE_CLIENT_ID: "" }
    const res = await app.request("/api/students/me/history", {}, brokenEnv)
    expect(res.status).toBe(500)
    const body = await res.json<{ message?: string }>()
    expect(body).toEqual({ message: "Internal error" })
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
  })
})

// ============================================================================
// AC-9 — fail-closed production configuration assertion
// ============================================================================

function baseBindings(overrides: Partial<Bindings> = {}): Bindings {
  return {
    DB: env.DB,
    CACHE: env.CACHE,
    IMAGES: env.IMAGES,
    GOOGLE_CLIENT_ID: "client-id",
    SESSION_SIGNING_KEY: "0123456789abcdef0123456789abcdef",
    SUPERADMIN_EMAIL: "admin@example.com",
    TELEGRAM_ENABLED: "false",
    ...overrides,
  }
}

describe("AC-9: assertProductionConfig", () => {
  it("passes when always-required bindings are present and Telegram is disabled", () => {
    expect(() => assertProductionConfig(baseBindings())).not.toThrow()
  })

  it("rejects a missing/empty always-required var, naming only that binding", () => {
    expect(() => assertProductionConfig(baseBindings({ GOOGLE_CLIENT_ID: "" }))).toThrow(ProductionConfigError)
    try {
      assertProductionConfig(baseBindings({ SESSION_SIGNING_KEY: "" }))
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ProductionConfigError)
      expect((err as ProductionConfigError).bindingName).toBe("SESSION_SIGNING_KEY")
      expect((err as Error).message).not.toContain("0123456789abcdef") // never the value
    }
  })

  it("does not require Telegram/email bindings when TELEGRAM_ENABLED is not 'true'", () => {
    expect(() =>
      assertProductionConfig(baseBindings({ TELEGRAM_ENABLED: "false", TELEGRAM_BOT_TOKEN: undefined, TELEGRAM_CHAT_ID: undefined }))
    ).not.toThrow()
  })

  it("rejects an enabled Telegram configuration missing any required piece", () => {
    const enabledComplete = baseBindings({
      TELEGRAM_ENABLED: "true",
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: "chat",
      TELEGRAM_ALERT_CHAT_ID: "alert-chat",
    })
    expect(() => assertProductionConfig(enabledComplete)).not.toThrow()

    for (const missing of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "TELEGRAM_ALERT_CHAT_ID"] as const) {
      expect(() => assertProductionConfig({ ...enabledComplete, [missing]: "" })).toThrow(ProductionConfigError)
    }
  })

  it("does not require email-alert config even when Telegram is enabled", () => {
    const enabledNoEmail = baseBindings({
      TELEGRAM_ENABLED: "true",
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: "chat",
      TELEGRAM_ALERT_CHAT_ID: "alert-chat",
      EMAIL_ALERT_ADDRESS: undefined,
      ALERT_EMAIL: undefined,
    })
    expect(() => assertProductionConfig(enabledNoEmail)).not.toThrow()
  })
})

// ============================================================================
// AC-6 — the complete 35-route inventory, guarded exactly as documented (API.md's route table)
// ============================================================================

type RouteCase = { method: string; path: string; guard: "none" | "auth" | "admin" | "superadmin" }

// Mirrors API.md's "Route inventory and revision": AUTH 5, BANK 9, QUIZZING 23 (creation 6,
// templates 5, run 6, results 4, report 1, upcoming 1), BOARDS 2 (weekly, monthly) = 37. Path
// params use a placeholder id — this proves guard behavior only, which runs before any
// per-resource lookup.
const ROUTE_INVENTORY: RouteCase[] = [
  { method: "POST", path: "/api/auth/google", guard: "none" },
  { method: "POST", path: "/api/auth/logout", guard: "none" },
  { method: "GET", path: "/api/auth/me", guard: "auth" },
  { method: "GET", path: "/api/admin/users", guard: "admin" },
  { method: "POST", path: "/api/admin/users/placeholder-id/role", guard: "superadmin" },
  { method: "POST", path: "/api/bank/import/preview", guard: "admin" },
  { method: "POST", path: "/api/bank/import/commit", guard: "admin" },
  { method: "GET", path: "/api/bank/questions", guard: "admin" },
  { method: "GET", path: "/api/bank/questions/placeholder-id", guard: "admin" },
  { method: "PATCH", path: "/api/bank/questions/placeholder-id", guard: "admin" },
  { method: "DELETE", path: "/api/bank/questions/placeholder-id", guard: "admin" },
  { method: "GET", path: "/api/bank/passages", guard: "admin" },
  { method: "GET", path: "/api/bank/topics", guard: "admin" },
  { method: "GET", path: "/api/images/placeholder-key", guard: "auth" },
  { method: "GET", path: "/api/admin/quizzes", guard: "admin" },
  { method: "POST", path: "/api/admin/quizzes", guard: "admin" },
  { method: "POST", path: "/api/admin/quizzes/placeholder-id/reshuffle", guard: "admin" },
  { method: "POST", path: "/api/admin/quizzes/placeholder-id/lock", guard: "admin" },
  { method: "PATCH", path: "/api/admin/quizzes/placeholder-id", guard: "admin" },
  { method: "POST", path: "/api/admin/quizzes/placeholder-id/cancel", guard: "admin" },
  { method: "GET", path: "/api/admin/templates", guard: "admin" },
  { method: "POST", path: "/api/admin/templates", guard: "admin" },
  { method: "PATCH", path: "/api/admin/templates/placeholder-id", guard: "admin" },
  { method: "POST", path: "/api/admin/templates/placeholder-id/deactivate", guard: "admin" },
  { method: "POST", path: "/api/admin/templates/materialize-now", guard: "admin" },
  { method: "GET", path: "/api/quizzes/open", guard: "auth" },
  { method: "GET", path: "/api/quizzes/upcoming", guard: "auth" },
  { method: "POST", path: "/api/quizzes/ABCDEF/join", guard: "auth" },
  { method: "GET", path: "/api/play/placeholder-id/current", guard: "auth" },
  { method: "POST", path: "/api/play/placeholder-id/units/1/submit", guard: "auth" },
  { method: "GET", path: "/api/play/placeholder-id/status", guard: "auth" },
  { method: "GET", path: "/api/quizzes/placeholder-id/leaderboard", guard: "auth" },
  { method: "GET", path: "/api/quizzes/placeholder-id/review", guard: "auth" },
  { method: "GET", path: "/api/students/me/history", guard: "auth" },
  { method: "GET", path: "/api/boards/weekly", guard: "auth" },
  { method: "GET", path: "/api/boards/monthly", guard: "auth" },
  { method: "GET", path: "/api/admin/quizzes/placeholder-id/report", guard: "admin" },
]

describe("AC-6: route-guard inventory", () => {
  it("declares exactly 37 documented routes", () => {
    expect(ROUTE_INVENTORY).toHaveLength(37)
  })

  it("has no unguarded alias or debug/test endpoint mounted beyond the documented routes", () => {
    // Hono's own route table is the ground truth for what's actually reachable — not just what
    // this file declares. Dedup: an inline per-route middleware arg (e.g. `.get("/me", requireAuth,
    // handler)`) registers two internal entries for the same method+path; router-level `.use("*", …)`
    // guards register separate "ALL" wildcard entries. Both are collapsed by this Set.
    const mounted = new Set(
      (app.routes as { method: string; path: string }[]).filter((r) => r.method !== "ALL").map((r) => `${r.method} ${r.path}`)
    )
    const documented = new Set(ROUTE_INVENTORY.map((r) => `${r.method} ${r.path.replace(/placeholder-(id|key)/g, ":$1").replace("ABCDEF", ":code")}`))
    // Normalize path-param placeholders back to Hono's own `:name` spelling for a few routes whose
    // param name differs from the generic "id"/"key" used above.
    const paramRenames: [RegExp, string][] = [
      [/:id\/role$/, ":id/role"],
      [/quizzes\/:id\/report$/, "quizzes/:id/report"],
      [/play\/:id\/(current|status)$/, "play/:quizId/$1"],
      [/play\/:id\/units\/1\/submit$/, "play/:quizId/units/:unitPosition/submit"],
      [/quizzes\/:id\/(leaderboard|review)$/, "quizzes/:quizId/$1"],
    ]
    const normalizedDocumented = new Set(
      [...documented].map((entry) => {
        let out = entry
        for (const [pattern, replacement] of paramRenames) out = out.replace(pattern, replacement)
        return out
      })
    )
    expect(mounted).toEqual(normalizedDocumented)
  })

  it("rejects every guarded route when signed out with 401", async () => {
    for (const route of ROUTE_INVENTORY) {
      if (route.guard === "none") continue
      const res = await authed(route.path, null, { method: route.method, headers: { "content-type": "application/json" } })
      expect(res.status, `${route.method} ${route.path}`).toBe(401)
    }
  })

  it("rejects every admin/superadmin-guarded route for a signed-in student with 403", async () => {
    const { cookie } = await signInAs("student")
    for (const route of ROUTE_INVENTORY) {
      if (route.guard !== "admin" && route.guard !== "superadmin") continue
      const res = await authed(route.path, cookie, { method: route.method, headers: { "content-type": "application/json" } })
      expect(res.status, `${route.method} ${route.path}`).toBe(403)
    }
  })

  it("passes every admin-guarded route through for an admin, while superadmin-only still 403s an admin", async () => {
    const { cookie } = await signInAs("admin")
    for (const route of ROUTE_INVENTORY) {
      if (route.guard === "admin") {
        const res = await authed(route.path, cookie, { method: route.method, headers: { "content-type": "application/json" } })
        expect([401, 403], `${route.method} ${route.path}`).not.toContain(res.status)
      }
      if (route.guard === "superadmin") {
        const res = await authed(route.path, cookie, { method: route.method, headers: { "content-type": "application/json" } })
        expect(res.status, `${route.method} ${route.path}`).toBe(403)
      }
    }
  })

  it("passes every superadmin-guarded route through for a superadmin", async () => {
    const { cookie } = await signInAs("superadmin")
    for (const route of ROUTE_INVENTORY.filter((r) => r.guard === "superadmin")) {
      const res = await authed(route.path, cookie, { method: route.method, headers: { "content-type": "application/json" } })
      expect([401, 403], `${route.method} ${route.path}`).not.toContain(res.status)
    }
  })

  it("passes every auth-only route through for a signed-in student (never 401)", async () => {
    const { cookie } = await signInAs("student")
    for (const route of ROUTE_INVENTORY) {
      if (route.guard !== "auth") continue
      const res = await authed(route.path, cookie, { method: route.method, headers: { "content-type": "application/json" } })
      expect(res.status, `${route.method} ${route.path}`).not.toBe(401)
    }
  })
})

// ============================================================================
// AC-7 — solution/score secrecy before publication, review unlocks only for participants after
// ============================================================================

let reportQuestionSeq = 0

async function insertMcqQuestion(creatorId: string, correctOption: "A" | "B" | "C" | "D" = "A"): Promise<string> {
  reportQuestionSeq++
  const id = `sec-q-${reportQuestionSeq}`
  await env.DB.prepare(
    `INSERT INTO questions (id, type, topic, difficulty, format, body_md, option_a, option_b, option_c, option_d, correct_option, explanation_md, created_by, created_at)
     VALUES (?, 'quant', 'Topic', 'easy', 'mcq', ?, 'Opt A', 'Opt B', 'Opt C', 'Opt D', ?, 'Explanation text', ?, ?)`
  )
    .bind(id, `Body ${reportQuestionSeq}`, correctOption, creatorId, Date.now())
    .run()
  return id
}

// Two units, submitting only the first, keeps the run 'active' rather than 'finished' — a
// finished PlayState legitimately carries the participant's OWN totalScore (API.md's documented
// PlayStatusResponse exception), which would otherwise trip this file's blanket "never
// totalScore/rank" scan. The scan is about *active* totals/rank staying hidden, not that
// exception.
async function createOpenQuiz(creatorId: string): Promise<{ quizId: string; roomCode: string }> {
  const quizId = crypto.randomUUID()
  const roomCode = `QNT-${1000 + reportQuestionSeq}`
  const q1 = await insertMcqQuestion(creatorId, "A")
  const q2 = await insertMcqQuestion(creatorId, "B")
  const now = Date.now()

  await env.DB.prepare(
    `INSERT INTO quizzes (id, quiz_number, title, type, question_count, unit_count, difficulty_mix, timing_policy, slack_sec, join_window_sec, scheduled_at, lobby_opens_at, ends_at, status, room_code, seat_cap, window_sec, marks_correct, marks_wrong, created_by, created_at, opened_at)
     VALUES (?, ?, 'Security Test Quiz', 'quant', 2, 2, '{}', '{}', 0, 600, ?, ?, ?, 'open', ?, 5, 120, 4, -1, ?, ?, ?)`
  )
    .bind(quizId, reportQuestionSeq, now, now - 300_000, now + 600_000, roomCode, creatorId, now, now)
    .run()

  await env.DB.prepare("INSERT INTO quiz_units (quiz_id, unit_position, kind, passage_id, time_limit_sec) VALUES (?, 1, 'standalone', NULL, 60)").bind(quizId).run()
  await env.DB.prepare("INSERT INTO quiz_units (quiz_id, unit_position, kind, passage_id, time_limit_sec) VALUES (?, 2, 'standalone', NULL, 60)").bind(quizId).run()
  await env.DB.prepare("INSERT INTO quiz_questions (quiz_id, question_id, position, unit_position, sub_position) VALUES (?, ?, 1, 1, 1)").bind(quizId, q1).run()
  await env.DB.prepare("INSERT INTO quiz_questions (quiz_id, question_id, position, unit_position, sub_position) VALUES (?, ?, 2, 2, 1)").bind(quizId, q2).run()
  for (let seatNo = 1; seatNo <= 5; seatNo++) {
    await env.DB.prepare("INSERT INTO quiz_seats (quiz_id, seat_no) VALUES (?, ?)").bind(quizId, seatNo).run()
  }
  return { quizId, roomCode }
}

const VOLATILE_KEYS = new Set(["quizId", "userId", "id", "roomCode", "submitByAt", "deadlineAt", "startedAt", "scheduledAt", "endsAt", "serverNow"])

function normalizeVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeVolatile)
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = VOLATILE_KEYS.has(key) ? (typeof v === "string" ? "<redacted>" : 0) : normalizeVolatile(v)
    }
    return out
  }
  return value
}

const LEAKY_KEYS = ["correctOption", "numericAnswer", "numericTolerance", "explanationMd", "isCorrect", "marks", "totalScore", "rank"]

describe("AC-7: unpublished solution/score secrecy, participant-only post-publication review", () => {
  it("keeps every student-visible pre-publication response and the unit cache free of solutions/scores/rank", async () => {
    const { cookie: adminCookie, id: creatorId } = await signInAs("admin")
    const { cookie: participantCookie } = await signInAs("student")
    const { cookie: outsiderCookie } = await signInAs("student")
    const { quizId, roomCode } = await createOpenQuiz(creatorId)

    const joinRes = await authed(`/api/quizzes/${roomCode}/join`, participantCookie, { method: "POST" })
    expect(joinRes.status).toBe(200)
    const joinBody = await joinRes.clone().json()

    const currentRes = await authed(`/api/play/${quizId}/current`, participantCookie)
    const currentBody = await currentRes.clone().json()

    const submitRes = await authed(`/api/play/${quizId}/units/1/submit`, participantCookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submissionId: "sec-1", reason: "complete", answers: [{ position: 1, status: "answered", format: "mcq", chosenOption: "A" }] }),
    })
    const submitBody = await submitRes.clone().json()
    const submitState = (submitBody as { state?: { status?: string } }).state
    expect(submitState?.status).toBe("active") // never 'finished' here — see createOpenQuiz's comment

    const statusRes = await authed(`/api/play/${quizId}/status`, participantCookie)
    expect(statusRes.status).toBe(409) // still actively playing, not yet finished
    const statusBody = await statusRes.clone().json()

    const leaderboardRes = await authed(`/api/quizzes/${quizId}/leaderboard`, participantCookie)
    expect(leaderboardRes.status).toBe(423) // not yet published
    const reviewRes = await authed(`/api/quizzes/${quizId}/review`, participantCookie)
    expect(reviewRes.status).toBe(423)
    const outsiderLeaderboardRes = await authed(`/api/quizzes/${quizId}/leaderboard`, outsiderCookie)
    expect(outsiderLeaderboardRes.status).toBe(403) // non-participant, still gated even once ready

    const cacheRaw = await env.CACHE.get("unit:" + quizId + ":1")

    const artifact = normalizeVolatile({ join: joinBody, current: currentBody, submit: submitBody, status: statusBody })
    const combined = JSON.stringify({ ...(artifact as object), unitCache: normalizeVolatile(JSON.parse(cacheRaw ?? "null")) }, null, 2)
    for (const key of LEAKY_KEYS) expect(combined).not.toContain(key)
    expect(combined).not.toContain("Set-Cookie")
    expect(combined).not.toContain("quizzer_session=")
    await expect(combined).toMatchFileSnapshot("./artifacts/unpublished-runtime-http.json")

    // Publish the board, then confirm review unlocks only for the participant, never the outsider.
    await env.DB.prepare("UPDATE quizzes SET status = 'ended', board_computed_at = ?, ended_at = ? WHERE id = ?").bind(Date.now(), Date.now(), quizId).run()
    await env.DB.prepare("UPDATE participants SET rank = 1, finished_at = ? WHERE quiz_id = ?").bind(Date.now(), quizId).run()

    const postReviewRes = await authed(`/api/quizzes/${quizId}/review`, participantCookie)
    expect(postReviewRes.status).toBe(200)
    const postReviewBody = await postReviewRes.clone().text()
    expect(postReviewBody).toContain("correctOption") // now correctly unlocked, post-publication, participant-only

    const outsiderReviewRes = await authed(`/api/quizzes/${quizId}/review`, outsiderCookie)
    expect(outsiderReviewRes.status).toBe(403)
  })
})
