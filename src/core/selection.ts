// Pure unused draw by graded question count/difficulty, whole RC/LRDI groups plus standalones; construct ordered QuizUnitDefinition values — BANK.md; QUIZZING.md §4.

import type { Difficulty, DrawRequest, QuestionFull, QuizUnitDefinition, QuizType, SelectionFilters, UnitKind } from "./contracts"

const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"]

type DifficultyVector = Partial<Record<Difficulty, number>>
// `any` holds slots the caller left unassigned to a specific difficulty — QUIZZING.md §4's
// auto-draw contract: an omitted difficulty is not excluded, it's fillable by any leftover unit.
type RemainingVector = Record<Difficulty, number> & { any: number }

type UnitCandidate = {
  passageId: string | null
  kind: UnitKind
  questions: QuestionFull[] // group_position order for a group; single element for a standalone
  vector: DifficultyVector
}

export type SelectionOutcome =
  | { ok: true; units: QuizUnitDefinition[]; questions: QuestionFull[] }
  | { ok: false }

export type ManualDrawFailureReason = "unknown_question" | "duplicate_question" | "partial_group" | "empty_selection"
export type ManualDrawOutcome =
  | { ok: true; units: QuizUnitDefinition[]; questions: QuestionFull[] }
  | { ok: false; reason: ManualDrawFailureReason }

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

// A unit's per-difficulty counts beyond what's still owed for that exact difficulty must be
// absorbed from the `any` pool — this is what lets an unspecified difficulty draw from wherever
// supply exists instead of being excluded.
function fitsWithin(vector: DifficultyVector, remaining: RemainingVector): boolean {
  const overflow = DIFFICULTIES.reduce((sum, d) => sum + Math.max(0, (vector[d] ?? 0) - remaining[d]), 0)
  return overflow <= remaining.any
}

function subtract(remaining: RemainingVector, vector: DifficultyVector): RemainingVector {
  const next = { ...remaining }
  let overflow = 0
  for (const d of DIFFICULTIES) {
    const need = vector[d] ?? 0
    const used = Math.min(need, next[d])
    next[d] -= used
    overflow += need - used
  }
  next.any -= overflow
  return next
}

function isExhausted(remaining: RemainingVector): boolean {
  return DIFFICULTIES.every((d) => remaining[d] === 0) && remaining.any === 0
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

  const key = `${index}|${remaining.easy}|${remaining.medium}|${remaining.hard}|${remaining.any}`
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

/**
 * Validates an admin's hand-picked questionIds against the fresh unused candidate pool: no
 * duplicates, no unknown ids, and no partially-selected RC/LRDI group. Unit order follows the
 * admin's first-pick order (the minimum index of any of its members within questionIds), not
 * bank insertion order — mirroring the assembly in selectExactDraw but without randomization.
 */
export function buildManualDraw(candidates: QuestionFull[], questionIds: string[]): ManualDrawOutcome {
  const seen = new Set<string>()
  for (const id of questionIds) {
    if (seen.has(id)) return { ok: false, reason: "duplicate_question" }
    seen.add(id)
  }

  const candidatesById = new Map(candidates.map((q) => [q.id, q]))
  for (const id of questionIds) {
    if (!candidatesById.has(id)) return { ok: false, reason: "unknown_question" }
  }

  const indexInSelection = new Map(questionIds.map((id, index) => [id, index]))
  const touched: { unit: UnitCandidate; firstIndex: number }[] = []
  for (const unit of buildUnitCandidates(candidates)) {
    const memberIndices = unit.questions.map((q) => indexInSelection.get(q.id)).filter((i): i is number => i !== undefined)
    if (memberIndices.length === 0) continue
    if (memberIndices.length !== unit.questions.length) return { ok: false, reason: "partial_group" }
    touched.push({ unit, firstIndex: Math.min(...memberIndices) })
  }
  touched.sort((a, b) => a.firstIndex - b.firstIndex)

  const units: QuizUnitDefinition[] = []
  const questions: QuestionFull[] = []
  let flatPosition = 1
  touched.forEach(({ unit }, index) => {
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

export function selectExactDraw(
  candidates: QuestionFull[],
  difficultyMix: DifficultyVector,
  count: number,
  randomSource: () => number
): SelectionOutcome {
  const explicit = {
    easy: difficultyMix.easy ?? 0,
    medium: difficultyMix.medium ?? 0,
    hard: difficultyMix.hard ?? 0,
  }
  const totalRequested = DIFFICULTIES.reduce((sum, d) => sum + explicit[d], 0)
  if (count <= 0 || totalRequested > count) return { ok: false }
  // A difficulty absent from difficultyMix is not requested as zero — the shortfall between what
  // was explicitly requested and `count` is left as `any`, fillable from whichever difficulty has
  // supply left. When every difficulty is explicit and sums to count, `any` is 0 and this behaves
  // exactly as an exact per-difficulty draw always has.
  const target: RemainingVector = { ...explicit, any: count - totalRequested }

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

/** Shared tail: assigns unit/flat positions to an already-chosen, already-ordered unit list. */
function assemble(selected: UnitCandidate[]): SelectionOutcome {
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

/**
 * Draws exactly `setCount` whole rc/lrdi groups of `kind`, chosen at random with no difficulty
 * constraint — a group's members keep whatever difficulty they were authored with (BANK.md), so a
 * set is never targeted by difficulty. Used for lr (always fully grouped) and the RC portion of
 * verbal. Fails if fewer than `setCount` matching groups exist; never partially satisfies a request.
 */
export function selectSetCountDraw(
  candidates: QuestionFull[],
  kind: Extract<UnitKind, "rc" | "lrdi">,
  setCount: number,
  randomSource: () => number
): SelectionOutcome {
  if (setCount <= 0) return { ok: false }
  const matching = shuffled(buildUnitCandidates(candidates).filter((u) => u.kind === kind), randomSource)
  if (matching.length < setCount) return { ok: false }
  return assemble(matching.slice(0, setCount))
}

/**
 * Draws a verbal quiz as `rcSetCount` whole RC passages plus `standaloneCount` standalone VA
 * questions matching `standaloneDifficultyMix` (same exact-vector backtracking as selectExactDraw,
 * scoped to standalone candidates only). The two parts are independent: an RC passage is never
 * substituted for a requested VA question or vice versa, which is what let count=1 silently grab a
 * lone VA question instead of a passage before this split existed.
 */
export function selectVerbalDraw(
  candidates: QuestionFull[],
  rcSetCount: number,
  standaloneDifficultyMix: DifficultyVector,
  standaloneCount: number,
  randomSource: () => number
): SelectionOutcome {
  if (rcSetCount <= 0 && standaloneCount <= 0) return { ok: false }
  const unitCandidates = buildUnitCandidates(candidates)

  let rcUnits: UnitCandidate[] = []
  if (rcSetCount > 0) {
    const matching = shuffled(unitCandidates.filter((u) => u.kind === "rc"), randomSource)
    if (matching.length < rcSetCount) return { ok: false }
    rcUnits = matching.slice(0, rcSetCount)
  }

  let standaloneUnits: UnitCandidate[] = []
  if (standaloneCount > 0) {
    const explicit = {
      easy: standaloneDifficultyMix.easy ?? 0,
      medium: standaloneDifficultyMix.medium ?? 0,
      hard: standaloneDifficultyMix.hard ?? 0,
    }
    const totalRequested = DIFFICULTIES.reduce((sum, d) => sum + explicit[d], 0)
    if (totalRequested > standaloneCount) return { ok: false }
    const target: RemainingVector = { ...explicit, any: standaloneCount - totalRequested }
    const pool = shuffled(unitCandidates.filter((u) => u.kind === "standalone"), randomSource)
    const found = search(pool, 0, target, randomSource, new Map())
    if (!found) return { ok: false }
    standaloneUnits = found
  }

  return assemble(shuffled([...rcUnits, ...standaloneUnits], randomSource))
}

/** Single dispatch point QUIZZING uses for every auto-draw — creation, reshuffle, materialization. */
export function selectDraw(candidates: QuestionFull[], request: DrawRequest, randomSource: () => number): SelectionOutcome {
  if (request.type === "quant") return selectExactDraw(candidates, request.difficultyMix, request.count, randomSource)
  if (request.type === "lr") return selectSetCountDraw(candidates, "lrdi", request.setCount, randomSource)
  return selectVerbalDraw(candidates, request.setCount, request.standaloneDifficultyMix, request.standaloneCount, randomSource)
}

/**
 * The bank-query filters a DrawRequest implies — only the standalone portion is ever
 * difficulty-scoped; whole groups are always fetched regardless (src/db/bank-contract.ts).
 */
export function toBankFilters(request: DrawRequest): SelectionFilters {
  if (request.type === "quant") return { type: "quant", difficultyMix: request.difficultyMix, count: request.count }
  if (request.type === "lr") return { type: "lr", difficultyMix: {}, count: 0 }
  return { type: "verbal", difficultyMix: request.standaloneDifficultyMix, count: request.standaloneCount }
}

export type StoredDrawRequest = {
  setCount: number | null
  standaloneCount: number | null
  difficultyMix: DifficultyVector
}

/** The set_count/standalone_count/difficulty_mix columns a DrawRequest persists as (quizzes and
 * quiz_templates share this shape — src/db/quizzes.ts). */
export function toStoredDrawRequest(request: DrawRequest): StoredDrawRequest {
  if (request.type === "quant") return { setCount: null, standaloneCount: request.count, difficultyMix: request.difficultyMix }
  if (request.type === "lr") return { setCount: request.setCount, standaloneCount: null, difficultyMix: {} }
  return { setCount: request.setCount, standaloneCount: request.standaloneCount, difficultyMix: request.standaloneDifficultyMix }
}

/** Inverse of toStoredDrawRequest — reconstructs the request a stored row represents, for reshuffle
 * and materialization. */
export function fromStoredDrawRequest(type: QuizType, stored: StoredDrawRequest): DrawRequest {
  if (type === "quant") return { type: "quant", count: stored.standaloneCount ?? 0, difficultyMix: stored.difficultyMix }
  if (type === "lr") return { type: "lr", setCount: stored.setCount ?? 0 }
  return {
    type: "verbal",
    setCount: stored.setCount ?? 0,
    standaloneCount: stored.standaloneCount ?? 0,
    standaloneDifficultyMix: stored.difficultyMix,
  }
}
