import { describe, expect, it } from "vitest";
import type { QuestionFull, QuizUnitDefinition } from "../../../../src/core/contracts";
import {
  derivedWindowSeconds,
  groupIntoPickUnits,
  mixTotal,
  tallyByDifficulty,
  toggleSelection,
} from "./builder-state";

function question(id: string, overrides: Partial<QuestionFull> = {}): QuestionFull {
  return {
    id,
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
    correctOption: "A",
    numericAnswer: null,
    numericTolerance: null,
    explanationMd: "Explanation",
    source: null,
    usedInQuizId: null,
    passage: null,
    ...overrides,
  };
}

const units: QuizUnitDefinition[] = [
  {
    unitPosition: 1,
    kind: "rc",
    passageId: "p1",
    questionPositions: [1, 2, 3, 4],
    timeLimitSec: 360,
  },
  {
    unitPosition: 2,
    kind: "standalone",
    passageId: null,
    questionPositions: [5],
    timeLimitSec: 45,
  },
];

describe("quiz builder calculations", () => {
  it("derives the window from each actual unit allowance plus explicit slack", () => {
    expect(derivedWindowSeconds(units, 30)).toBe(435);
  });

  it("returns null while any unit allowance is unset", () => {
    expect(
      derivedWindowSeconds([{ ...units[0]!, timeLimitSec: null }], 30),
    ).toBeNull();
  });

  it("totals the three difficulty buckets", () => {
    expect(mixTotal({ easy: 3, medium: 4, hard: 2 })).toBe(9);
  });
});

describe("tallyByDifficulty", () => {
  it("counts selected questions per difficulty", () => {
    const questions = [
      question("q1", { difficulty: "easy" }),
      question("q2", { difficulty: "easy" }),
      question("q3", { difficulty: "hard" }),
    ];
    expect(tallyByDifficulty(questions)).toEqual({ easy: 2, hard: 1 });
  });

  it("returns an empty object for an empty selection", () => {
    expect(tallyByDifficulty([])).toEqual({});
  });
});

describe("toggleSelection", () => {
  it("adds every group member at once when none are selected", () => {
    const group = [
      question("g1", { passageId: "p1", groupPosition: 1 }),
      question("g2", { passageId: "p1", groupPosition: 2 }),
    ];
    const result = toggleSelection([], group);
    expect(result.map((q) => q.id)).toEqual(["g1", "g2"]);
  });

  it("removes every group member at once when any are selected", () => {
    const group = [
      question("g1", { passageId: "p1", groupPosition: 1 }),
      question("g2", { passageId: "p1", groupPosition: 2 }),
    ];
    const other = question("s1");
    const result = toggleSelection([other, ...group], group);
    expect(result.map((q) => q.id)).toEqual(["s1"]);
  });

  it("toggles a standalone independently of unrelated selections", () => {
    const standalone = question("s1");
    const other = question("s2");
    const added = toggleSelection([other], [standalone]);
    expect(added.map((q) => q.id).sort()).toEqual(["s1", "s2"]);
    const removed = toggleSelection(added, [standalone]);
    expect(removed.map((q) => q.id)).toEqual(["s2"]);
  });
});

describe("groupIntoPickUnits", () => {
  it("collapses a flat page of group questions into one unit per passage", () => {
    const page = [
      question("g1", { passageId: "p1", groupPosition: 2 }),
      question("s1"),
      question("g2", { passageId: "p1", groupPosition: 1 }),
      question("g3", { passageId: "p1", groupPosition: 3 }),
    ];
    const units = groupIntoPickUnits(page);
    expect(units).toHaveLength(2);
    const group = units.find((u) => u.passageId === "p1")!;
    // Sorted by group_position regardless of the browse page's own order.
    expect(group.members.map((q) => q.id)).toEqual(["g2", "g1", "g3"]);
    const standalone = units.find((u) => u.passageId === null)!;
    expect(standalone.members.map((q) => q.id)).toEqual(["s1"]);
  });

  it("keeps units in order of first appearance in the page", () => {
    const page = [
      question("s1"),
      question("g1", { passageId: "p1", groupPosition: 1 }),
      question("s2"),
    ];
    const units = groupIntoPickUnits(page);
    expect(units.map((u) => u.key)).toEqual(["s1", "p1", "s2"]);
  });

  it("returns an empty list for an empty page", () => {
    expect(groupIntoPickUnits([])).toEqual([]);
  });
});
