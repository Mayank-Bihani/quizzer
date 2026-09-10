// Pure per-quiz ranking by score DESC then summed reached-unit completion time ASC; exact ties
// share dense rank. Weekly boards rank total score across quizzes taken; exact totals share dense
// rank and quizzesTaken is display context only — QUIZZING.md §7.

import type { LeaderboardRowView } from "../core/api"

export type RankableParticipant = { userId: string; name: string; totalScore: number; totalTimeMs: number }
export type RankedParticipant = RankableParticipant & { rank: number }

// Score/time only decide rank; userId only stabilizes serialization among exact ties.
export function assignDenseRanks(participants: RankableParticipant[]): RankedParticipant[] {
  const sorted = [...participants].sort((a, b) => {
    if (a.totalScore !== b.totalScore) return b.totalScore - a.totalScore
    if (a.totalTimeMs !== b.totalTimeMs) return a.totalTimeMs - b.totalTimeMs
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0
  })

  const ranked: RankedParticipant[] = []
  let rank = 0
  let previous: RankableParticipant | null = null
  for (const participant of sorted) {
    if (!previous || previous.totalScore !== participant.totalScore || previous.totalTimeMs !== participant.totalTimeMs) {
      rank++
    }
    ranked.push({ ...participant, rank })
    previous = participant
  }
  return ranked
}

export type TopAndOwnSelection = { rows: LeaderboardRowView[]; truncated: boolean }

// Never the full board: top 10 plus the viewer's own row only when they're outside it.
export function selectTopAndOwn(ranked: RankedParticipant[], viewerId: string): TopAndOwnSelection {
  const top10 = ranked.slice(0, 10)
  const rows: LeaderboardRowView[] = top10.map((p) => ({
    rank: p.rank,
    userId: p.userId,
    name: p.name,
    score: p.totalScore,
    isOwnRow: p.userId === viewerId,
  }))

  if (!top10.some((p) => p.userId === viewerId)) {
    const viewer = ranked.find((p) => p.userId === viewerId)
    if (viewer) rows.push({ rank: viewer.rank, userId: viewer.userId, name: viewer.name, score: viewer.totalScore, isOwnRow: true })
  }

  return { rows, truncated: ranked.length > 10 }
}
