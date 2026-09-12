// monthly_boards table — mirrors src/db/boards.ts's weekly pipeline exactly (same rank-by-SUM,
// republish-cleanly-replaces-by-(month_start,type) semantics), substituting month_start for
// week_start. Reuses aggregateWeeklyScores/WeeklyRankable/WeeklyRanked unmodified — they are
// already generic over startMs/endMs/type — QUIZZING.md §7, §9; SCHEDULER.md §3, §4.3, §6.

import type { QuizType } from "../core/contracts"
import type { WeeklyRanked } from "../core/leaderboard"

export async function isMonthReady(db: D1Database, startMs: number, endMs: number): Promise<boolean> {
  const blocking = await db
    .prepare(`SELECT 1 FROM quizzes WHERE scheduled_at >= ? AND scheduled_at < ? AND status IN ('scheduled', 'open') LIMIT 1`)
    .bind(startMs, endMs)
    .first()
  return blocking === null
}

export type MonthlyBoardToPublish = { type: QuizType | "overall"; ranked: WeeklyRanked[] }

// Deletes the prior (month_start, type) rows before inserting the fresh set, in the same batch —
// a re-run cleanly replaces stale ranks/rows rather than appending duplicates.
export async function publishMonthlyBoards(db: D1Database, monthStart: string, boards: MonthlyBoardToPublish[]): Promise<void> {
  const statements: D1PreparedStatement[] = []
  for (const board of boards) {
    statements.push(db.prepare("DELETE FROM monthly_boards WHERE month_start = ? AND type = ?").bind(monthStart, board.type))
    for (const row of board.ranked) {
      statements.push(
        db
          .prepare("INSERT INTO monthly_boards (month_start, type, user_id, quizzes_taken, total_score, rank) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(monthStart, board.type, row.userId, row.quizzesTaken, row.totalScore, row.rank)
      )
    }
  }
  if (statements.length > 0) await db.batch(statements)
}

export async function getMostRecentlyPublishedMonthStart(db: D1Database): Promise<string | null> {
  const row = await db.prepare("SELECT MAX(month_start) AS month_start FROM monthly_boards").first<{ month_start: string | null }>()
  return row?.month_start ?? null
}

export type MonthlyBoardRowRead = { rank: number; userId: string; name: string; totalScore: number; quizzesTaken: number }

export async function getMonthlyBoardPage(
  db: D1Database,
  monthStart: string,
  type: QuizType | "overall",
  limit: number,
  offset: number
): Promise<{ items: MonthlyBoardRowRead[]; total: number }> {
  const totalRow = await db.prepare("SELECT COUNT(*) AS n FROM monthly_boards WHERE month_start = ? AND type = ?").bind(monthStart, type).first<{ n: number }>()
  const { results } = await db
    .prepare(
      `SELECT mb.rank, mb.user_id, u.name, mb.total_score, mb.quizzes_taken
       FROM monthly_boards mb
       JOIN users u ON u.id = mb.user_id
       WHERE mb.month_start = ? AND mb.type = ?
       ORDER BY mb.rank ASC, mb.user_id ASC
       LIMIT ? OFFSET ?`
    )
    .bind(monthStart, type, limit, offset)
    .all<{ rank: number; user_id: string; name: string; total_score: number; quizzes_taken: number }>()
  return {
    items: results.map((r) => ({ rank: r.rank, userId: r.user_id, name: r.name, totalScore: r.total_score, quizzesTaken: r.quizzes_taken })),
    total: totalRow?.n ?? 0,
  }
}
