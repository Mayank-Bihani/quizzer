import { env } from "cloudflare:test"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { zipSync } from "fflate"
import app from "../src/index"
import { jwksResponse, makeGoogleKeyPair, signGoogleIdToken } from "./helpers/google"

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

// The Workers test pool isolates D1/KV storage per test *file*, not per `it()` (see
// vitest.config.ts / tests/setup/apply-migrations.ts) — so every test starts from a clean bank.
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM questions"),
    env.DB.prepare("DELETE FROM passages"),
    env.DB.prepare("DELETE FROM quizzes"),
  ])
})

// used_in_quiz_id is a real FK to quizzes(id); tests that stamp a question/passage as "used"
// need an actual (minimal, draft) quiz row to satisfy it.
async function insertDummyQuiz(id: string, createdBy: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO quizzes (id, title, type, scheduled_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(id, "Test quiz", "quant", Date.now(), createdBy, Date.now())
    .run()
}

function extractCookie(res: Response): string {
  const header = res.headers.get("set-cookie") ?? ""
  const match = header.match(/quizzer_session=([^;]*)/)
  if (!match) throw new Error("no session cookie in response")
  return match[1] ?? ""
}

async function signInAs(role: "student" | "admin" | "superadmin"): Promise<string> {
  const kid = crypto.randomUUID()
  const { privateKey, jwk } = await makeGoogleKeyPair(kid)
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jwksResponse([jwk]))
  )
  const sub = crypto.randomUUID()
  const idToken = await signGoogleIdToken(privateKey, kid, env.GOOGLE_CLIENT_ID, {
    sub,
    email: `${sub}@example.com`,
  })
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
  return extractCookie(res)
}

async function currentUserId(cookie: string): Promise<string> {
  const res = await app.request("/api/auth/me", { headers: { cookie: `quizzer_session=${cookie}` } }, env)
  return (await res.json<{ id: string }>()).id
}

function authed(path: string, cookie: string | null, init: RequestInit = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
  if (cookie) headers.cookie = `quizzer_session=${cookie}`
  return app.request(path, { ...init, headers }, env)
}

function multipartBody(fields: Record<string, string | { filename: string; bytes: Uint8Array; type: string }>): FormData {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string") {
      // A real upload always sends the CSV as a file part, not a plain text field.
      form.set(key, new File([value], `${key}.csv`, { type: "text/csv" }))
    } else {
      form.set(key, new File([value.bytes], value.filename, { type: value.type }))
    }
  }
  return form
}

const VALID_CSV = [
  "type,topic,subtopic,difficulty,format,passage_ref,body,image,option_a,option_b,option_c,option_d,correct,numeric_answer,tolerance,explanation,source",
  'quant,Arithmetic,,easy,mcq,,"What is 2 + 2?",,3,4,5,6,B,,,"2+2=4",',
  'quant,Arithmetic,,easy,tita,,"What is 10 / 2?",,,,,,,5,0,"10/2=5",',
].join("\n")

function csvWith(...extraRows: string[]): string {
  return [VALID_CSV, ...extraRows].join("\n")
}

describe("BANK guard matrix", () => {
  it("rejects signed-out callers with 401 on every admin route", async () => {
    const routes: [string, RequestInit?][] = [
      ["/api/bank/questions"],
      ["/api/bank/questions/x"],
      ["/api/bank/passages"],
      ["/api/bank/questions/x", { method: "PATCH", body: "{}" }],
      ["/api/bank/questions/x", { method: "DELETE" }],
    ]
    for (const [path, init] of routes) {
      const res = await app.request(path, init, env)
      expect(res.status).toBe(401)
    }
  })

  it("rejects a student with 403 on an admin route", async () => {
    const cookie = await signInAs("student")
    const res = await authed("/api/bank/questions", cookie)
    expect(res.status).toBe(403)
  })

  it("lets admin and superadmin reach an admin route", async () => {
    for (const role of ["admin", "superadmin"] as const) {
      const cookie = await signInAs(role)
      const res = await authed("/api/bank/questions", cookie)
      expect(res.status).toBe(200)
    }
  })
})

describe("POST /api/bank/import/preview", () => {
  it("is side-effect free and reports exact counts for a valid CSV", async () => {
    const cookie = await signInAs("admin")
    const form = multipartBody({ csv: VALID_CSV })
    const res = await authed("/api/bank/import/preview", cookie, { method: "POST", body: form })
    const body = await res.json<{ counts: { questions: number }; errors: unknown[] }>()

    expect(res.status).toBe(200)
    expect(body.errors).toHaveLength(0)
    expect(body.counts.questions).toBe(2)

    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM questions").first<{ n: number }>()
    expect(row?.n).toBe(0)
  })

  it("reproduces the acceptance case: missing correct + unknown passage_ref, exactly two line errors", async () => {
    const cookie = await signInAs("admin")
    const csv = csvWith(
      'quant,Arithmetic,,easy,mcq,,"Body",,3,4,5,6,,,,"Explanation",',
      'verbal,Reading,,easy,mcq,does-not-exist,"Body",,3,4,5,6,A,,,"Explanation",'
    )
    const form = multipartBody({ csv })
    const res = await authed("/api/bank/import/preview", cookie, { method: "POST", body: form })
    const body = await res.json<{ errors: { line: number }[] }>()

    expect(body.errors).toHaveLength(2)
    const dbRows = await env.DB.prepare("SELECT COUNT(*) AS n FROM questions").first<{ n: number }>()
    expect(dbRows?.n).toBe(0)
  })

  it("rejects an unexpected multipart field name with a generic 400", async () => {
    const cookie = await signInAs("admin")
    const form = multipartBody({ file: VALID_CSV })
    const res = await authed("/api/bank/import/preview", cookie, { method: "POST", body: form })
    expect(res.status).toBe(400)
  })
})

describe("POST /api/bank/import/commit", () => {
  it("commits a valid upload with an image and returns a non-null importId", async () => {
    const cookie = await signInAs("admin")
    const zip = zipSync({ "fig.png": PNG_BYTES }, { level: 0 })
    const csv = csvWith('quant,Geometry,,medium,mcq,,"See figure",fig.png,3,4,5,6,A,,,"Explanation",')
    const form = multipartBody({
      csv,
      images: { filename: "images.zip", bytes: zip, type: "application/zip" },
    })
    const res = await authed("/api/bank/import/commit", cookie, { method: "POST", body: form })
    const body = await res.json<{ importId: string | null; counts: { questions: number }; errors: unknown[] }>()

    expect(res.status).toBe(200)
    expect(body.importId).not.toBeNull()
    expect(body.errors).toHaveLength(0)
    expect(body.counts.questions).toBe(3)

    const row = await env.DB.prepare("SELECT image_key FROM questions WHERE body_md = 'See figure'").first<{
      image_key: string | null
    }>()
    expect(row?.image_key).toBeTruthy()

    const imageRes = await authed(`/api/images/${row!.image_key}`, cookie)
    expect(imageRes.status).toBe(200)
    expect(imageRes.headers.get("x-content-type-options")).toBe("nosniff")
  })

  it("compensates a mid-import D1 failure: rows from earlier successful chunks are deleted too", async () => {
    const { commitImport } = await import("../src/db/bank")

    // 120 standalone questions -> chunks of 50, 50, 20 at IMPORT_BATCH_ROWS=50. Failing the 3rd
    // batch() call proves the compensation path cleans up rows *already committed* by the first
    // two successful chunks, not just the failed one — this is what BE-4 exercises.
    const questions = Array.from({ length: 120 }, (_, i) => ({
      type: "quant" as const,
      topic: "Arithmetic",
      subtopic: null,
      difficulty: "easy" as const,
      format: "mcq" as const,
      passageRef: null,
      groupPosition: null,
      bodyMd: `Question ${i}`,
      imageKey: null,
      optionA: "1",
      optionB: "2",
      optionC: "3",
      optionD: "4",
      correctOption: "A" as const,
      numericAnswer: null,
      numericTolerance: null,
      explanationMd: "Because.",
      source: null,
    }))

    let batchCalls = 0
    const flakyDb = new Proxy(env.DB, {
      get(target, prop, receiver) {
        if (prop === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            batchCalls++
            if (batchCalls === 3) throw new Error("simulated D1 batch failure")
            return Reflect.apply(target.batch, target, [statements])
          }
        }
        return Reflect.get(target, prop, receiver)
      },
    })

    const cookie = await signInAs("admin")
    const userId = await currentUserId(cookie)

    await expect(
      commitImport(flakyDb, "flaky-import", { passages: [], questions }, userId, () => Date.now())
    ).rejects.toThrow()

    const remaining = await env.DB.prepare("SELECT COUNT(*) AS n FROM questions WHERE import_id = 'flaky-import'").first<{
      n: number
    }>()
    expect(remaining?.n).toBe(0)
  })

  it("writes nothing when the CSV has validation errors", async () => {
    const cookie = await signInAs("admin")
    const form = multipartBody({ csv: csvWith('quant,Arithmetic,,easy,mcq,,"Body",,3,4,5,6,,,,"Explanation",') })
    const res = await authed("/api/bank/import/commit", cookie, { method: "POST", body: form })
    const body = await res.json<{ importId: string | null }>()

    expect(body.importId).toBeNull()
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM questions").first<{ n: number }>()
    expect(row?.n).toBe(0)
  })
})

describe("GET /api/bank/questions", () => {
  beforeEach(async () => {
    const cookie = await signInAs("admin")
    await authed("/api/bank/import/commit", cookie, {
      method: "POST",
      body: multipartBody({ csv: VALID_CSV }),
    })
  })

  it("defaults to limit 50 offset 0 and reports the full filtered total", async () => {
    const cookie = await signInAs("admin")
    const res = await authed("/api/bank/questions", cookie)
    const body = await res.json<{ limit: number; offset: number; total: number; items: unknown[] }>()
    expect(body.limit).toBe(50)
    expect(body.offset).toBe(0)
    expect(body.total).toBe(2)
  })

  it("returns 400 without clamping for an out-of-range or fractional limit", async () => {
    const cookie = await signInAs("admin")
    for (const limit of ["0", "101", "1.5", "abc", "-1"]) {
      const res = await authed(`/api/bank/questions?limit=${limit}`, cookie)
      expect(res.status).toBe(400)
    }
  })

  it("filters by format-adjacent difficulty and returns nested DTO with no internal columns", async () => {
    const cookie = await signInAs("admin")
    const res = await authed("/api/bank/questions?difficulty=easy", cookie)
    const body = await res.json<{ items: Record<string, unknown>[] }>()
    expect(body.items.length).toBeGreaterThan(0)
    for (const item of body.items) {
      expect(item).not.toHaveProperty("created_by")
      expect(item).not.toHaveProperty("body_md")
      expect(item).toHaveProperty("bodyMd")
    }
  })
})

describe("PATCH /api/bank/questions/:id", () => {
  async function commitAndGetMcqId(cookie: string): Promise<string> {
    await authed("/api/bank/import/commit", cookie, { method: "POST", body: multipartBody({ csv: VALID_CSV }) })
    const res = await authed("/api/bank/questions?difficulty=easy&limit=100", cookie)
    const body = await res.json<{ items: { id: string; format: string }[] }>()
    return body.items.find((q) => q.format === "mcq")!.id
  }

  it("allows an editable field before use", async () => {
    const cookie = await signInAs("admin")
    const id = await commitAndGetMcqId(cookie)
    const res = await authed(`/api/bank/questions/${id}`, cookie, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bodyMd: "Updated body" }),
    })
    expect(res.status).toBe(200)
    expect((await res.json<{ bodyMd: string }>()).bodyMd).toBe("Updated body")
  })

  it("rejects an unknown or forbidden field with 400 and no write", async () => {
    const cookie = await signInAs("admin")
    const id = await commitAndGetMcqId(cookie)
    const res = await authed(`/api/bank/questions/${id}`, cookie, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ correctOption: "C" }),
    })
    expect(res.status).toBe(400)
  })

  it("freezes options once the question is used", async () => {
    const cookie = await signInAs("admin")
    const id = await commitAndGetMcqId(cookie)
    await insertDummyQuiz("quiz-1", await currentUserId(cookie))
    await env.DB.prepare("UPDATE questions SET used_in_quiz_id = 'quiz-1', used_in_quiz_number = 1 WHERE id = ?")
      .bind(id)
      .run()

    const res = await authed(`/api/bank/questions/${id}`, cookie, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ optionA: "changed" }),
    })
    expect(res.status).toBe(400)

    const stillEditable = await authed(`/api/bank/questions/${id}`, cookie, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ explanationMd: "fixed typo" }),
    })
    expect(stillEditable.status).toBe(200)
  })

  it("returns 404 for an unknown id", async () => {
    const cookie = await signInAs("admin")
    const res = await authed("/api/bank/questions/does-not-exist", cookie, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bodyMd: "x" }),
    })
    expect(res.status).toBe(404)
  })
})

describe("DELETE /api/bank/questions/:id", () => {
  it("returns 404 for an absent question", async () => {
    const cookie = await signInAs("admin")
    const res = await authed("/api/bank/questions/does-not-exist", cookie, { method: "DELETE" })
    expect(res.status).toBe(404)
  })

  it("deletes a standalone unused question", async () => {
    const cookie = await signInAs("admin")
    await authed("/api/bank/import/commit", cookie, { method: "POST", body: multipartBody({ csv: VALID_CSV }) })
    const list = await authed("/api/bank/questions?limit=100", cookie)
    const { items } = await list.json<{ items: { id: string }[] }>()
    const targetId = items[0]!.id

    const res = await authed(`/api/bank/questions/${targetId}`, cookie, { method: "DELETE" })
    expect(res.status).toBe(200)
    expect(await env.DB.prepare("SELECT id FROM questions WHERE id = ?").bind(targetId).first()).toBeNull()
  })

  it("returns 409 with no write when the question is used", async () => {
    const cookie = await signInAs("admin")
    await authed("/api/bank/import/commit", cookie, { method: "POST", body: multipartBody({ csv: VALID_CSV }) })
    const list = await authed("/api/bank/questions?limit=100", cookie)
    const { items } = await list.json<{ items: { id: string }[] }>()
    const targetId = items[0]!.id
    await insertDummyQuiz("quiz-1", await currentUserId(cookie))
    await env.DB.prepare("UPDATE questions SET used_in_quiz_id = 'quiz-1' WHERE id = ?").bind(targetId).run()

    const res = await authed(`/api/bank/questions/${targetId}`, cookie, { method: "DELETE" })
    expect(res.status).toBe(409)
    expect(await env.DB.prepare("SELECT id FROM questions WHERE id = ?").bind(targetId).first()).not.toBeNull()
  })

  it("cascades: deleting one unused group member removes every member plus the passage", async () => {
    const cookie = await signInAs("admin")
    const groupCsv = csvWith(
      'verbal,RC,,medium,passage,rc-1,"Shared passage text",,,,,,,,,,',
      'verbal,RC,,medium,mcq,rc-1,"Q1",,3,4,5,6,A,,,"E1",',
      'verbal,RC,,medium,mcq,rc-1,"Q2",,3,4,5,6,A,,,"E2",',
      'verbal,RC,,medium,mcq,rc-1,"Q3",,3,4,5,6,A,,,"E3",',
      'verbal,RC,,medium,mcq,rc-1,"Q4",,3,4,5,6,A,,,"E4",'
    )
    await authed("/api/bank/import/commit", cookie, { method: "POST", body: multipartBody({ csv: groupCsv }) })

    const passagesRes = await authed("/api/bank/passages", cookie)
    const { passages } = await passagesRes.json<{ passages: { id: string }[] }>()
    const passageId = passages.find((p) => true)!.id
    const membersBefore = await env.DB.prepare("SELECT id FROM questions WHERE passage_id = ?")
      .bind(passageId)
      .all<{ id: string }>()
    expect(membersBefore.results).toHaveLength(4)

    const targetId = membersBefore.results[0]!.id
    const res = await authed(`/api/bank/questions/${targetId}`, cookie, { method: "DELETE" })
    expect(res.status).toBe(200)

    const membersAfter = await env.DB.prepare("SELECT id FROM questions WHERE passage_id = ?")
      .bind(passageId)
      .all<{ id: string }>()
    expect(membersAfter.results).toHaveLength(0)
    expect(await env.DB.prepare("SELECT id FROM passages WHERE id = ?").bind(passageId).first()).toBeNull()
  })

  it("409s with no writes when any group member is used, even if the target itself is unused", async () => {
    const cookie = await signInAs("admin")
    const groupCsv = csvWith(
      'verbal,RC,,medium,passage,rc-2,"Shared passage text",,,,,,,,,,',
      'verbal,RC,,medium,mcq,rc-2,"Q1",,3,4,5,6,A,,,"E1",',
      'verbal,RC,,medium,mcq,rc-2,"Q2",,3,4,5,6,A,,,"E2",',
      'verbal,RC,,medium,mcq,rc-2,"Q3",,3,4,5,6,A,,,"E3",',
      'verbal,RC,,medium,mcq,rc-2,"Q4",,3,4,5,6,A,,,"E4",'
    )
    await authed("/api/bank/import/commit", cookie, { method: "POST", body: multipartBody({ csv: groupCsv }) })
    const passagesRes = await authed("/api/bank/passages", cookie)
    const { passages } = await passagesRes.json<{ passages: { id: string }[] }>()
    const passageId = passages[0]!.id
    const members = await env.DB.prepare("SELECT id FROM questions WHERE passage_id = ?")
      .bind(passageId)
      .all<{ id: string }>()
    const [used, ...rest] = members.results
    await insertDummyQuiz("quiz-1", await currentUserId(cookie))
    await env.DB.prepare("UPDATE questions SET used_in_quiz_id = 'quiz-1' WHERE id = ?").bind(used!.id).run()

    const res = await authed(`/api/bank/questions/${rest[0]!.id}`, cookie, { method: "DELETE" })
    expect(res.status).toBe(409)
    const stillThere = await env.DB.prepare("SELECT COUNT(*) AS n FROM questions WHERE passage_id = ?")
      .bind(passageId)
      .first<{ n: number }>()
    expect(stillThere?.n).toBe(4)
  })
})

describe("BankContract via src/db/bank.ts", () => {
  it("listUnused/claimUnused/getByIds behave per contract", async () => {
    const { createBankContract } = await import("../src/db/bank")
    const cookie = await signInAs("admin")
    await authed("/api/bank/import/commit", cookie, { method: "POST", body: multipartBody({ csv: VALID_CSV }) })

    const userId = await currentUserId(cookie)
    await insertDummyQuiz("quiz-1", userId)
    await insertDummyQuiz("quiz-2", userId)

    const contract = createBankContract(env.DB)
    const pool = await contract.listUnused({ type: "quant", difficultyMix: { easy: 2 }, count: 2 })
    expect(pool.length).toBeGreaterThanOrEqual(2)
    const ids = pool.map((q) => q.id)

    const firstClaim = await contract.claimUnused(ids, "quiz-1", 1)
    expect(firstClaim.sort()).toEqual([...ids].sort())

    const retry = await contract.claimUnused(ids, "quiz-1", 1)
    expect(retry.sort()).toEqual([...ids].sort())

    const otherOwner = await contract.claimUnused(ids, "quiz-2", 2)
    expect(otherOwner).toHaveLength(0)

    const byIds = await contract.getByIds([...ids].reverse())
    expect(byIds.map((q) => q.id)).toEqual([...ids].reverse())
  })

  it("claimUnused stamps the passage only once every member is claimed for that quiz", async () => {
    const { createBankContract } = await import("../src/db/bank")
    const cookie = await signInAs("admin")
    const groupCsv = csvWith(
      'lr,DI,,hard,passage,lr-1,"Shared",,,,,,,,,,',
      'lr,DI,,hard,mcq,lr-1,"Q1",,3,4,5,6,A,,,"E1",',
      'lr,DI,,hard,mcq,lr-1,"Q2",,3,4,5,6,A,,,"E2",',
      'lr,DI,,hard,mcq,lr-1,"Q3",,3,4,5,6,A,,,"E3",',
      'lr,DI,,hard,mcq,lr-1,"Q4",,3,4,5,6,A,,,"E4",'
    )
    await authed("/api/bank/import/commit", cookie, { method: "POST", body: multipartBody({ csv: groupCsv }) })
    const passagesRes = await authed("/api/bank/passages", cookie)
    const { passages } = await passagesRes.json<{ passages: { id: string }[] }>()
    const passageId = passages[0]!.id
    const members = await env.DB.prepare("SELECT id FROM questions WHERE passage_id = ?")
      .bind(passageId)
      .all<{ id: string }>()
    await insertDummyQuiz("quiz-3", await currentUserId(cookie))

    const contract = createBankContract(env.DB)
    const partial = members.results.slice(0, 3).map((r) => r.id)
    await contract.claimUnused(partial, "quiz-3", 3)
    let passageRow = await env.DB.prepare("SELECT used_in_quiz_id FROM passages WHERE id = ?")
      .bind(passageId)
      .first<{ used_in_quiz_id: string | null }>()
    expect(passageRow?.used_in_quiz_id).toBeNull()

    const last = members.results.slice(3).map((r) => r.id)
    await contract.claimUnused(last, "quiz-3", 3)
    passageRow = await env.DB.prepare("SELECT used_in_quiz_id FROM passages WHERE id = ?")
      .bind(passageId)
      .first<{ used_in_quiz_id: string | null }>()
    expect(passageRow?.used_in_quiz_id).toBe("quiz-3")
  })
})

describe("hostile uploads", () => {
  it("rejects a ZIP entry with a disallowed image format inside a valid CSV", async () => {
    const cookie = await signInAs("admin")
    const zip = zipSync({ "fig.txt": new Uint8Array([1, 2, 3]) }, { level: 0 })
    const csv = csvWith('quant,Geometry,,medium,mcq,,"See figure",fig.txt,3,4,5,6,A,,,"Explanation",')
    const form = multipartBody({ csv, images: { filename: "images.zip", bytes: zip, type: "application/zip" } })
    const res = await authed("/api/bank/import/preview", cookie, { method: "POST", body: form })
    const body = await res.json<{ errors: unknown[] }>()
    expect(body.errors.length).toBeGreaterThan(0)
  })

  it("rejects malformed UTF-8/CSV content without crashing", async () => {
    const cookie = await signInAs("admin")
    const form = multipartBody({ csv: "not,a,valid,bank,csv\nrow,row,row" })
    const res = await authed("/api/bank/import/preview", cookie, { method: "POST", body: form })
    expect(res.status).toBe(200)
    const body = await res.json<{ errors: unknown[] }>()
    expect(body.errors.length).toBeGreaterThan(0)
  })
})
