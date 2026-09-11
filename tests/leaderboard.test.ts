import { describe, expect, it } from "vitest"
import { assignDenseRanks, assignWeeklyDenseRanks, selectTopAndOwn, type RankableParticipant, type WeeklyRankable } from "../src/core/leaderboard"

function participant(userId: string, totalScore: number, totalTimeMs: number, name = `Name-${userId}`): RankableParticipant {
  return { userId, name, totalScore, totalTimeMs }
}

describe("assignDenseRanks", () => {
  it("returns an empty array for an empty board", () => {
    expect(assignDenseRanks([])).toEqual([])
  })

  it("ranks a single participant as rank 1", () => {
    const ranked = assignDenseRanks([participant("u1", 10, 1000)])
    expect(ranked).toEqual([{ userId: "u1", name: "Name-u1", totalScore: 10, totalTimeMs: 1000, rank: 1 }])
  })

  it("orders strictly by score descending when scores differ", () => {
    const ranked = assignDenseRanks([participant("u1", 5, 1000), participant("u2", 10, 1000), participant("u3", 7, 1000)])
    expect(ranked.map((p) => [p.userId, p.rank])).toEqual([
      ["u2", 1],
      ["u3", 2],
      ["u1", 3],
    ])
  })

  it("breaks a score tie by time ascending", () => {
    const ranked = assignDenseRanks([participant("u1", 10, 5000), participant("u2", 10, 2000), participant("u3", 10, 8000)])
    expect(ranked.map((p) => [p.userId, p.rank])).toEqual([
      ["u2", 1],
      ["u1", 2],
      ["u3", 3],
    ])
  })

  it("gives an exact score+time tie the same dense rank, leaving no gap for the next distinct value", () => {
    const ranked = assignDenseRanks([participant("u1", 10, 1000), participant("u2", 10, 1000), participant("u3", 8, 500)])
    const byId = Object.fromEntries(ranked.map((p) => [p.userId, p.rank]))
    expect(byId.u1).toBe(byId.u2)
    expect(byId.u1).toBe(1)
    expect(byId.u3).toBe(2) // dense: no gap left for the tied pair occupying "1"
  })

  it("handles negative and fractional scores using the same ordering rule", () => {
    const ranked = assignDenseRanks([participant("u1", -1, 1000), participant("u2", 2.5, 1000), participant("u3", -0.5, 1000)])
    expect(ranked.map((p) => p.userId)).toEqual(["u2", "u3", "u1"])
  })

  it("stabilizes serialization among exact ties without changing the rank value", () => {
    const a = assignDenseRanks([participant("zeta", 10, 1000), participant("alpha", 10, 1000)])
    const b = assignDenseRanks([participant("alpha", 10, 1000), participant("zeta", 10, 1000)])
    expect(a.map((p) => p.userId)).toEqual(b.map((p) => p.userId)) // deterministic order regardless of input order
    expect(a.every((p) => p.rank === 1)).toBe(true)
  })

  it("never changes rank based on name, or any field outside score/time", () => {
    const ranked = assignDenseRanks([participant("u1", 10, 1000, "Zzz"), participant("u2", 10, 1000, "Aaa")])
    expect(ranked[0]?.rank).toBe(1)
    expect(ranked[1]?.rank).toBe(1)
  })
})

describe("selectTopAndOwn", () => {
  function board(size: number): RankableParticipant[] {
    return Array.from({ length: size }, (_, i) => participant(`u${i + 1}`, size - i, 1000))
  }

  it("returns every row with truncated=false when the board has 10 or fewer participants", () => {
    const ranked = assignDenseRanks(board(5))
    const { rows, truncated } = selectTopAndOwn(ranked, "u3")
    expect(rows).toHaveLength(5)
    expect(truncated).toBe(false)
    expect(rows.find((r) => r.userId === "u3")?.isOwnRow).toBe(true)
    expect(rows.filter((r) => r.isOwnRow)).toHaveLength(1)
  })

  it("truncates to top 10 and appends the viewer's own row when they're outside it", () => {
    const ranked = assignDenseRanks(board(15))
    const { rows, truncated } = selectTopAndOwn(ranked, "u12")
    expect(truncated).toBe(true)
    expect(rows).toHaveLength(11) // top 10 + own row
    expect(rows.slice(0, 10).every((r) => r.rank <= 10)).toBe(true)
    const ownRow = rows.at(-1)
    expect(ownRow?.userId).toBe("u12")
    expect(ownRow?.isOwnRow).toBe(true)
    expect(rows.slice(0, 10).every((r) => !r.isOwnRow)).toBe(true)
  })

  it("does not duplicate the viewer's row when they're already inside the top 10", () => {
    const ranked = assignDenseRanks(board(15))
    const { rows, truncated } = selectTopAndOwn(ranked, "u3")
    expect(truncated).toBe(true)
    expect(rows).toHaveLength(10)
    expect(rows.filter((r) => r.isOwnRow)).toHaveLength(1)
    expect(rows.find((r) => r.isOwnRow)?.userId).toBe("u3")
  })

  it("marks isOwnRow false throughout when the viewer is not present in the ranked list", () => {
    const ranked = assignDenseRanks(board(3))
    const { rows } = selectTopAndOwn(ranked, "unknown-user")
    expect(rows.every((r) => !r.isOwnRow)).toBe(true)
    expect(rows).toHaveLength(3)
  })
})

function weeklyRow(userId: string, totalScore: number, quizzesTaken: number, name = `Name-${userId}`): WeeklyRankable {
  return { userId, name, totalScore, quizzesTaken }
}

describe("assignWeeklyDenseRanks — single-key, score DESC only", () => {
  it("returns an empty array for an empty board", () => {
    expect(assignWeeklyDenseRanks([])).toEqual([])
  })

  it("orders strictly by totalScore descending", () => {
    const ranked = assignWeeklyDenseRanks([weeklyRow("u1", 5, 1), weeklyRow("u2", 10, 3), weeklyRow("u3", 7, 2)])
    expect(ranked.map((r) => [r.userId, r.rank])).toEqual([
      ["u2", 1],
      ["u3", 2],
      ["u1", 3],
    ])
  })

  it("gives an exact score tie the same dense rank regardless of quizzesTaken, leaving no gap", () => {
    const ranked = assignWeeklyDenseRanks([weeklyRow("u1", 10, 5), weeklyRow("u2", 10, 1), weeklyRow("u3", 8, 9)])
    const byId = Object.fromEntries(ranked.map((r) => [r.userId, r.rank]))
    expect(byId.u1).toBe(byId.u2)
    expect(byId.u1).toBe(1)
    expect(byId.u3).toBe(2)
  })

  it("never lets quizzesTaken break a tie or influence ordering", () => {
    const ranked = assignWeeklyDenseRanks([weeklyRow("u1", 10, 1), weeklyRow("u2", 10, 100)])
    expect(ranked.every((r) => r.rank === 1)).toBe(true)
  })

  it("preserves quizzesTaken as display context only, unchanged by ranking", () => {
    const ranked = assignWeeklyDenseRanks([weeklyRow("u1", 10, 4)])
    expect(ranked[0]?.quizzesTaken).toBe(4)
  })

  it("stabilizes serialization among exact ties without changing the rank value", () => {
    const a = assignWeeklyDenseRanks([weeklyRow("zeta", 10, 1), weeklyRow("alpha", 10, 1)])
    const b = assignWeeklyDenseRanks([weeklyRow("alpha", 10, 1), weeklyRow("zeta", 10, 1)])
    expect(a.map((r) => r.userId)).toEqual(b.map((r) => r.userId))
    expect(a.every((r) => r.rank === 1)).toBe(true)
  })
})
