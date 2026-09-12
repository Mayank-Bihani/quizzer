// Monthly readiness → aggregate → rank → publish → cache-warm pipeline, plus the read path behind
// GET /api/boards/monthly. Mirrors src/services/quiz-boards.ts's weekly pipeline exactly, reusing
// aggregateWeeklyScores (src/db/boards.ts) and assignWeeklyDenseRanks (src/core/leaderboard.ts)
// unmodified — both are already generic over any date range / any WeeklyRankable[] — QUIZZING.md §7.

import type { BoardSummary, QuizType, WeeklyBoardRow } from "../core/contracts"
import { assignWeeklyDenseRanks } from "../core/leaderboard"
import { monthBoundsForMonthStart } from "../core/schedule"
import { aggregateWeeklyScores } from "../db/boards"
import { getMonthlyBoardPage, getMostRecentlyPublishedMonthStart, isMonthReady, publishMonthlyBoards, type MonthlyBoardToPublish } from "../db/monthly-boards"
import { getCachedMonthlyBoard, putCachedMonthlyBoard } from "./cache"

export type MonthlyBoardsDeps = { db: D1Database; kv: KVNamespace }

const BOARD_TYPES: (QuizType | "overall")[] = ["verbal", "quant", "lr", "overall"]

// [] means the month is not ready; four entries (possibly with empty top10) mean published.
export async function computeMonthlyBoards(deps: MonthlyBoardsDeps, monthStart: string): Promise<BoardSummary[]> {
  const { startMs, endMs } = monthBoundsForMonthStart(monthStart)
  if (!(await isMonthReady(deps.db, startMs, endMs))) return []

  const boards: MonthlyBoardToPublish[] = []
  for (const type of BOARD_TYPES) {
    const rows = await aggregateWeeklyScores(deps.db, startMs, endMs, type)
    boards.push({ type, ranked: assignWeeklyDenseRanks(rows) })
  }

  await publishMonthlyBoards(deps.db, monthStart, boards)

  const summaries: BoardSummary[] = boards.map((board) => ({
    type: board.type,
    weekStart: monthStart,
    top10: board.ranked.slice(0, 10).map(
      (r): WeeklyBoardRow => ({ rank: r.rank, userId: r.userId, name: r.name, totalScore: r.totalScore, quizzesTaken: r.quizzesTaken })
    ),
  }))

  await putCachedMonthlyBoard(deps.kv, monthStart, summaries)
  return summaries
}

export type MonthlyBoardQuery = { monthStart?: string; type?: QuizType | "overall"; limit: number; offset: number }
export type MonthlyBoardPageResult = { items: WeeklyBoardRow[]; total: number; limit: number; offset: number; monthStart: string; type: QuizType | "overall" }

const CACHED_TOP10_LIMIT = 10

export async function getMonthlyBoard(deps: MonthlyBoardsDeps, query: MonthlyBoardQuery): Promise<MonthlyBoardPageResult> {
  const type = query.type ?? "overall"
  const monthStart = query.monthStart ?? (await getMostRecentlyPublishedMonthStart(deps.db))
  if (monthStart === null) {
    return { items: [], total: 0, limit: query.limit, offset: query.offset, monthStart: "", type }
  }

  if (query.offset === 0) {
    const cached = await getCachedMonthlyBoard(deps.kv, monthStart)
    const cachedBoard = cached?.find((b) => b.type === type)
    // Only trustworthy when top10 provably holds the entire board — fewer than 10 rows means
    // nothing exists beyond it; a full 10 could be hiding more that top10 alone can't reveal.
    if (cachedBoard && cachedBoard.top10.length < CACHED_TOP10_LIMIT) {
      return { items: cachedBoard.top10.slice(0, query.limit), total: cachedBoard.top10.length, limit: query.limit, offset: query.offset, monthStart, type }
    }
  }

  const { items, total } = await getMonthlyBoardPage(deps.db, monthStart, type, query.limit, query.offset)
  return { items, total, limit: query.limit, offset: query.offset, monthStart, type }
}
