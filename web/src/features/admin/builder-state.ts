import type {
  Difficulty,
  QuestionFull,
  QuizUnitDefinition,
} from "../../../../src/core/contracts";

export function derivedWindowSeconds(
  units: QuizUnitDefinition[],
  slackSec: number,
): number | null {
  if (units.some((unit) => unit.timeLimitSec === null)) return null;
  return units.reduce(
    (total, unit) => total + (unit.timeLimitSec ?? 0),
    slackSec,
  );
}

export function mixTotal(mix: Partial<Record<Difficulty, number>>): number {
  return (mix.easy ?? 0) + (mix.medium ?? 0) + (mix.hard ?? 0);
}

export function tallyByDifficulty(
  questions: QuestionFull[],
): Partial<Record<Difficulty, number>> {
  const tally: Partial<Record<Difficulty, number>> = {};
  for (const question of questions) {
    tally[question.difficulty] = (tally[question.difficulty] ?? 0) + 1;
  }
  return tally;
}

// Toggles an entire unit (a whole RC/LRDI group, or a single-element array for a standalone) in
// or out of the current selection together — a group is never left partially selected.
export function toggleSelection(
  selected: QuestionFull[],
  group: QuestionFull[],
): QuestionFull[] {
  const groupIds = new Set(group.map((question) => question.id));
  const withoutGroup = selected.filter((question) => !groupIds.has(question.id));
  const wasSelected = withoutGroup.length !== selected.length;
  return wasSelected ? withoutGroup : [...withoutGroup, ...group];
}
