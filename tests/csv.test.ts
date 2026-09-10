import { describe, expect, it } from "vitest"
import { parseBankCsv, validateImageReferences } from "../src/core/csv"
// The Workers test runtime has no real filesystem; Vite's `?raw` import inlines the fixture text
// at build time instead of relying on `node:fs`, which is sandboxed away here.
import bankCsvFixture from "../fixtures/bank.csv?raw"

const HEADER =
  "type,topic,subtopic,difficulty,format,passage_ref,body,image,option_a,option_b,option_c,option_d,correct,numeric_answer,tolerance,explanation,source"

function mcqRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    type: "quant",
    topic: "Arithmetic",
    subtopic: "",
    difficulty: "easy",
    format: "mcq",
    passage_ref: "",
    body: "What is 2 + 2?",
    image: "",
    option_a: "3",
    option_b: "4",
    option_c: "5",
    option_d: "6",
    correct: "B",
    numeric_answer: "",
    tolerance: "",
    explanation: "2 + 2 = 4.",
    source: "",
    ...overrides,
  }
}

function titaRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    type: "quant",
    topic: "Arithmetic",
    subtopic: "",
    difficulty: "medium",
    format: "tita",
    passage_ref: "",
    body: "What is 10 / 2?",
    image: "",
    option_a: "",
    option_b: "",
    option_c: "",
    option_d: "",
    correct: "",
    numeric_answer: "5",
    tolerance: "0",
    explanation: "10 / 2 = 5.",
    source: "",
    ...overrides,
  }
}

function passageRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    type: "verbal",
    topic: "Reading Comprehension",
    subtopic: "",
    difficulty: "",
    format: "passage",
    passage_ref: "rc-1",
    body: "A short passage about something.",
    image: "",
    option_a: "",
    option_b: "",
    option_c: "",
    option_d: "",
    correct: "",
    numeric_answer: "",
    tolerance: "",
    explanation: "",
    source: "",
    ...overrides,
  }
}

const COLUMNS = [
  "type",
  "topic",
  "subtopic",
  "difficulty",
  "format",
  "passage_ref",
  "body",
  "image",
  "option_a",
  "option_b",
  "option_c",
  "option_d",
  "correct",
  "numeric_answer",
  "tolerance",
  "explanation",
  "source",
]

function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function toCsv(rows: Record<string, string>[], header = HEADER): string {
  const lines = [header]
  for (const row of rows) {
    lines.push(COLUMNS.map((c) => csvField(row[c] ?? "")).join(","))
  }
  return lines.join("\n")
}

describe("parseBankCsv — header validation", () => {
  it("reports a missing required header as a file-level error", () => {
    const badHeader = HEADER.replace("correct,", "")
    const result = parseBankCsv(toCsv([mcqRow()], badHeader))
    expect(result.errors.some((e) => e.line === 0 && /correct/i.test(e.message))).toBe(true)
  })

  it("reports a duplicated header as a file-level error", () => {
    const dupHeader = HEADER + ",type"
    const result = parseBankCsv(toCsv([mcqRow()], dupHeader))
    expect(result.errors.some((e) => e.line === 0 && /duplicate/i.test(e.message))).toBe(true)
  })

  it("tolerates and ignores additional columns beyond the canonical set", () => {
    const extraHeader = HEADER + ",internal_note"
    const row = COLUMNS.map((c) => csvField(mcqRow()[c] ?? "")).join(",") + ",ignored value"
    const csv = [extraHeader, row].join("\n")
    const result = parseBankCsv(csv)
    expect(result.questions).toHaveLength(1)
    expect(result.errors).toHaveLength(0)
  })
})

describe("parseBankCsv — row rules", () => {
  it("parses a valid MCQ row with no errors", () => {
    const result = parseBankCsv(toCsv([mcqRow()]))
    expect(result.errors).toHaveLength(0)
    expect(result.questions).toHaveLength(1)
    expect(result.questions[0]).toMatchObject({
      format: "mcq",
      optionA: "3",
      optionB: "4",
      correctOption: "B",
      numericAnswer: null,
      numericTolerance: null,
      subtopic: null,
      source: null,
    })
  })

  it("rejects an MCQ row missing correct at its physical line", () => {
    const result = parseBankCsv(toCsv([mcqRow({ correct: "" })]))
    expect(result.errors).toEqual([expect.objectContaining({ line: 2 })])
  })

  it("rejects an MCQ row with a non-A-D correct value", () => {
    const result = parseBankCsv(toCsv([mcqRow({ correct: "E" })]))
    expect(result.errors.some((e) => e.line === 2)).toBe(true)
  })

  it("rejects an MCQ row with fewer than 4 options", () => {
    const result = parseBankCsv(toCsv([mcqRow({ option_d: "" })]))
    expect(result.errors.some((e) => e.line === 2)).toBe(true)
  })

  it("parses a valid TITA row with no errors", () => {
    const result = parseBankCsv(toCsv([titaRow()]))
    expect(result.errors).toHaveLength(0)
    expect(result.questions[0]).toMatchObject({ format: "tita", numericAnswer: 5, numericTolerance: 0 })
  })

  it("rejects a TITA row whose numeric_answer does not parse", () => {
    const result = parseBankCsv(toCsv([titaRow({ numeric_answer: "not-a-number" })]))
    expect(result.errors.some((e) => e.line === 2)).toBe(true)
  })

  it("rejects a TITA row with a negative tolerance", () => {
    const result = parseBankCsv(toCsv([titaRow({ tolerance: "-1" })]))
    expect(result.errors.some((e) => e.line === 2)).toBe(true)
  })

  it("rejects a row with an invalid type", () => {
    const result = parseBankCsv(toCsv([mcqRow({ type: "history" })]))
    expect(result.errors.some((e) => e.line === 2)).toBe(true)
  })

  it("rejects a question row with an invalid difficulty", () => {
    const result = parseBankCsv(toCsv([mcqRow({ difficulty: "impossible" })]))
    expect(result.errors.some((e) => e.line === 2)).toBe(true)
  })

  it("rejects a row with an empty body", () => {
    const result = parseBankCsv(toCsv([mcqRow({ body: "" })]))
    expect(result.errors.some((e) => e.line === 2)).toBe(true)
  })

  it("rejects a question row with an empty explanation", () => {
    const result = parseBankCsv(toCsv([mcqRow({ explanation: "" })]))
    expect(result.errors.some((e) => e.line === 2)).toBe(true)
  })

  it("accepts blank subtopic and source", () => {
    const result = parseBankCsv(toCsv([mcqRow({ subtopic: "", source: "" })]))
    expect(result.errors).toHaveLength(0)
    expect(result.questions[0].subtopic).toBeNull()
    expect(result.questions[0].source).toBeNull()
  })

  it("counts a passage row in passages, never in questions", () => {
    const result = parseBankCsv(
      toCsv([
        passageRow({ passage_ref: "rc-1", type: "verbal" }),
        mcqRow({ passage_ref: "rc-1", type: "verbal" }),
        mcqRow({ passage_ref: "rc-1", type: "verbal" }),
        mcqRow({ passage_ref: "rc-1", type: "verbal" }),
        mcqRow({ passage_ref: "rc-1", type: "verbal" }),
      ])
    )
    expect(result.errors).toHaveLength(0)
    expect(result.passages).toHaveLength(1)
    expect(result.questions).toHaveLength(4)
  })

  it("requires a passage row's passage_ref to be unique in the file", () => {
    const result = parseBankCsv(
      toCsv([
        passageRow({ passage_ref: "rc-1" }),
        passageRow({ passage_ref: "rc-1" }),
        mcqRow({ passage_ref: "rc-1" }),
        mcqRow({ passage_ref: "rc-1" }),
        mcqRow({ passage_ref: "rc-1" }),
        mcqRow({ passage_ref: "rc-1" }),
      ])
    )
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("rejects a question whose passage_ref does not resolve in the same file", () => {
    const result = parseBankCsv(toCsv([mcqRow({ passage_ref: "unknown-ref" })]))
    expect(result.errors.some((e) => /passage_ref|unknown-ref/i.test(e.message))).toBe(true)
  })

  it("rejects a group with only 3 questions", () => {
    const result = parseBankCsv(
      toCsv([
        passageRow({ passage_ref: "rc-1" }),
        mcqRow({ passage_ref: "rc-1", type: "verbal" }),
        mcqRow({ passage_ref: "rc-1", type: "verbal" }),
        mcqRow({ passage_ref: "rc-1", type: "verbal" }),
      ])
    )
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("rejects a group with 6 questions", () => {
    const rows = [passageRow({ passage_ref: "rc-1" })]
    for (let i = 0; i < 6; i++) rows.push(mcqRow({ passage_ref: "rc-1", type: "verbal" }))
    const result = parseBankCsv(toCsv(rows))
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("accepts a group of exactly 5 with matching section, assigning 1-based group positions", () => {
    const rows = [passageRow({ passage_ref: "rc-1", type: "verbal" })]
    for (let i = 0; i < 5; i++) rows.push(mcqRow({ passage_ref: "rc-1", type: "verbal" }))
    const result = parseBankCsv(toCsv(rows))
    expect(result.errors).toHaveLength(0)
    expect(result.questions.map((q) => q.groupPosition)).toEqual([1, 2, 3, 4, 5])
  })

  it("rejects a group member whose section does not match the passage's section", () => {
    const result = parseBankCsv(
      toCsv([
        passageRow({ passage_ref: "rc-1", type: "verbal" }),
        mcqRow({ passage_ref: "rc-1", type: "verbal" }),
        mcqRow({ passage_ref: "rc-1", type: "verbal" }),
        mcqRow({ passage_ref: "rc-1", type: "verbal" }),
        mcqRow({ passage_ref: "rc-1", type: "quant" }),
      ])
    )
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("assigns group position independently per group, from file order", () => {
    const rows = [
      passageRow({ passage_ref: "rc-1", type: "verbal" }),
      ...Array.from({ length: 4 }, () => mcqRow({ passage_ref: "rc-1", type: "verbal" })),
      passageRow({ passage_ref: "rc-2", type: "lr" }),
      ...Array.from({ length: 4 }, () => mcqRow({ passage_ref: "rc-2", type: "lr" })),
    ]
    const result = parseBankCsv(toCsv(rows))
    expect(result.errors).toHaveLength(0)
    expect(result.questions.filter((q) => q.passageRef === "rc-2").map((q) => q.groupPosition)).toEqual([
      1, 2, 3, 4,
    ])
  })
})

describe("parseBankCsv — reproduces the PRD acceptance case", () => {
  it("reports exactly two errors at their source lines and nothing else", () => {
    const csv = toCsv([mcqRow({ correct: "" }), mcqRow({ passage_ref: "does-not-exist" })])
    const result = parseBankCsv(csv)
    expect(result.errors).toHaveLength(2)
    expect(result.errors.map((e) => e.line).sort()).toEqual([2, 3])
  })
})

describe("parseBankCsv — encoding and quoting", () => {
  it("strips a single leading UTF-8 BOM", () => {
    const csv = "﻿" + toCsv([mcqRow()])
    const result = parseBankCsv(csv)
    expect(result.errors).toHaveLength(0)
    expect(result.questions).toHaveLength(1)
  })

  it("handles CRLF line endings", () => {
    const csv = toCsv([mcqRow()]).replace(/\n/g, "\r\n")
    const result = parseBankCsv(csv)
    expect(result.errors).toHaveLength(0)
  })

  it("preserves the physical starting line of a record after a quoted multiline field", () => {
    const rows = [
      passageRow({ passage_ref: "rc-1", body: "Line one of the passage.\nLine two of the passage." }),
      mcqRow({ passage_ref: "rc-1", type: "verbal", correct: "" }), // error should point at line 3, not line 2
      mcqRow({ passage_ref: "rc-1", type: "verbal" }),
      mcqRow({ passage_ref: "rc-1", type: "verbal" }),
      mcqRow({ passage_ref: "rc-1", type: "verbal" }),
    ]
    const csv = toCsv(rows)
    const result = parseBankCsv(csv)
    // Header = line 1; the passage's body embeds one newline, so it spans lines 2-3, and the
    // next record (with the deliberately missing `correct`) starts at physical line 4.
    expect(result.errors).toEqual([expect.objectContaining({ line: 4 })])
  })

  it("preserves commas, quotes, backslashes, and $LaTeX$ inside a quoted body", () => {
    const body = 'Solve: $f(x) = x^2$, note "quoted" text, and a backslash \\ here, plus a comma.'
    const result = parseBankCsv(toCsv([mcqRow({ body })]))
    expect(result.errors).toHaveLength(0)
    expect(result.questions[0].bodyMd).toBe(body)
  })

  it("can produce more than one error for a single line", () => {
    const result = parseBankCsv(toCsv([mcqRow({ body: "", correct: "" })]))
    expect(result.errors.filter((e) => e.line === 2).length).toBeGreaterThanOrEqual(2)
  })
})

describe("validateImageReferences", () => {
  it("passes when every referenced image is present and accepted in the ZIP", () => {
    const errors = validateImageReferences(
      [{ filename: "fig1.png", line: 2 }],
      [{ name: "fig1.png", accepted: true }]
    )
    expect(errors).toHaveLength(0)
  })

  it("errors when a referenced image is missing from the ZIP", () => {
    const errors = validateImageReferences([{ filename: "missing.png", line: 2 }], [])
    expect(errors).toEqual([expect.objectContaining({ line: 2 })])
  })

  it("errors when a referenced image was rejected by ZIP inspection", () => {
    const errors = validateImageReferences(
      [{ filename: "bad.exe", line: 2 }],
      [{ name: "bad.exe", accepted: false, reason: "disallowed format" }]
    )
    expect(errors).toEqual([expect.objectContaining({ line: 2, message: expect.stringContaining("disallowed format") })])
  })

  it("errors on every image reference when no ZIP was uploaded at all", () => {
    const errors = validateImageReferences([{ filename: "fig1.png", line: 2 }], null)
    expect(errors).toEqual([expect.objectContaining({ line: 2 })])
  })
})

describe("parseBankCsv — the permanent fixture", () => {
  it("parses fixtures/bank.csv with no errors and the expected shape", () => {
    const result = parseBankCsv(bankCsvFixture)

    expect(result.errors).toHaveLength(0)
    expect(result.passages.length).toBeGreaterThanOrEqual(2)
    expect(result.questions.some((question) => question.format === "mcq")).toBe(true)
    expect(result.questions.some((question) => question.format === "tita")).toBe(true)
    expect(result.questions.some((question) => question.bodyMd.includes("$"))).toBe(true)
    expect(result.questions.some((question) => question.subtopic === null)).toBe(true)
    expect(result.questions.some((question) => question.source === null)).toBe(true)
    expect(result.imageReferences.length).toBeGreaterThanOrEqual(1)

    const verbalGroupSizes = new Map<string, number>()
    const lrGroupSizes = new Map<string, number>()
    for (const question of result.questions) {
      if (!question.passageRef) continue
      const map = question.type === "verbal" ? verbalGroupSizes : lrGroupSizes
      map.set(question.passageRef, (map.get(question.passageRef) ?? 0) + 1)
    }
    expect([...verbalGroupSizes.values()].some((size) => size >= 4 && size <= 5)).toBe(true)
    expect([...lrGroupSizes.values()].some((size) => size >= 4 && size <= 5)).toBe(true)
  })
})
