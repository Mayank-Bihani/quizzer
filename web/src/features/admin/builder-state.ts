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

// A native <select multiple> submits one FormData entry per selected option under the same key.
export function readMultiSelect(form: FormData, name: string): string[] {
  return form.getAll(name).map(String);
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

export type PickUnit = {
  key: string;
  passageId: string | null;
  members: QuestionFull[]; // group_position order for a group; single element for a standalone
};

// Groups a browsed page of questions by passageId so the picker shows one row per RC/LRDI set —
// exactly what a question setter picks — instead of one row per flat question. A group split
// across two fetched pages appears as a partial-looking row on each; selection stays correct
// regardless, since toggling a group re-fetches its full membership from the server.
export function groupIntoPickUnits(questions: QuestionFull[]): PickUnit[] {
  const units: PickUnit[] = [];
  const byPassage = new Map<string, PickUnit>();
  for (const question of questions) {
    if (question.passageId === null) {
      units.push({ key: question.id, passageId: null, members: [question] });
      continue;
    }
    let unit = byPassage.get(question.passageId);
    if (!unit) {
      unit = { key: question.passageId, passageId: question.passageId, members: [] };
      byPassage.set(question.passageId, unit);
      units.push(unit);
    }
    unit.members.push(question);
  }
  for (const unit of units) {
    unit.members.sort((a, b) => (a.groupPosition ?? 0) - (b.groupPosition ?? 0));
  }
  return units;
}
