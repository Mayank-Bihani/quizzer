// Is this answer correct? MCQ compare, TITA tolerance — PLAN.md §"Scoring"; QUIZZING.md §12 (Testing)

import type { QuestionFull } from "./contracts"

export type GradableAnswer =
  | { format: "mcq"; chosenOption: "A" | "B" | "C" | "D" }
  | { format: "tita"; numericValue: number }

// Missing/inconsistent BANK solution fields are internal invariant failures: the caller must
// never surface this message to a client, only map it to a generic 500.
export function gradeAnswer(question: QuestionFull, answer: GradableAnswer): boolean {
  if (answer.format === "mcq") {
    if (question.format !== "mcq" || question.correctOption === null) {
      throw new Error("grading invariant: mcq question missing correctOption")
    }
    return answer.chosenOption === question.correctOption
  }

  if (question.format !== "tita" || question.numericAnswer === null || question.numericTolerance === null) {
    throw new Error("grading invariant: tita question missing numericAnswer/numericTolerance")
  }
  if (!Number.isFinite(question.numericAnswer) || !Number.isFinite(question.numericTolerance)) {
    throw new Error("grading invariant: tita question has a nonfinite solution field")
  }
  if (question.numericTolerance < 0) {
    throw new Error("grading invariant: tita question has a negative tolerance")
  }
  if (!Number.isFinite(answer.numericValue)) {
    throw new Error("grading invariant: nonfinite tita answer reached grading")
  }
  return Math.abs(answer.numericValue - question.numericAnswer) <= question.numericTolerance
}
