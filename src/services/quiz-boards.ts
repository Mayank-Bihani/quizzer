// Weekly readiness → aggregate → rank → publish → cache-warm pipeline, plus the read path behind
// GET /api/boards/weekly — QUIZZING.md §7; SCHEDULER.md §4.3

import type { BoardSummary, QuizType, WeeklyBoardRow } from "../core/contracts"
import { assignWeeklyDenseRanks } from "../core/leaderboard"
import { weekBoundsForWeekStart } from "../core/schedule"
import { aggregateWeeklyScores, getMostRecentlyPublishedWeekStart, getWeeklyBoardPage, isWeekReady, publishWeeklyBoards, type WeeklyBoardToPublish } from "../db/boards"
import { getCachedWeeklyBoard, putCachedWeeklyBoard } from "./cache"

export type WeeklyBoardsDeps = { db: D1Database; kv: KVNamespace }

const BOARD_TYPES: (QuizType | "overall")[] = ["verbal", "quant", "lr", "overall"]

// [] means the week is not ready; four entries (possibly with empty top10) mean published.
export async function computeWeeklyBoards(deps: WeeklyBoardsDeps, weekStart: string): Promise<BoardSummary[]> {
  const { startMs, endMs } = weekBoundsForWeekStart(weekStart)
  if (!(await isWeekReady(deps.db, startMs, endMs))) return []

  const boards: WeeklyBoardToPublish[] = []
  for (const type of BOARD_TYPES) {
    const rows = await aggregateWeeklyScores(deps.db, startMs, endMs, type)
    boards.push({ type, ranked: assignWeeklyDenseRanks(rows) })
  }

  await publishWeeklyBoards(deps.db, weekStart, boards)

  const summaries: BoardSummary[] = boards.map((board) => ({
    type: board.type,
    weekStart,
    top10: board.ranked.slice(0, 10).map(
      (r): WeeklyBoardRow => ({ rank: r.rank, userId: r.userId, name: r.name, totalScore: r.totalScore, quizzesTaken: r.quizzesTaken })
    ),
  }))

  await putCachedWeeklyBoard(deps.kv, weekStart, summaries)
  return summaries
}

export type WeeklyBoardQuery = { weekStart?: string; type?: QuizType | "overall"; limit: number; offset: number }
export type WeeklyBoardPageResult = { items: WeeklyBoardRow[]; total: number; limit: number; offset: number; weekStart: string; type: QuizType | "overall" }

const CACHED_TOP10_LIMIT = 10

export async function getWeeklyBoard(deps: WeeklyBoardsDeps, query: WeeklyBoardQuery): Promise<WeeklyBoardPageResult> {
  const type = query.type ?? "overall"
  const weekStart = query.weekStart ?? (await getMostRecentlyPublishedWeekStart(deps.db))
  if (weekStart === null) {
    return { items: [], total: 0, limit: query.limit, offset: query.offset, weekStart: "", type }
  }

  if (query.offset === 0) {
    const cached = await getCachedWeeklyBoard(deps.kv, weekStart)
    const cachedBoard = cached?.find((b) => b.type === type)
    // Only trustworthy when top10 provably holds the entire board — fewer than 10 rows means
    // nothing exists beyond it; a full 10 could be hiding more that top10 alone can't reveal.
    if (cachedBoard && cachedBoard.top10.length < CACHED_TOP10_LIMIT) {
      return { items: cachedBoard.top10.slice(0, query.limit), total: cachedBoard.top10.length, limit: query.limit, offset: query.offset, weekStart, type }
    }
  }

  const { items, total } = await getWeeklyBoardPage(deps.db, weekStart, type, query.limit, query.offset)
  return { items, total, limit: query.limit, offset: query.offset, weekStart, type }
}
