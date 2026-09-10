// Pure V1 marks-only scoring: correct -> marksCorrect, wrong -> marksWrong, skipped/unanswered -> 0. Score final unit batches; speed bonuses deferred to V2 — QUIZZING.md §6.

export type AnswerOutcome = "correct" | "wrong" | "skipped" | "unanswered"

export type MarksConfig = { marksCorrect: number; marksWrong: number }

export function marksForOutcome(outcome: AnswerOutcome, config: MarksConfig): number {
  if (outcome === "correct") return config.marksCorrect
  if (outcome === "wrong") return config.marksWrong
  return 0
}

export type UnitScoreDelta = {
  scoreDelta: number
  correctDelta: number
  wrongDelta: number
  skippedDelta: number
  unansweredDelta: number
  elapsedMs: number // one bounded value for the whole unit, never per-question
}

export function computeUnitDelta(outcomes: AnswerOutcome[], config: MarksConfig, elapsedMs: number): UnitScoreDelta {
  const delta: UnitScoreDelta = {
    scoreDelta: 0,
    correctDelta: 0,
    wrongDelta: 0,
    skippedDelta: 0,
    unansweredDelta: 0,
    elapsedMs,
  }
  for (const outcome of outcomes) {
    delta.scoreDelta += marksForOutcome(outcome, config)
    if (outcome === "correct") delta.correctDelta++
    else if (outcome === "wrong") delta.wrongDelta++
    else if (outcome === "skipped") delta.skippedDelta++
    else delta.unansweredDelta++
  }
  return delta
}
