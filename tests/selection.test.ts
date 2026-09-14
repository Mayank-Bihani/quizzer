import { describe, expect, it } from "vitest"
import {
  buildManualDraw,
  fromStoredDrawRequest,
  selectDraw,
  selectExactDraw,
  selectSetCountDraw,
  selectVerbalDraw,
  toBankFilters,
  toStoredDrawRequest,
} from "../src/core/selection"
import type { Difficulty, DrawRequest, QuestionFull, QuizType } from "../src/core/contracts"

let nextId = 0
function freshId(): string {
  nextId++
  return `q-${nextId}`
}

function standalone(type: QuizType, difficulty: Difficulty): QuestionFull {
  return {
    id: freshId(),
    type,
    topic: "Topic",
    subtopic: null,
    difficulty,
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
    passage: null,
  }
}

function group(type: QuizType, difficulties: Difficulty[]): QuestionFull[] {
  const passageId = `p-${freshId()}`
  return difficulties.map((difficulty, i) => ({
    id: freshId(),
    type,
    topic: "Topic",
    subtopic: null,
    difficulty,
    format: "mcq" as const,
    passageId,
    groupPosition: i + 1,
    bodyMd: `Body ${i + 1}`,
    imageUrl: null,
    optionA: "A",
    optionB: "B",
    optionC: "C",
    optionD: "D",
    correctOption: "A" as const,
    numericAnswer: null,
    numericTolerance: null,
    explanationMd: "Explanation",
    source: null,
    passage: { title: null, bodyMd: "Shared", imageUrl: null },
  }))
}

const NO_RANDOM = () => 0.5

describe("selectExactDraw — standalones", () => {
  it("selects an exact difficulty vector from standalones", () => {
    const candidates = [
      standalone("quant", "easy"),
      standalone("quant", "easy"),
      standalone("quant", "medium"),
      standalone("quant", "hard"),
    ]
    const result = selectExactDraw(candidates, { easy: 2 }, 2, NO_RANDOM)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.questions).toHaveLength(2)
    expect(result.questions.every((q) => q.difficulty === "easy")).toBe(true)
    expect(result.units.every((u) => u.kind === "standalone")).toBe(true)
  })

  it("reports impossible when supply is insufficient", () => {
    const candidates = [standalone("quant", "easy")]
    const result = selectExactDraw(candidates, { easy: 3 }, 3, NO_RANDOM)
    expect(result.ok).toBe(false)
  })
})

describe("selectExactDraw — unspecified difficulty draws from any pool", () => {
  it("fills the shortfall from whichever difficulty has supply when a difficulty is omitted", () => {
    const candidates = [standalone("quant", "easy"), standalone("quant", "medium"), standalone("quant", "hard")]
    // Only easy is constrained; the other slot is left to any difficulty.
    const result = selectExactDraw(candidates, { easy: 1 }, 2, NO_RANDOM)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.questions).toHaveLength(2)
    expect(result.questions.filter((q) => q.difficulty === "easy")).toHaveLength(1)
  })

  it("draws entirely from any difficulty when difficultyMix is completely empty", () => {
    const candidates = [standalone("quant", "easy"), standalone("quant", "medium"), standalone("quant", "hard")]
    const result = selectExactDraw(candidates, {}, 3, NO_RANDOM)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.questions).toHaveLength(3)
  })

  it("still respects a whole group's atomicity when part of its vector is absorbed by the any pool", () => {
    const g = group("verbal", ["easy", "easy", "medium", "medium"])
    // Nothing constrained beyond easy: 2 — the 2 medium members must come from the any pool.
    const result = selectExactDraw(g, { easy: 2 }, 4, NO_RANDOM)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.units).toHaveLength(1)
    expect(result.questions).toHaveLength(4)
  })

  it("reports impossible when even the any pool can't be satisfied", () => {
    const candidates = [standalone("quant", "easy")]
    const result = selectExactDraw(candidates, { easy: 1 }, 3, NO_RANDOM)
    expect(result.ok).toBe(false)
  })

  it("rejects an over-specified mix (sum greater than count) up front", () => {
    const candidates = [standalone("quant", "easy"), standalone("quant", "easy")]
    const result = selectExactDraw(candidates, { easy: 3 }, 2, NO_RANDOM)
    expect(result.ok).toBe(false)
  })
})

describe("selectExactDraw — whole-group atomicity", () => {
  it("selects an entire matching group as one unit, never splitting it", () => {
    const g = group("verbal", ["medium", "medium", "medium", "medium"])
    const result = selectExactDraw(g, { medium: 4 }, 4, NO_RANDOM)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.questions).toHaveLength(4)
    expect(result.units).toHaveLength(1)
    expect(result.units[0]).toMatchObject({ kind: "rc", questionPositions: [1, 2, 3, 4] })
  })

  it("maps a grouped quant/lr candidate to kind 'lrdi'", () => {
    const g = group("lr", ["hard", "hard", "hard", "hard"])
    const result = selectExactDraw(g, { hard: 4 }, 4, NO_RANDOM)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.units[0]?.kind).toBe("lrdi")
  })

  it("selects a mixed-difficulty group only when its combined vector matches exactly", () => {
    const g = group("quant", ["easy", "easy", "medium", "medium"])
    const result = selectExactDraw(g, { easy: 2, medium: 2 }, 4, NO_RANDOM)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.questions).toHaveLength(4)
  })

  it("refuses a group whose combined vector does not match the requested mix", () => {
    // The only candidate contributes 3 easy + 1 medium, but the request wants easy only.
    const g = group("quant", ["easy", "easy", "easy", "medium"])
    const result = selectExactDraw(g, { easy: 3 }, 3, NO_RANDOM)
    expect(result.ok).toBe(false)
  })

  it("never splits a group even when only part of it would fit the vector", () => {
    const g = group("verbal", ["easy", "easy", "medium", "medium"])
    // Only 2 easy requested — the group can't be taken whole, and there's no other candidate.
    const result = selectExactDraw(g, { easy: 2 }, 2, NO_RANDOM)
    expect(result.ok).toBe(false)
  })

  it("combines a whole group with standalones to reach the exact vector", () => {
    const g = group("quant", ["easy", "easy", "easy", "easy"])
    const candidates = [...g, standalone("quant", "medium"), standalone("quant", "medium")]
    const result = selectExactDraw(candidates, { easy: 4, medium: 2 }, 6, NO_RANDOM)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.questions).toHaveLength(6)
    expect(result.units).toHaveLength(3) // 1 group unit + 2 standalone units
  })
})

describe("selectExactDraw — ordering and positions", () => {
  it("assigns contiguous unit/flat/sub positions across mixed units", () => {
    const g = group("verbal", ["easy", "easy", "easy", "easy"])
    const candidates = [...g, standalone("verbal", "medium")]
    const result = selectExactDraw(candidates, { easy: 4, medium: 1 }, 5, NO_RANDOM)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.units.map((u) => u.unitPosition)).toEqual([1, 2])
    const allPositions = result.questions.map((_, i) => i + 1)
    expect(result.questions).toHaveLength(5)

    const flatPositions = new Set<number>()
    for (const unit of result.units) {
      for (const pos of unit.questionPositions) flatPositions.add(pos)
    }
    expect([...flatPositions].sort((a, b) => a - b)).toEqual(allPositions)

    const groupUnit = result.units.find((u) => u.kind === "rc")!
    expect(groupUnit.questionPositions).toHaveLength(4)
    const standaloneUnit = result.units.find((u) => u.kind === "standalone")!
    expect(standaloneUnit.questionPositions).toHaveLength(1)
  })

  it("preserves BANK group_position order for grouped questions", () => {
    const g = group("verbal", ["easy", "easy", "easy", "easy"])
    const result = selectExactDraw(g, { easy: 4 }, 4, NO_RANDOM)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.questions.map((q) => q.bodyMd)).toEqual(["Body 1", "Body 2", "Body 3", "Body 4"])
  })
})

describe("selectExactDraw — randomization and purity", () => {
  it("never mutates the input candidates array", () => {
    const candidates = [standalone("quant", "easy"), standalone("quant", "easy")]
    const snapshot = JSON.stringify(candidates)
    selectExactDraw(candidates, { easy: 2 }, 2, NO_RANDOM)
    expect(JSON.stringify(candidates)).toBe(snapshot)
  })

  it("uses the injected random source rather than a global one", () => {
    const candidates = Array.from({ length: 10 }, () => standalone("quant", "easy"))
    let calls = 0
    const countingRandom = () => {
      calls++
      return 0.5
    }
    selectExactDraw(candidates, { easy: 5 }, 5, countingRandom)
    expect(calls).toBeGreaterThan(0)
  })

  it("different random sources can select different subsets when multiple valid draws exist", () => {
    const candidates = Array.from({ length: 8 }, () => standalone("quant", "easy"))
    const first = selectExactDraw(candidates, { easy: 4 }, 4, () => 0)
    const second = selectExactDraw(candidates, { easy: 4 }, 4, () => 0.999)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    // Not asserting they differ (they legitimately might coincide) — asserting both are valid,
    // independently-computed exact draws is the real property.
    expect(first.questions).toHaveLength(4)
    expect(second.questions).toHaveLength(4)
  })
})

describe("buildManualDraw", () => {
  it("accepts a whole standalone plus a whole group, ordered by first-pick", () => {
    const g = group("verbal", ["easy", "medium", "hard", "hard"])
    const s1 = standalone("verbal", "easy")
    const s2 = standalone("verbal", "medium")
    const candidates = [s1, ...g, s2]
    // Admin first picks s2, then the group's members out of order, then s1 last.
    const questionIds = [s2.id, g[2]!.id, g[0]!.id, g[1]!.id, g[3]!.id, s1.id]
    const result = buildManualDraw(candidates, questionIds)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.questions).toHaveLength(6)
    expect(result.units).toHaveLength(3)
    // s2 was picked first, so its standalone unit comes first; the group (first touched at g[2])
    // second; s1's standalone unit last, since it was picked last.
    expect(result.units[0]).toMatchObject({ kind: "standalone", unitPosition: 1 })
    expect(result.units[1]).toMatchObject({ kind: "rc", unitPosition: 2, questionPositions: [2, 3, 4, 5] })
    expect(result.units[2]).toMatchObject({ kind: "standalone", unitPosition: 3, questionPositions: [6] })
    // Group members are still assembled in group_position order, not pick order.
    expect(result.questions.slice(1, 5).map((q) => q.bodyMd)).toEqual(["Body 1", "Body 2", "Body 3", "Body 4"])
  })

  it("rejects a partially-selected group even when interleaved with standalones", () => {
    const g = group("quant", ["easy", "easy", "medium", "medium"])
    const s = standalone("quant", "hard")
    const candidates = [...g, s]
    const result = buildManualDraw(candidates, [g[0]!.id, s.id, g[1]!.id, g[2]!.id]) // omits g[3]
    expect(result).toEqual({ ok: false, reason: "partial_group" })
  })

  it("rejects duplicate ids", () => {
    const s = standalone("quant", "easy")
    const result = buildManualDraw([s], [s.id, s.id])
    expect(result).toEqual({ ok: false, reason: "duplicate_question" })
  })

  it("rejects an id absent from the candidate pool", () => {
    const s = standalone("quant", "easy")
    const result = buildManualDraw([s], [s.id, "not-a-real-id"])
    expect(result).toEqual({ ok: false, reason: "unknown_question" })
  })

  it("accepts an empty selection as a vacuous success (callers guard emptiness separately)", () => {
    const s = standalone("quant", "easy")
    const result = buildManualDraw([s], [])
    expect(result).toEqual({ ok: true, units: [], questions: [] })
  })
})

describe("selectExactDraw — property test against a brute-force oracle", () => {
  function bruteForceExists(
    unitCandidates: { size: number; vector: Partial<Record<Difficulty, number>> }[],
    target: Partial<Record<Difficulty, number>>,
    count: number
  ): boolean {
    const n = unitCandidates.length
    for (let mask = 0; mask < 1 << n; mask++) {
      let size = 0
      const totals: Partial<Record<Difficulty, number>> = {}
      for (let i = 0; i < n; i++) {
        if (!(mask & (1 << i))) continue
        size += unitCandidates[i]!.size
        for (const [d, c] of Object.entries(unitCandidates[i]!.vector)) {
          totals[d as Difficulty] = (totals[d as Difficulty] ?? 0) + (c ?? 0)
        }
      }
      if (size !== count) continue
      const keys = new Set([...Object.keys(target), ...Object.keys(totals)])
      let matches = true
      for (const k of keys) {
        if ((target[k as Difficulty] ?? 0) !== (totals[k as Difficulty] ?? 0)) matches = false
      }
      if (matches) return true
    }
    return false
  }

  it("agrees with brute force across randomly generated small scenarios", () => {
    const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"]
    let seed = 42
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }

    for (let scenario = 0; scenario < 25; scenario++) {
      const specs: { size: number; vector: Partial<Record<Difficulty, number>> }[] = []
      const candidates: QuestionFull[] = []
      const unitCount = 2 + Math.floor(rng() * 4) // 2..5 unit-candidates
      for (let u = 0; u < unitCount; u++) {
        const isGroup = rng() < 0.4
        const size = isGroup ? 4 : 1
        const vector: Partial<Record<Difficulty, number>> = {}
        const members: Difficulty[] = []
        for (let m = 0; m < size; m++) {
          const d = DIFFICULTIES[Math.floor(rng() * 3)]!
          vector[d] = (vector[d] ?? 0) + 1
          members.push(d)
        }
        specs.push({ size, vector })
        candidates.push(...(isGroup ? group("quant", members) : [standalone("quant", members[0]!)]))
      }

      // Build a target by summing a random subset of the generated unit-candidates, so it's
      // *sometimes* achievable and sometimes not (both outcomes matter for the property).
      const subsetMask = Math.floor(rng() * (1 << unitCount))
      let targetCount = 0
      const target: Partial<Record<Difficulty, number>> = {}
      for (let i = 0; i < unitCount; i++) {
        if (!(subsetMask & (1 << i))) continue
        targetCount += specs[i]!.size
        for (const [d, c] of Object.entries(specs[i]!.vector)) {
          target[d as Difficulty] = (target[d as Difficulty] ?? 0) + (c ?? 0)
        }
      }
      if (targetCount === 0) continue

      const expected = bruteForceExists(specs, target, targetCount)
      const result = selectExactDraw(candidates, target, targetCount, rng)

      expect(result.ok).toBe(expected)
      if (result.ok) {
        expect(result.questions).toHaveLength(targetCount)
        const actual: Partial<Record<Difficulty, number>> = {}
        for (const q of result.questions) actual[q.difficulty] = (actual[q.difficulty] ?? 0) + 1
        for (const d of DIFFICULTIES) {
          expect(actual[d] ?? 0).toBe(target[d] ?? 0)
        }
      }
    }
  })
})

// Regression coverage for the bug this module's set-based functions fix: an LRDI/VARC request of
// "1" used to mean "1 graded question" (failing outright for lr, or silently grabbing a lone
// standalone VA question for verbal) instead of "1 whole set".
describe("selectSetCountDraw — lr is always whole sets, never individual questions", () => {
  it("setCount=1 draws exactly one whole 4-question lrdi group", () => {
    const g = group("lr", ["easy", "medium", "hard", "hard"])
    const result = selectSetCountDraw(g, "lrdi", 1, NO_RANDOM)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.questions).toHaveLength(4)
    expect(result.units).toHaveLength(1)
    expect(result.units[0]).toMatchObject({ kind: "lrdi", questionPositions: [1, 2, 3, 4] })
  })

  it("fails rather than returning a partial set when no whole group exists", () => {
    const candidates = [standalone("lr", "easy")] // a stray standalone must never satisfy a set request
    const result = selectSetCountDraw(candidates, "lrdi", 1, NO_RANDOM)
    expect(result.ok).toBe(false)
  })

  it("fails when fewer sets exist than requested", () => {
    const g = group("lr", ["easy", "easy", "easy", "easy"])
    const result = selectSetCountDraw(g, "lrdi", 2, NO_RANDOM)
    expect(result.ok).toBe(false)
  })

  it("draws multiple whole sets without merging or splitting them", () => {
    const g1 = group("lr", ["easy", "easy", "easy", "easy"])
    const g2 = group("lr", ["hard", "hard", "hard", "hard", "hard"])
    const result = selectSetCountDraw([...g1, ...g2], "lrdi", 2, NO_RANDOM)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.questions).toHaveLength(9)
    expect(result.units).toHaveLength(2)
    expect(result.units.map((u) => u.questionPositions.length).sort()).toEqual([4, 5])
  })

  it("rejects setCount <= 0", () => {
    const g = group("lr", ["easy", "easy", "easy", "easy"])
    expect(selectSetCountDraw(g, "lrdi", 0, NO_RANDOM).ok).toBe(false)
  })
})

describe("selectVerbalDraw — RC passages and standalone VA questions are independent asks", () => {
  it("rcSetCount=1, standaloneCount=0 draws the whole RC passage, never a standalone instead", () => {
    const rc = group("verbal", ["easy", "easy", "medium", "medium"])
    const va = [standalone("verbal", "easy"), standalone("verbal", "medium")]
    const result = selectVerbalDraw([...rc, ...va], 1, {}, 0, NO_RANDOM)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.units).toHaveLength(1)
    expect(result.units[0]).toMatchObject({ kind: "rc" })
    expect(result.questions).toHaveLength(4)
  })

  it("rcSetCount=0, standaloneCount=1 draws exactly one standalone, never a whole passage instead", () => {
    const rc = group("verbal", ["easy", "easy", "medium", "medium"])
    const va = [standalone("verbal", "easy")]
    const result = selectVerbalDraw([...rc, ...va], 0, {}, 1, NO_RANDOM)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.units).toHaveLength(1)
    expect(result.units[0]).toMatchObject({ kind: "standalone" })
    expect(result.questions).toHaveLength(1)
  })

  it("combines a whole RC passage with standalone VA questions matching a difficulty mix", () => {
    const rc = group("verbal", ["easy", "easy", "medium", "medium"])
    const va = [standalone("verbal", "hard"), standalone("verbal", "hard")]
    const result = selectVerbalDraw([...rc, ...va], 1, { hard: 2 }, 2, NO_RANDOM)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.questions).toHaveLength(6)
    expect(result.units).toHaveLength(3) // 1 rc unit + 2 standalone units
    expect(result.units.filter((u) => u.kind === "rc")).toHaveLength(1)
    expect(result.units.filter((u) => u.kind === "standalone")).toHaveLength(2)
  })

  it("fails when fewer RC passages exist than requested, even if standalones could fill the gap", () => {
    const va = Array.from({ length: 4 }, () => standalone("verbal", "easy"))
    const result = selectVerbalDraw(va, 1, {}, 0, NO_RANDOM)
    expect(result.ok).toBe(false)
  })

  it("rejects rcSetCount=0 and standaloneCount=0 together", () => {
    const rc = group("verbal", ["easy", "easy", "medium", "medium"])
    const result = selectVerbalDraw(rc, 0, {}, 0, NO_RANDOM)
    expect(result.ok).toBe(false)
  })
})

describe("selectDraw — dispatches by DrawRequest.type", () => {
  it("quant delegates to the exact-vector draw", () => {
    const candidates = [standalone("quant", "easy"), standalone("quant", "easy")]
    const request: DrawRequest = { type: "quant", count: 2, difficultyMix: { easy: 2 }, topics: [] }
    const result = selectDraw(candidates, request, NO_RANDOM)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.questions).toHaveLength(2)
  })

  it("lr delegates to the whole-set draw", () => {
    const g = group("lr", ["easy", "easy", "easy", "easy"])
    const request: DrawRequest = { type: "lr", setCount: 1 }
    const result = selectDraw(g, request, NO_RANDOM)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.units[0]?.kind).toBe("lrdi")
  })

  it("verbal delegates to the mixed rc/standalone draw", () => {
    const rc = group("verbal", ["easy", "easy", "medium", "medium"])
    const request: DrawRequest = { type: "verbal", setCount: 1, standaloneCount: 0, standaloneDifficultyMix: {} }
    const result = selectDraw(rc, request, NO_RANDOM)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.units[0]?.kind).toBe("rc")
  })
})

describe("toBankFilters — topics scope quant's standalone draw only", () => {
  it("passes a quant request's topics through to the bank filters", () => {
    const request: DrawRequest = { type: "quant", count: 2, difficultyMix: { easy: 2 }, topics: ["Arithmetic"] }
    expect(toBankFilters(request)).toEqual({ type: "quant", difficultyMix: { easy: 2 }, count: 2, topics: ["Arithmetic"] })
  })

  it("forces topics to [] for lr and verbal, which never filter by topic", () => {
    expect(toBankFilters({ type: "lr", setCount: 1 }).topics).toEqual([])
    expect(
      toBankFilters({ type: "verbal", setCount: 1, standaloneCount: 0, standaloneDifficultyMix: {} }).topics
    ).toEqual([])
  })
})

describe("toStoredDrawRequest / fromStoredDrawRequest — topics round-trip", () => {
  it("stores and reconstructs a quant request's topics exactly", () => {
    const request: DrawRequest = { type: "quant", count: 2, difficultyMix: { easy: 2 }, topics: ["Arithmetic", "Algebra"] }
    const stored = toStoredDrawRequest(request)
    expect(stored.topics).toEqual(["Arithmetic", "Algebra"])
    expect(fromStoredDrawRequest("quant", stored)).toEqual(request)
  })

  it("stores [] for lr/verbal regardless of what's on the request", () => {
    expect(toStoredDrawRequest({ type: "lr", setCount: 1 }).topics).toEqual([])
    expect(
      toStoredDrawRequest({ type: "verbal", setCount: 1, standaloneCount: 0, standaloneDifficultyMix: {} }).topics
    ).toEqual([])
  })
})
