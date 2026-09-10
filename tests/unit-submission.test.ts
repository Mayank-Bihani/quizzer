import { describe, expect, it } from "vitest"
import { canonicalizeSubmission, parseSubmitUnitRequest, type UnitManifestEntry } from "../src/core/unit-submission"

const mcqManifest: UnitManifestEntry[] = [
  { position: 1, format: "mcq" },
  { position: 2, format: "tita" },
]

function validCompleteBody() {
  return {
    submissionId: "sub-1",
    reason: "complete",
    answers: [
      { position: 1, status: "answered", format: "mcq", chosenOption: "B" },
      { position: 2, status: "skipped" },
    ],
  }
}

describe("parseSubmitUnitRequest — shape and keys", () => {
  it("accepts a valid complete batch matching the manifest", () => {
    const result = parseSubmitUnitRequest(validCompleteBody(), mcqManifest)
    expect(result.ok).toBe(true)
  })

  it("rejects a non-object body", () => {
    expect(parseSubmitUnitRequest(null, mcqManifest).ok).toBe(false)
    expect(parseSubmitUnitRequest([], mcqManifest).ok).toBe(false)
    expect(parseSubmitUnitRequest("x", mcqManifest).ok).toBe(false)
  })

  it("rejects an unknown top-level key", () => {
    const body = { ...validCompleteBody(), extra: true }
    expect(parseSubmitUnitRequest(body, mcqManifest).ok).toBe(false)
  })

  it("rejects a missing top-level key", () => {
    const { submissionId: _submissionId, ...rest } = validCompleteBody()
    expect(parseSubmitUnitRequest(rest, mcqManifest).ok).toBe(false)
  })

  it("rejects an empty submissionId", () => {
    const body = { ...validCompleteBody(), submissionId: "" }
    expect(parseSubmitUnitRequest(body, mcqManifest).ok).toBe(false)
  })

  it("rejects an oversized submissionId", () => {
    const body = { ...validCompleteBody(), submissionId: "x".repeat(200) }
    expect(parseSubmitUnitRequest(body, mcqManifest).ok).toBe(false)
  })

  it("rejects a non-string submissionId", () => {
    const body = { ...validCompleteBody(), submissionId: 123 }
    expect(parseSubmitUnitRequest(body, mcqManifest).ok).toBe(false)
  })

  it("rejects an invalid reason", () => {
    const body = { ...validCompleteBody(), reason: "done" }
    expect(parseSubmitUnitRequest(body, mcqManifest).ok).toBe(false)
  })

  it("rejects a non-array answers field", () => {
    const body = { ...validCompleteBody(), answers: {} }
    expect(parseSubmitUnitRequest(body, mcqManifest).ok).toBe(false)
  })
})

describe("parseSubmitUnitRequest — membership and positions", () => {
  it("rejects a batch missing a manifest member", () => {
    const body = {
      submissionId: "sub-1",
      reason: "complete",
      answers: [{ position: 1, status: "answered", format: "mcq", chosenOption: "A" }],
    }
    expect(parseSubmitUnitRequest(body, mcqManifest).ok).toBe(false)
  })

  it("rejects a batch with a foreign position not in the manifest", () => {
    const body = {
      submissionId: "sub-1",
      reason: "complete",
      answers: [
        { position: 1, status: "answered", format: "mcq", chosenOption: "A" },
        { position: 2, status: "skipped" },
        { position: 99, status: "skipped" },
      ],
    }
    expect(parseSubmitUnitRequest(body, mcqManifest).ok).toBe(false)
  })

  it("rejects a batch with a duplicate position", () => {
    const body = {
      submissionId: "sub-1",
      reason: "complete",
      answers: [
        { position: 1, status: "answered", format: "mcq", chosenOption: "A" },
        { position: 1, status: "skipped" },
      ],
    }
    expect(parseSubmitUnitRequest(body, mcqManifest).ok).toBe(false)
  })
})

describe("parseSubmitUnitRequest — MCQ/TITA discriminants", () => {
  it("rejects a format/manifest mismatch", () => {
    const body = {
      submissionId: "sub-1",
      reason: "complete",
      answers: [
        { position: 1, status: "answered", format: "tita", numericValue: 1 }, // manifest position 1 is mcq
        { position: 2, status: "skipped" },
      ],
    }
    expect(parseSubmitUnitRequest(body, mcqManifest).ok).toBe(false)
  })

  it("rejects an invalid MCQ option", () => {
    const body = {
      submissionId: "sub-1",
      reason: "complete",
      answers: [
        { position: 1, status: "answered", format: "mcq", chosenOption: "E" },
        { position: 2, status: "skipped" },
      ],
    }
    expect(parseSubmitUnitRequest(body, mcqManifest).ok).toBe(false)
  })

  it("rejects a nonfinite TITA value", () => {
    const body = {
      submissionId: "sub-1",
      reason: "complete",
      answers: [
        { position: 1, status: "skipped" },
        { position: 2, status: "answered", format: "tita", numericValue: Infinity },
      ],
    }
    expect(parseSubmitUnitRequest(body, mcqManifest).ok).toBe(false)
  })

  it("rejects an answered entry carrying the wrong discriminant field (chosenOption on tita)", () => {
    const body = {
      submissionId: "sub-1",
      reason: "complete",
      answers: [
        { position: 1, status: "skipped" },
        { position: 2, status: "answered", format: "tita", chosenOption: "A" },
      ],
    }
    expect(parseSubmitUnitRequest(body, mcqManifest).ok).toBe(false)
  })

  it("rejects response data attached to a skipped or unanswered entry", () => {
    const body = {
      submissionId: "sub-1",
      reason: "timeout",
      answers: [
        { position: 1, status: "skipped", chosenOption: "A" },
        { position: 2, status: "unanswered" },
      ],
    }
    expect(parseSubmitUnitRequest(body, mcqManifest).ok).toBe(false)
  })
})

describe("parseSubmitUnitRequest — complete vs timeout reason rules", () => {
  it("rejects an unanswered entry under reason 'complete'", () => {
    const body = {
      submissionId: "sub-1",
      reason: "complete",
      answers: [
        { position: 1, status: "answered", format: "mcq", chosenOption: "A" },
        { position: 2, status: "unanswered" },
      ],
    }
    expect(parseSubmitUnitRequest(body, mcqManifest).ok).toBe(false)
  })

  it("accepts an unanswered entry under reason 'timeout'", () => {
    const body = {
      submissionId: "sub-1",
      reason: "timeout",
      answers: [
        { position: 1, status: "answered", format: "mcq", chosenOption: "A" },
        { position: 2, status: "unanswered" },
      ],
    }
    expect(parseSubmitUnitRequest(body, mcqManifest).ok).toBe(true)
  })
})

describe("canonicalizeSubmission", () => {
  it("produces the same canonical bytes regardless of input answer order", () => {
    const a = parseSubmitUnitRequest(
      {
        submissionId: "sub-1",
        reason: "complete",
        answers: [
          { position: 2, status: "answered", format: "tita", numericValue: 5 },
          { position: 1, status: "answered", format: "mcq", chosenOption: "A" },
        ],
      },
      mcqManifest
    )
    const b = parseSubmitUnitRequest(
      {
        submissionId: "sub-1",
        reason: "complete",
        answers: [
          { position: 1, status: "answered", format: "mcq", chosenOption: "A" },
          { position: 2, status: "answered", format: "tita", numericValue: 5 },
        ],
      },
      mcqManifest
    )
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(canonicalizeSubmission(a.parsed)).toEqual(canonicalizeSubmission(b.parsed))
    }
  })

  it("normalizes -0 to 0 so it never diverges from an equivalent +0 submission", () => {
    const negZero = parseSubmitUnitRequest(
      {
        submissionId: "sub-1",
        reason: "complete",
        answers: [
          { position: 1, status: "skipped" },
          { position: 2, status: "answered", format: "tita", numericValue: -0 },
        ],
      },
      mcqManifest
    )
    const posZero = parseSubmitUnitRequest(
      {
        submissionId: "sub-1",
        reason: "complete",
        answers: [
          { position: 1, status: "skipped" },
          { position: 2, status: "answered", format: "tita", numericValue: 0 },
        ],
      },
      mcqManifest
    )
    expect(negZero.ok && posZero.ok).toBe(true)
    if (negZero.ok && posZero.ok) {
      expect(canonicalizeSubmission(negZero.parsed)).toEqual(canonicalizeSubmission(posZero.parsed))
    }
  })

  it("produces different canonical bytes for a changed answer", () => {
    const first = parseSubmitUnitRequest(validCompleteBody(), mcqManifest)
    const changed = parseSubmitUnitRequest(
      {
        submissionId: "sub-1",
        reason: "complete",
        answers: [
          { position: 1, status: "answered", format: "mcq", chosenOption: "C" },
          { position: 2, status: "skipped" },
        ],
      },
      mcqManifest
    )
    expect(first.ok && changed.ok).toBe(true)
    if (first.ok && changed.ok) {
      expect(canonicalizeSubmission(first.parsed)).not.toEqual(canonicalizeSubmission(changed.parsed))
    }
  })

  it("includes the close reason in the canonical form", () => {
    const complete = parseSubmitUnitRequest(
      { submissionId: "sub-1", reason: "complete", answers: [{ position: 1, status: "skipped" }, { position: 2, status: "skipped" }] },
      mcqManifest
    )
    const timeout = parseSubmitUnitRequest(
      { submissionId: "sub-1", reason: "timeout", answers: [{ position: 1, status: "skipped" }, { position: 2, status: "skipped" }] },
      mcqManifest
    )
    expect(complete.ok && timeout.ok).toBe(true)
    if (complete.ok && timeout.ok) {
      expect(canonicalizeSubmission(complete.parsed)).not.toEqual(canonicalizeSubmission(timeout.parsed))
    }
  })
})
