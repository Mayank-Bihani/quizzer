import { describe, expect, it } from "vitest"
import type { QuestionFull } from "../src/core/contracts"
import { gradeAnswer } from "../src/core/grading"
import { computeUnitDelta, marksForOutcome, type AnswerOutcome } from "../src/core/scoring"

function mcqQuestion(correctOption: "A" | "B" | "C" | "D" | null): QuestionFull {
  return {
    id: "q-1",
    type: "quant",
    topic: "Topic",
    subtopic: null,
    difficulty: "easy",
    format: "mcq",
    passageId: null,
    groupPosition: null,
    bodyMd: "Body",
    imageUrl: null,
    optionA: "A",
    optionB: "B",
    optionC: "C",
    optionD: "D",
    correctOption,
    numericAnswer: null,
    numericTolerance: null,
    explanationMd: "Explanation",
    source: null,
    passage: null,
  }
}

function titaQuestion(numericAnswer: number | null, numericTolerance: number | null): QuestionFull {
  return {
    id: "q-2",
    type: "quant",
    topic: "Topic",
    subtopic: null,
    difficulty: "easy",
    format: "tita",
    passageId: null,
    groupPosition: null,
    bodyMd: "Body",
    imageUrl: null,
    optionA: null,
    optionB: null,
    optionC: null,
    optionD: null,
    correctOption: null,
    numericAnswer,
    numericTolerance,
    explanationMd: "Explanation",
    source: null,
    passage: null,
  }
}

describe("gradeAnswer", () => {
  it("marks a matching MCQ option correct", () => {
    expect(gradeAnswer(mcqQuestion("B"), { format: "mcq", chosenOption: "B" })).toBe(true)
  })

  it("marks a non-matching MCQ option wrong", () => {
    expect(gradeAnswer(mcqQuestion("B"), { format: "mcq", chosenOption: "A" })).toBe(false)
  })

  it("marks a TITA value within tolerance correct, inclusive at the boundary", () => {
    expect(gradeAnswer(titaQuestion(10, 0.5), { format: "tita", numericValue: 10.5 })).toBe(true)
    expect(gradeAnswer(titaQuestion(10, 0.5), { format: "tita", numericValue: 9.5 })).toBe(true)
  })

  it("marks a TITA value outside tolerance wrong", () => {
    expect(gradeAnswer(titaQuestion(10, 0.5), { format: "tita", numericValue: 10.51 })).toBe(false)
  })

  it("marks an exact TITA match correct with zero tolerance", () => {
    expect(gradeAnswer(titaQuestion(7, 0), { format: "tita", numericValue: 7 })).toBe(true)
  })

  it("throws an internal invariant error for a missing MCQ correctOption, never a client-shaped result", () => {
    expect(() => gradeAnswer(mcqQuestion(null), { format: "mcq", chosenOption: "A" })).toThrow()
  })

  it("throws an internal invariant error for a missing TITA numericAnswer", () => {
    expect(() => gradeAnswer(titaQuestion(null, 0.5), { format: "tita", numericValue: 1 })).toThrow()
  })

  it("throws an internal invariant error for a missing TITA numericTolerance", () => {
    expect(() => gradeAnswer(titaQuestion(5, null), { format: "tita", numericValue: 5 })).toThrow()
  })

  it("throws for a nonfinite TITA solution field", () => {
    expect(() => gradeAnswer(titaQuestion(Infinity, 0.5), { format: "tita", numericValue: 1 })).toThrow()
    expect(() => gradeAnswer(titaQuestion(5, Infinity), { format: "tita", numericValue: 1 })).toThrow()
  })

  it("throws for a negative TITA tolerance", () => {
    expect(() => gradeAnswer(titaQuestion(5, -1), { format: "tita", numericValue: 5 })).toThrow()
  })

  it("throws for a format/question mismatch", () => {
    expect(() => gradeAnswer(mcqQuestion("A"), { format: "tita", numericValue: 1 })).toThrow()
    expect(() => gradeAnswer(titaQuestion(5, 0.5), { format: "mcq", chosenOption: "A" })).toThrow()
  })
})

describe("marksForOutcome", () => {
  const config = { marksCorrect: 4, marksWrong: -1 }

  it("awards marksCorrect for a correct outcome", () => {
    expect(marksForOutcome("correct", config)).toBe(4)
  })

  it("awards marksWrong for a wrong outcome", () => {
    expect(marksForOutcome("wrong", config)).toBe(-1)
  })

  it("awards zero for skipped and unanswered outcomes", () => {
    expect(marksForOutcome("skipped", config)).toBe(0)
    expect(marksForOutcome("unanswered", config)).toBe(0)
  })
})

describe("computeUnitDelta", () => {
  const config = { marksCorrect: 4, marksWrong: -1 }

  it("sums marks and counts exactly once per outcome, with one elapsed value for the whole unit", () => {
    const outcomes: AnswerOutcome[] = ["correct", "correct", "wrong", "skipped", "unanswered"]
    const delta = computeUnitDelta(outcomes, config, 12_345)
    expect(delta).toEqual({
      scoreDelta: 4 + 4 - 1,
      correctDelta: 2,
      wrongDelta: 1,
      skippedDelta: 1,
      unansweredDelta: 1,
      elapsedMs: 12_345,
    })
  })

  it("returns all-zero deltas for an empty outcome list but preserves elapsed time", () => {
    expect(computeUnitDelta([], config, 500)).toEqual({
      scoreDelta: 0,
      correctDelta: 0,
      wrongDelta: 0,
      skippedDelta: 0,
      unansweredDelta: 0,
      elapsedMs: 500,
    })
  })

  it("preserves real-valued configured marks without floating equality assumptions", () => {
    const fractional = { marksCorrect: 2.5, marksWrong: -0.75 }
    const delta = computeUnitDelta(["correct", "wrong"], fractional, 0)
    expect(delta.scoreDelta).toBeCloseTo(1.75, 10)
  })
})
