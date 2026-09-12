import { env } from "cloudflare:test"
import { beforeEach, describe, expect, it } from "vitest"
import type { CreateTemplateRequest } from "../src/core/api"
import { materializeTemplates } from "../src/services/quiz-materializer"
import {
  createTemplate,
  deactivateTemplate,
  listTemplates,
  patchTemplate,
  type TemplateDeps,
} from "../src/services/templates"

let creatorId: string

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM quiz_questions"),
    env.DB.prepare("DELETE FROM quiz_units"),
    env.DB.prepare("DELETE FROM quizzes"),
    env.DB.prepare("DELETE FROM quiz_templates"),
    env.DB.prepare("DELETE FROM questions"),
    env.DB.prepare("DELETE FROM passages"),
    env.DB.prepare("DELETE FROM users"),
  ])
  creatorId = await insertAdmin()
})

async function insertAdmin(): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare("INSERT INTO users (id, google_sub, email, name, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)")
    .bind(id, crypto.randomUUID(), `${id}@example.com`, "Admin", Date.now())
    .run()
  return id
}

const NOW = Date.parse("2026-09-07T00:00:00.000Z")

function deps(): TemplateDeps {
  return { db: env.DB, now: () => NOW }
}

const VALID_QUANT_TEMPLATE: CreateTemplateRequest = {
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

describe("createTemplate", () => {
  it("creates a valid template and returns its summary", async () => {
    const result = await createTemplate(deps(), creatorId, VALID_QUANT_TEMPLATE)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.summary.name).toBe("Weekly Quant")
    expect(result.summary.active).toBe(true)
    expect(result.summary.timingPolicy).toEqual({ standalone: 60, lrdi: 180 })
  })

  it("accepts a difficultyMix that sums to less than questionCount, leaving the rest as any difficulty", async () => {
    const result = await createTemplate(deps(), creatorId, { ...VALID_QUANT_TEMPLATE, difficultyMix: { easy: 1 } })
    expect(result.kind).toBe("ok")
  })

  it("rejects a difficultyMix that sums to more than questionCount", async () => {
    const result = await createTemplate(deps(), creatorId, { ...VALID_QUANT_TEMPLATE, difficultyMix: { easy: 3 } })
    expect(result.kind).toBe("invalid")
  })

  it("accepts a timingPolicy that omits the type's implied group kind", async () => {
    const result = await createTemplate(deps(), creatorId, {
      ...VALID_QUANT_TEMPLATE,
      type: "verbal",
      setCount: 0, // all-standalone VA draw — never groups, so no rc timing entry is needed
      timingPolicy: { standalone: 60 }, // no rc — a draw that never groups verbal questions doesn't need one
    })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.summary.timingPolicy).toEqual({ standalone: 60 })
  })

  it("rejects a timingPolicy missing the always-required standalone kind", async () => {
    const result = await createTemplate(deps(), creatorId, {
      ...VALID_QUANT_TEMPLATE,
      timingPolicy: { lrdi: 180 }, // missing standalone
    })
    expect(result.kind).toBe("invalid")
  })

  it("rejects a timingPolicy carrying an extra unrelated unit kind", async () => {
    const result = await createTemplate(deps(), creatorId, {
      ...VALID_QUANT_TEMPLATE,
      timingPolicy: { standalone: 60, lrdi: 180, rc: 300 },
    })
    expect(result.kind).toBe("invalid")
  })

  it("rejects an invalid rrule", async () => {
    const result = await createTemplate(deps(), creatorId, { ...VALID_QUANT_TEMPLATE, rrule: "FREQ=DAILY" })
    expect(result.kind).toBe("invalid")
  })

  it("rejects non-positive marksWrong-violating and out-of-range seatCap", async () => {
    const badMarks = await createTemplate(deps(), creatorId, { ...VALID_QUANT_TEMPLATE, marksWrong: 1 })
    expect(badMarks.kind).toBe("invalid")
    const badSeatCap = await createTemplate(deps(), creatorId, { ...VALID_QUANT_TEMPLATE, seatCap: 200 })
    expect(badSeatCap.kind).toBe("invalid")
  })

  it("accepts an lr template with setCount only — lr is always whole sets, never a question count", async () => {
    const result = await createTemplate(deps(), creatorId, {
      name: "Weekly LRDI",
      type: "lr",
      setCount: 3,
      standaloneCount: null,
      difficultyMix: {},
      timingPolicy: { standalone: 60, lrdi: 180 },
      slackSec: 30,
      joinWindowSec: 600,
      marksCorrect: 4,
      marksWrong: -1,
      seatCap: 120,
      rrule: "FREQ=WEEKLY;BYDAY=TU;BYHOUR=18;BYMINUTE=0",
    })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.summary.setCount).toBe(3)
    expect(result.summary.standaloneCount).toBeNull()
  })

  it("rejects an lr template carrying a standaloneCount or a non-empty difficultyMix", async () => {
    const base = {
      name: "Weekly LRDI",
      type: "lr" as const,
      setCount: 3,
      timingPolicy: { standalone: 60, lrdi: 180 },
      slackSec: 30,
      joinWindowSec: 600,
      marksCorrect: 4,
      marksWrong: -1,
      seatCap: 120,
      rrule: "FREQ=WEEKLY;BYDAY=TU;BYHOUR=18;BYMINUTE=0",
    }
    const withStandalone = await createTemplate(deps(), creatorId, { ...base, standaloneCount: 2, difficultyMix: {} })
    expect(withStandalone.kind).toBe("invalid")
    const withMix = await createTemplate(deps(), creatorId, { ...base, standaloneCount: null, difficultyMix: { easy: 1 } })
    expect(withMix.kind).toBe("invalid")
  })

  it("accepts a verbal template with independent setCount (RC passages) and standaloneCount (VA questions)", async () => {
    const result = await createTemplate(deps(), creatorId, {
      name: "Weekly VARC",
      type: "verbal",
      setCount: 2,
      standaloneCount: 3,
      difficultyMix: { easy: 1 },
      timingPolicy: { standalone: 60, rc: 600 },
      slackSec: 30,
      joinWindowSec: 600,
      marksCorrect: 4,
      marksWrong: -1,
      seatCap: 120,
      rrule: "FREQ=WEEKLY;BYDAY=TU;BYHOUR=18;BYMINUTE=0",
    })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.summary.setCount).toBe(2)
    expect(result.summary.standaloneCount).toBe(3)
  })

  it("rejects a quant template carrying a setCount", async () => {
    const result = await createTemplate(deps(), creatorId, { ...VALID_QUANT_TEMPLATE, setCount: 1 })
    expect(result.kind).toBe("invalid")
  })
})

describe("listTemplates", () => {
  it("pages through created templates, newest first", async () => {
    const first = await createTemplate(deps(), creatorId, VALID_QUANT_TEMPLATE)
    const second = await createTemplate(deps(), creatorId, { ...VALID_QUANT_TEMPLATE, name: "Second" })
    expect(first.kind).toBe("ok")
    expect(second.kind).toBe("ok")

    const page = await listTemplates(deps(), 10, 0)
    expect(page.total).toBe(2)
    expect(page.items.map((t) => t.name)).toEqual(["Second", "Weekly Quant"])
  })

  it("includes inactive templates in the listing", async () => {
    const created = await createTemplate(deps(), creatorId, VALID_QUANT_TEMPLATE)
    if (created.kind !== "ok") throw new Error("setup failed")
    await deactivateTemplate(deps(), created.summary.id)

    const page = await listTemplates(deps(), 10, 0)
    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.active).toBe(false)
  })
})

describe("patchTemplate", () => {
  it("returns not_found for an unknown id", async () => {
    const result = await patchTemplate(deps(), "does-not-exist", { seatCap: 90 })
    expect(result.kind).toBe("not_found")
  })

  it("applies a partial patch, leaving other fields untouched", async () => {
    const created = await createTemplate(deps(), creatorId, VALID_QUANT_TEMPLATE)
    if (created.kind !== "ok") throw new Error("setup failed")

    const result = await patchTemplate(deps(), created.summary.id, { seatCap: 90 })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.summary.seatCap).toBe(90)
    expect(result.summary.name).toBe("Weekly Quant")
    expect(result.summary.timingPolicy).toEqual({ standalone: 60, lrdi: 180 })
  })

  it("rejects a type-only patch when the stored timingPolicy lacks the new type's implied kind", async () => {
    const created = await createTemplate(deps(), creatorId, VALID_QUANT_TEMPLATE) // quant: standalone+lrdi
    if (created.kind !== "ok") throw new Error("setup failed")

    const result = await patchTemplate(deps(), created.summary.id, { type: "verbal" }) // needs standalone+rc
    expect(result.kind).toBe("invalid")
  })

  it("accepts a type patch paired with a compatible timingPolicy patch", async () => {
    const created = await createTemplate(deps(), creatorId, VALID_QUANT_TEMPLATE)
    if (created.kind !== "ok") throw new Error("setup failed")

    const result = await patchTemplate(deps(), created.summary.id, {
      type: "verbal",
      setCount: 1, // verbal needs its own RC-passage count; quant's stored setCount is null
      timingPolicy: { standalone: 60, rc: 300 },
    })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.summary.type).toBe("verbal")
    expect(result.summary.timingPolicy).toEqual({ standalone: 60, rc: 300 })
  })

  it("never re-validates timingPolicy when a patch touches neither type nor timingPolicy", async () => {
    const created = await createTemplate(deps(), creatorId, VALID_QUANT_TEMPLATE)
    if (created.kind !== "ok") throw new Error("setup failed")

    const result = await patchTemplate(deps(), created.summary.id, { name: "Renamed" })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.summary.name).toBe("Renamed")
  })
})

describe("deactivateTemplate", () => {
  it("flips active to false and returns the updated summary", async () => {
    const created = await createTemplate(deps(), creatorId, VALID_QUANT_TEMPLATE)
    if (created.kind !== "ok") throw new Error("setup failed")

    const result = await deactivateTemplate(deps(), created.summary.id)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.summary.active).toBe(false)
  })

  it("returns conflict when deactivating an already-inactive template", async () => {
    const created = await createTemplate(deps(), creatorId, VALID_QUANT_TEMPLATE)
    if (created.kind !== "ok") throw new Error("setup failed")
    await deactivateTemplate(deps(), created.summary.id)

    const result = await deactivateTemplate(deps(), created.summary.id)
    expect(result.kind).toBe("conflict")
  })

  it("returns not_found for an unknown id", async () => {
    const result = await deactivateTemplate(deps(), "does-not-exist")
    expect(result.kind).toBe("not_found")
  })

  it("never touches an already-materialized quiz, and excludes the template from future materialization", async () => {
    const created = await createTemplate(deps(), creatorId, {
      ...VALID_QUANT_TEMPLATE,
      rrule: "FREQ=WEEKLY;BYDAY=TU;BYHOUR=18;BYMINUTE=0",
    })
    if (created.kind !== "ok") throw new Error("setup failed")

    const pool = await Promise.all([makeStandalone("quant"), makeStandalone("quant")])
    const bank = fakeBank(pool)
    const first = await materializeTemplates({ db: env.DB, bank, random: () => 0.42 }, 7, NOW)
    expect(first.quizIds).toHaveLength(1)
    const materializedQuizId = first.quizIds[0]!
    const before = await env.DB.prepare("SELECT status, room_code FROM quizzes WHERE id = ?").bind(materializedQuizId).first()

    await deactivateTemplate(deps(), created.summary.id)

    const after = await env.DB.prepare("SELECT status, room_code FROM quizzes WHERE id = ?").bind(materializedQuizId).first()
    expect(after).toEqual(before)

    const second = await materializeTemplates({ db: env.DB, bank, random: () => 0.42 }, 7, NOW)
    expect(second.quizIds).toHaveLength(0)
  })
})

let questionSeq = 0
async function makeStandalone(type: "quant" | "verbal" | "lr") {
  questionSeq++
  const id = `t-q-${questionSeq}`
  await env.DB.prepare(
    `INSERT INTO questions (id, type, topic, difficulty, format, body_md, option_a, option_b, option_c, option_d, correct_option, explanation_md, created_by, created_at)
     VALUES (?, ?, 'Topic', 'easy', 'mcq', ?, 'A', 'B', 'C', 'D', 'A', 'Explanation', ?, ?)`
  )
    .bind(id, type, `Body ${questionSeq}`, creatorId, Date.now())
    .run()
  return {
    id,
    type,
    topic: "Topic",
    subtopic: null,
    difficulty: "easy" as const,
    format: "mcq" as const,
    passageId: null,
    groupPosition: null,
    bodyMd: `Body ${questionSeq}`,
    imageUrl: null,
    optionA: "A",
    optionB: "B",
    optionC: "C",
    optionD: "D",
    correctOption: "A",
    numericAnswer: null,
    numericTolerance: null,
    explanationMd: "Explanation",
    source: null,
    passage: null,
  }
}

function fakeBank(pool: Awaited<ReturnType<typeof makeStandalone>>[]) {
  const claims = new Map<string, { quizId: string; quizNumber: number }>()
  return {
    async listUnused(filters: { type: string; difficultyMix: Record<string, number>; count: number }) {
      const difficulties = Object.keys(filters.difficultyMix)
      return pool.filter((q) => q.type === filters.type && !claims.has(q.id) && difficulties.includes(q.difficulty))
    },
    async claimUnused(questionIds: string[], quizId: string, quizNumber: number) {
      const confirmed: string[] = []
      for (const id of questionIds) {
        const existing = claims.get(id)
        if (!existing) {
          claims.set(id, { quizId, quizNumber })
          confirmed.push(id)
        } else if (existing.quizId === quizId && existing.quizNumber === quizNumber) {
          confirmed.push(id)
        }
      }
      return confirmed
    },
    async getByIds(questionIds: string[]) {
      const byId = new Map(pool.map((q) => [q.id, q]))
      return questionIds.map((id) => byId.get(id)).filter((q): q is NonNullable<typeof q> => q !== undefined)
    },
  }
}
