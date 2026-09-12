import type {
  ServedQuestion,
  UnitAnswer,
} from "../../../../src/core/contracts";

export type AnswerDraft =
  | Omit<Extract<UnitAnswer, { status: "answered"; format: "mcq" }>, "position">
  | Omit<
      Extract<UnitAnswer, { status: "answered"; format: "tita" }>,
      "position"
    >
  | { status: "skipped" };

export function draftStorageKey(
  userId: string,
  quizId: string,
  unitPosition: number,
): string {
  return `quizzer:draft:${userId}:${quizId}:${unitPosition}`;
}

export function isUnitResolved(
  questions: ServedQuestion[],
  drafts: Record<number, AnswerDraft>,
): boolean {
  return questions.every((question) => drafts[question.position] !== undefined);
}

export function buildSubmissionAnswers(
  questions: ServedQuestion[],
  drafts: Record<number, AnswerDraft>,
  reason: "complete" | "timeout",
): UnitAnswer[] {
  return questions.map((question) => {
    const draft = drafts[question.position];
    if (!draft) {
      if (reason === "timeout")
        return { position: question.position, status: "unanswered" };
      throw new Error(
        "Every question must be answered or skipped before completion.",
      );
    }

    return { position: question.position, ...draft };
  });
}

export function remainingSeconds(deadlineAt: number, now: number): number {
  return Math.max(0, Math.ceil((deadlineAt - now) / 1000));
}
