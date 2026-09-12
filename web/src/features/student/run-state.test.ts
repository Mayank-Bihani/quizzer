import { describe, expect, it } from "vitest";
import type { ServedQuestion } from "../../../../src/core/contracts";
import {
  buildSubmissionAnswers,
  draftStorageKey,
  isUnitResolved,
  remainingSeconds,
  type AnswerDraft,
} from "./run-state";

const mcq: ServedQuestion = {
  position: 4,
  subPosition: 1,
  format: "mcq",
  bodyMd: "Question",
  imageUrl: null,
  options: ["A", "B", "C", "D"],
};

const tita: ServedQuestion = {
  ...mcq,
  position: 5,
  subPosition: 2,
  format: "tita",
  options: null,
};

describe("active unit drafts", () => {
  it("builds the exact complete batch shape", () => {
    const drafts: Record<number, AnswerDraft> = {
      4: { status: "answered", format: "mcq", chosenOption: "C" },
      5: { status: "skipped" },
    };

    expect(buildSubmissionAnswers([mcq, tita], drafts, "complete")).toEqual([
      { position: 4, status: "answered", format: "mcq", chosenOption: "C" },
      { position: 5, status: "skipped" },
    ]);
  });

  it("marks unresolved responses unanswered only for timeout batches", () => {
    expect(buildSubmissionAnswers([mcq, tita], {}, "timeout")).toEqual([
      { position: 4, status: "unanswered" },
      { position: 5, status: "unanswered" },
    ]);
  });

  it("refuses an incomplete normal batch", () => {
    expect(() => buildSubmissionAnswers([mcq, tita], {}, "complete")).toThrow(
      "Every question must be answered or skipped before completion.",
    );
  });

  it("recognises when every question in a set is resolved", () => {
    expect(isUnitResolved([mcq, tita], { 4: { status: "skipped" } })).toBe(
      false,
    );
    expect(
      isUnitResolved([mcq, tita], {
        4: { status: "skipped" },
        5: { status: "answered", format: "tita", numericValue: 12.5 },
      }),
    ).toBe(true);
  });

  it("scopes local drafts to the user, quiz, and active unit", () => {
    expect(draftStorageKey("user-1", "quiz-2", 3)).toBe(
      "quizzer:draft:user-1:quiz-2:3",
    );
  });
});

describe("authoritative countdown", () => {
  it("rounds up and never becomes negative", () => {
    expect(remainingSeconds(10_001, 10_000)).toBe(1);
    expect(remainingSeconds(9_999, 10_000)).toBe(0);
  });
});
