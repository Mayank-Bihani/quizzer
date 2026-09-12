// AC-14: an API-driven, cross-module backend launch journey — CSV import through admin report —
// run against an isolated migrated D1/KV with fake Google (JWKS-stubbed), fake Telegram (stubbed
// fetch), and fake email (a recording SendEmail stand-in) edges. Real delivery to real providers is
// AC-OPERATOR's job, never this automated suite's. Tests run in file order; later `it`s depend on
// state built by earlier ones — this is a deliberate sequential journey, not independent cases.

import { env } from "cloudflare:test"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { zipSync } from "fflate"
import app from "../../src/index"
import { closeQuizTransaction } from "../../src/db/results"
import { WEEKLY_RETRY_LOOKBACK_WEEKS } from "../../src/core/config"
import { mostRecentlyElapsedWeekStart, weekBoundsForWeekStart } from "../../src/core/schedule"
import { jwksResponse, makeGoogleKeyPair, signGoogleIdToken } from "../helpers/google"

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

function multipartBody(fields: Record<string, string | { filename: string; bytes: Uint8Array; type: string }>): FormData {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string") form.set(key, new File([value], `${key}.csv`, { type: "text/csv" }))
    else form.set(key, new File([value.bytes], value.filename, { type: value.type }))
  }
  return form
}

// Shared state threaded through the sequential journey below.
let adminCookie: string
let adminId: string
let importedQuestionIds: string[] = []
let quizId: string
let roomCode: string
let studentA: { cookie: string; id: string }
let studentB: { cookie: string; id: string }
let studentC: { cookie: string; id: string }

beforeAll(async () => {
  for (const table of [
    "telegram_posts",
    "weekly_boards",
    "answers",
    "participant_units",
    "participants",
    "quiz_seats",
    "quiz_questions",
    "quiz_units",
    "quiz_templates",
    "questions",
    "passages",
    "quizzes",
    "users",
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run()
  }
})

describe("AC-14: API-driven backend launch journey", () => {
  it("imports bank content via CSV preview then commit", async () => {
    const signedIn = await signInAs("admin")
    adminCookie = signedIn.cookie
    adminId = signedIn.id

    const csv = [
      "type,topic,subtopic,difficulty,format,passage_ref,body,image,option_a,option_b,option_c,option_d,correct,numeric_answer,tolerance,explanation,source",
      'quant,Arithmetic,,easy,mcq,,"Launch Q1",,3,4,5,6,A,,,"Explanation 1",',
      'quant,Arithmetic,,easy,mcq,,"Launch Q2",,3,4,5,6,B,,,"Explanation 2",',
      'quant,Arithmetic,,easy,mcq,,"Launch Q3",,3,4,5,6,A,,,"Explanation 3",',
      'quant,Arithmetic,,easy,mcq,,"Launch Q4",,3,4,5,6,B,,,"Explanation 4",',
    ].join("\n")

    const previewRes = await authed("/api/bank/import/preview", adminCookie, { method: "POST", body: multipartBody({ csv }) })
    expect(previewRes.status).toBe(200)
    const preview = await previewRes.json<{ counts: { questions: number }; errors: unknown[] }>()
    expect(preview.errors).toEqual([])
    expect(preview.counts.questions).toBe(4)

    const commitRes = await authed("/api/bank/import/commit", adminCookie, { method: "POST", body: multipartBody({ csv }) })
    expect(commitRes.status).toBe(200)
    const commit = await commitRes.json<{ importId: string | null; counts: { questions: number } }>()
    expect(commit.importId).not.toBeNull()
    expect(commit.counts.questions).toBe(4)

    const { results } = await env.DB.prepare("SELECT id FROM questions ORDER BY created_at ASC").all<{ id: string }>()
    importedQuestionIds = results.map((r) => r.id)
    expect(importedQuestionIds).toHaveLength(4)
  })

  it("drafts, configures, and locks a mixed-count quiz using only imported content", async () => {
    // Already open for admission by creation time — the several real signups/imports/DB round
    // trips this journey performs before actually joining easily exceed a small positive offset.
    const scheduledAt = Date.now() - 2000
    const createRes = await authed("/api/admin/quizzes", adminCookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Launch Journey Quiz", scheduledAt, type: "quant", difficultyMix: { easy: 2 }, count: 2 }),
    })
    expect(createRes.status).toBe(200)
    const draft = await createRes.json<{ quizId: string }>()
    quizId = draft.quizId

    const patchRes = await authed(`/api/admin/quizzes/${quizId}`, adminCookie, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timingPolicy: { standalone: 60 }, joinWindowSec: 600, slackSec: 0, marksCorrect: 4, marksWrong: -1 }),
    })
    expect(patchRes.status).toBe(200)

    const lockRes = await authed(`/api/admin/quizzes/${quizId}/lock`, adminCookie, { method: "POST" })
    expect(lockRes.status).toBe(200)
    const lockBody = await lockRes.json<{ locked: boolean; roomCode?: string }>()
    expect(lockBody.locked).toBe(true)

    const row = await env.DB.prepare("SELECT room_code, status FROM quizzes WHERE id = ?").bind(quizId).first<{ room_code: string; status: string }>()
    expect(row?.status).toBe("scheduled")
    roomCode = row?.room_code as string
    expect(roomCode).toBeTruthy()

    // Content was claimed from BANK, never left over for a later draw.
    const claimed = await env.DB.prepare("SELECT COUNT(*) AS n FROM questions WHERE used_in_quiz_id = ?").bind(quizId).first<{ n: number }>()
    expect(claimed?.n).toBe(2)
  })

  it("prepares the room and fires due Telegram posts on the minute tick, unattended", async () => {
    const fakeAlertEmail = { send: vi.fn(async () => undefined) }
    const customEnv = {
      ...env,
      TELEGRAM_ENABLED: "true",
      TELEGRAM_BOT_TOKEN: "fake-bot-token",
      TELEGRAM_CHAT_ID: "student-chat",
      TELEGRAM_ALERT_CHAT_ID: "alert-chat",
      EMAIL_ALERT_ADDRESS: "alerts@example.com",
      ALERT_EMAIL: fakeAlertEmail as unknown as SendEmail,
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    )
    await expect(
      app.scheduled({ cron: "* * * * *", scheduledTime: Date.now(), noRetry: () => undefined }, customEnv)
    ).resolves.not.toThrow()
    vi.unstubAllGlobals()

    const row = await env.DB.prepare("SELECT status FROM quizzes WHERE id = ?").bind(quizId).first<{ status: string }>()
    expect(row?.status).toBe("open")
  })

  it("runs three authenticated participants through skip, timeout, and a changed-retry rejection", async () => {
    studentA = await signInAs("student")
    studentB = await signInAs("student")
    studentC = await signInAs("student")

    for (const student of [studentA, studentB, studentC]) {
      const res = await authed(`/api/quizzes/${roomCode}/join`, student.cookie, { method: "POST" })
      expect(res.status).toBe(200)
    }

    // Student A: answers unit 1, explicitly skips unit 2.
    const submitA1 = await authed(`/api/play/${quizId}/units/1/submit`, studentA.cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submissionId: "a-1", reason: "complete", answers: [{ position: 1, status: "answered", format: "mcq", chosenOption: "A" }] }),
    })
    expect(submitA1.status).toBe(200)
    const submitA2 = await authed(`/api/play/${quizId}/units/2/submit`, studentA.cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submissionId: "a-2", reason: "complete", answers: [{ position: 2, status: "skipped" }] }),
    })
    expect(submitA2.status).toBe(200)

    // Student B: unit 1's server-only expiry — never submits; deadline/receipt window is force-
    // aged into the past (join already fixed the real deadline/submitByAt at real wall-clock time,
    // so this is the same server-only-expiry condition QUIZZING.md documents, just time-shifted
    // to avoid a real 65-second wait), then `current` settles it on read exactly like production.
    // started_at itself must also move back — the CHECK constraint requires deadline_at >=
    // started_at, and started_at was only just set at real join time, too close to "now" for any
    // deadline_at satisfying that constraint to also already be more than 5000ms in the past.
    const forcedStartedAt = Date.now() - 70_000
    const forcedDeadlineAt = forcedStartedAt + 60_000
    await env.DB.prepare(
      "UPDATE participant_units SET started_at = ?, deadline_at = ?, submit_by_at = ? WHERE quiz_id = ? AND user_id = ? AND unit_position = 1"
    )
      .bind(forcedStartedAt, forcedDeadlineAt, forcedDeadlineAt + 5000, quizId, studentB.id)
      .run()
    const currentB = await authed(`/api/play/${quizId}/current`, studentB.cookie)
    expect(currentB.status).toBe(200)
    const unitB1 = await env.DB.prepare(
      "SELECT close_reason FROM participant_units WHERE quiz_id = ? AND user_id = ? AND unit_position = 1"
    )
      .bind(quizId, studentB.id)
      .first<{ close_reason: string }>()
    expect(unitB1?.close_reason).toBe("timed_out")
    // Student B still has unit 2 open — submit it normally so B finishes like the others.
    const submitB2 = await authed(`/api/play/${quizId}/units/2/submit`, studentB.cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submissionId: "b-2", reason: "complete", answers: [{ position: 2, status: "answered", format: "mcq", chosenOption: "B" }] }),
    })
    expect(submitB2.status).toBe(200)

    // Student C: submits unit 1, then a changed-payload retry under the same key is rejected, then
    // the original, unchanged retry is still honored (idempotent) before finishing normally.
    const submitC1 = await authed(`/api/play/${quizId}/units/1/submit`, studentC.cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submissionId: "c-1", reason: "complete", answers: [{ position: 1, status: "answered", format: "mcq", chosenOption: "A" }] }),
    })
    expect(submitC1.status).toBe(200)
    const changedRetry = await authed(`/api/play/${quizId}/units/1/submit`, studentC.cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submissionId: "c-1", reason: "complete", answers: [{ position: 1, status: "answered", format: "mcq", chosenOption: "B" }] }),
    })
    expect(changedRetry.status).toBe(409)
    const sameRetry = await authed(`/api/play/${quizId}/units/1/submit`, studentC.cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submissionId: "c-1", reason: "complete", answers: [{ position: 1, status: "answered", format: "mcq", chosenOption: "A" }] }),
    })
    expect(sameRetry.status).toBe(200)
    const submitC2 = await authed(`/api/play/${quizId}/units/2/submit`, studentC.cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submissionId: "c-2", reason: "complete", answers: [{ position: 2, status: "answered", format: "mcq", chosenOption: "A" }] }),
    })
    expect(submitC2.status).toBe(200)

    const finishedCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM participants WHERE quiz_id = ? AND finished_at IS NOT NULL")
      .bind(quizId)
      .first<{ n: number }>()
    expect(finishedCount?.n).toBe(3)
  })

  it("crosses safe close and unlocks results atomically", async () => {
    const outcome = await closeQuizTransaction(env.DB, quizId, Date.now() + 2_000_000)
    expect(outcome.kind).toBe("ok")

    const leaderboardRes = await authed(`/api/quizzes/${quizId}/leaderboard`, studentA.cookie)
    expect(leaderboardRes.status).toBe(200)
    const reviewRes = await authed(`/api/quizzes/${quizId}/review`, studentA.cookie)
    expect(reviewRes.status).toBe(200)
  })

  it("computes and publishes the weekly board for the quiz's IST week", async () => {
    // The hourly cron's weekly-retry sweep only ever looks backward from "now" (WEEKLY_RETRY_LOOKBACK_WEEKS
    // candidates anchored at today's most-recently-elapsed week) — this must be candidate #0 of
    // that same sweep, not an arbitrary future week the sweep would never actually reach.
    const targetWeekStart = mostRecentlyElapsedWeekStart(Date.now())
    // Re-point the quiz's scheduled_at into that target week so it's the one board this test can
    // deterministically observe as "ready" (status is already 'ended' from the prior step).
    const { startMs } = weekBoundsForWeekStart(targetWeekStart)
    const newScheduledAt = startMs + 60_000
    const row = await env.DB.prepare("SELECT join_window_sec FROM quizzes WHERE id = ?").bind(quizId).first<{ join_window_sec: number }>()
    const joinWindowSec = row?.join_window_sec ?? 600
    await env.DB.prepare("UPDATE quizzes SET scheduled_at = ?, lobby_opens_at = ?, ends_at = ? WHERE id = ?")
      .bind(newScheduledAt, newScheduledAt - 300_000, newScheduledAt + joinWindowSec * 1000, quizId)
      .run()

    const customEnv = { ...env }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    )
    await expect(app.scheduled({ cron: "0 * * * *", scheduledTime: Date.now(), noRetry: () => undefined }, customEnv)).resolves.not.toThrow()
    vi.unstubAllGlobals()

    const published = await env.DB.prepare("SELECT COUNT(*) AS n FROM weekly_boards WHERE week_start = ?").bind(targetWeekStart).first<{ n: number }>()
    expect(published?.n).toBeGreaterThan(0)
  })

  it("materializes recurring templates, isolating a pool-exhausted and a missing-timing occurrence from a healthy sibling", async () => {
    // Three templates sharing the pool state below: one has an achievable draw and complete
    // timing (healthy), one asks for more than the remaining pool can supply (pool_exhausted),
    // and one has no timing_policy entry for the unit kind it draws (missing_timing_configuration).
    const healthyQ1 = crypto.randomUUID()
    const healthyQ2 = crypto.randomUUID()
    for (const [id, seq] of [[healthyQ1, 101], [healthyQ2, 102]] as const) {
      await env.DB.prepare(
        `INSERT INTO questions (id, type, topic, difficulty, format, body_md, option_a, option_b, option_c, option_d, correct_option, explanation_md, created_by, created_at)
         VALUES (?, 'quant', 'Topic', 'easy', 'mcq', ?, 'A', 'B', 'C', 'D', 'A', 'Explanation', ?, ?)`
      )
        .bind(id, `Materialize Body ${seq}`, adminId, Date.now())
        .run()
    }

    // A single BYDAY guarantees exactly one occurrence per template in any 7-day lookahead window,
    // regardless of what day "now" actually is — a full 7-day span always contains exactly one
    // instance of any given weekday.
    const rrule = "FREQ=WEEKLY;BYDAY=MO;BYHOUR=10;BYMINUTE=0"
    async function insertTemplate(name: string, questionCount: number, timingPolicy: Record<string, number>): Promise<void> {
      // quant's request lives in standalone_count (set_count is null) — src/core/selection.ts's
      // toStoredDrawRequest.
      await env.DB.prepare(
        `INSERT INTO quiz_templates (id, name, type, set_count, standalone_count, difficulty_mix, timing_policy, slack_sec, join_window_sec, marks_correct, marks_wrong, seat_cap, rrule, active, created_by)
         VALUES (?, ?, 'quant', NULL, ?, ?, ?, 30, 600, 4, -1, 120, ?, 1, ?)`
      )
        .bind(crypto.randomUUID(), name, questionCount, JSON.stringify({ easy: questionCount }), JSON.stringify(timingPolicy), rrule, adminId)
        .run()
    }
    await insertTemplate("Healthy template", 2, { standalone: 60 })
    await insertTemplate("Pool-exhausted template", 50, { standalone: 60 }) // far more than the 2 remaining questions
    await insertTemplate("Missing-timing template", 1, {}) // no 'standalone' entry

    const telegramCalls: string[] = []
    const emailCalls: unknown[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        telegramCalls.push(String(init?.body ?? ""))
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      })
    )
    const fakeAlertEmail = { send: vi.fn(async (msg: unknown) => void emailCalls.push(msg)) }
    const customEnv = {
      ...env,
      TELEGRAM_ENABLED: "true",
      TELEGRAM_BOT_TOKEN: "fake-bot-token",
      TELEGRAM_ALERT_CHAT_ID: "alert-chat",
      EMAIL_ALERT_ADDRESS: "alerts@example.com",
      ALERT_EMAIL: fakeAlertEmail as unknown as SendEmail,
    }
    await expect(
      app.scheduled({ cron: "0 * * * *", scheduledTime: Date.now(), noRetry: () => undefined }, customEnv)
    ).resolves.not.toThrow()
    vi.unstubAllGlobals()

    // The healthy template materialized; the other two failed in isolation with their exact codes.
    const materialized = await env.DB.prepare("SELECT COUNT(*) AS n FROM quizzes WHERE template_id IS NOT NULL AND status = 'scheduled'").first<{ n: number }>()
    expect(materialized?.n).toBe(1)

    // Both failure codes independently reached both alert channels (fake adapters, no real network).
    expect(telegramCalls.some((body) => body.includes("pool_exhausted"))).toBe(true)
    expect(telegramCalls.some((body) => body.includes("missing_timing_configuration"))).toBe(true)
    expect(emailCalls.length).toBeGreaterThanOrEqual(2)

    expect(WEEKLY_RETRY_LOOKBACK_WEEKS).toBe(8) // the accepted V1 lookback stays exactly 8 weeks
  })

  it("serves the admin report for the closed quiz", async () => {
    const res = await authed(`/api/admin/quizzes/${quizId}/report`, adminCookie)
    expect(res.status).toBe(200)
    const body = await res.json<{ participants: { total: number }; questions: unknown[]; units: unknown[] }>()
    expect(body.participants.total).toBe(3)
    expect(body.questions).toHaveLength(2)
    expect(body.units).toHaveLength(2)
  })
})
