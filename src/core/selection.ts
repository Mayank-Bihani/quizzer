// Pure unused draw by graded question count/difficulty, whole RC/LRDI groups plus standalones; construct ordered QuizUnitDefinition values — BANK.md; QUIZZING.md §4.

import type { Difficulty, QuestionFull, QuizType, QuizUnitDefinition, UnitKind } from "./contracts"

const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"]

type DifficultyVector = Partial<Record<Difficulty, number>>
type RemainingVector = Record<Difficulty, number>

type UnitCandidate = {
  passageId: string | null
  kind: UnitKind
  questions: QuestionFull[] // group_position order for a group; single element for a standalone
  vector: DifficultyVector
}

export type SelectionOutcome =
  | { ok: true; units: QuizUnitDefinition[]; questions: QuestionFull[] }
  | { ok: false }

function kindForType(type: QuizType): UnitKind {
  return type === "verbal" ? "rc" : "lrdi"
}

/** Groups candidates by passageId into whole-unit candidates; a group is never split. */
function buildUnitCandidates(candidates: QuestionFull[]): UnitCandidate[] {
  const byPassage = new Map<string, QuestionFull[]>()
  const units: UnitCandidate[] = []

  for (const question of candidates) {
    if (question.passageId === null) {
      units.push({ passageId: null, kind: "standalone", questions: [question], vector: { [question.difficulty]: 1 } })
      continue
    }
    const members = byPassage.get(question.passageId) ?? []
    members.push(question)
    byPassage.set(question.passageId, members)
  }

  for (const [passageId, members] of byPassage) {
    const ordered = [...members].sort((a, b) => (a.groupPosition ?? 0) - (b.groupPosition ?? 0))
    const vector: DifficultyVector = {}
    for (const question of ordered) vector[question.difficulty] = (vector[question.difficulty] ?? 0) + 1
    units.push({ passageId, kind: kindForType(ordered[0]!.type), questions: ordered, vector })
  }

  return units
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j] as T, copy[i] as T]
  }
  return copy
}

function fitsWithin(vector: DifficultyVector, remaining: RemainingVector): boolean {
  return DIFFICULTIES.every((d) => (vector[d] ?? 0) <= remaining[d])
}

function subtract(remaining: RemainingVector, vector: DifficultyVector): RemainingVector {
  const next = { ...remaining }
  for (const d of DIFFICULTIES) next[d] -= vector[d] ?? 0
  return next
}

function isExhausted(remaining: RemainingVector): boolean {
  return DIFFICULTIES.every((d) => remaining[d] === 0)
}

/**
 * Memoized backtracking over (candidate index, remaining difficulty counts). A group contributes
 * its whole vector or nothing — it is never partially selected. Only failure states are memoized;
 * reachability of the zero-remaining state from a given (index, remaining) pair does not depend
 * on the order branches are explored, so randomizing that order for variety stays correct.
 */
function search(
  unitCandidates: UnitCandidate[],
  index: number,
  remaining: RemainingVector,
  randomSource: () => number,
  impossible: Map<string, true>
): UnitCandidate[] | null {
  if (isExhausted(remaining)) return []
  if (index >= unitCandidates.length) return null

  const key = `${index}|${remaining.easy}|${remaining.medium}|${remaining.hard}`
  if (impossible.has(key)) return null

  const candidate = unitCandidates[index]!
  const tryTakeFirst = randomSource() < 0.5
  const order = tryTakeFirst ? ([true, false] as const) : ([false, true] as const)

  for (const take of order) {
    if (take) {
      if (!fitsWithin(candidate.vector, remaining)) continue
      const rest = search(unitCandidates, index + 1, subtract(remaining, candidate.vector), randomSource, impossible)
      if (rest !== null) return [candidate, ...rest]
    } else {
      const rest = search(unitCandidates, index + 1, remaining, randomSource, impossible)
      if (rest !== null) return rest
    }
  }

  impossible.set(key, true)
  return null
}

export function selectExactDraw(
  candidates: QuestionFull[],
  difficultyMix: DifficultyVector,
  count: number,
  randomSource: () => number
): SelectionOutcome {
  const target: RemainingVector = {
    easy: difficultyMix.easy ?? 0,
    medium: difficultyMix.medium ?? 0,
    hard: difficultyMix.hard ?? 0,
  }
  const totalRequested = DIFFICULTIES.reduce((sum, d) => sum + target[d], 0)
  if (count <= 0 || totalRequested !== count) return { ok: false }

  const unitCandidates = shuffled(buildUnitCandidates(candidates), randomSource)
  const selected = search(unitCandidates, 0, target, randomSource, new Map())
  if (!selected) return { ok: false }

  const units: QuizUnitDefinition[] = []
  const questions: QuestionFull[] = []
  let flatPosition = 1
  selected.forEach((unit, index) => {
    const questionPositions: number[] = []
    for (const question of unit.questions) {
      questionPositions.push(flatPosition)
      questions.push(question)
      flatPosition++
    }
    units.push({
      unitPosition: index + 1,
      kind: unit.kind,
      passageId: unit.passageId,
      questionPositions,
      timeLimitSec: null,
    })
  })

  return { ok: true, units, questions }
}
