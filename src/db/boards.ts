// weekly_boards table — ranks by SUM of total_score per type + overall, republish cleanly
// replaces by (week_start, type) rather than appending; week_start is the Monday of the IST week
// — QUIZZING.md §7, §9; SCHEDULER.md §3, §4.3, §6; CONTRACTS.md §5

import type { QuizType } from "../core/contracts"
import type { WeeklyRanked, WeeklyRankable } from "../core/leaderboard"

export async function isWeekReady(db: D1Database, startMs: number, endMs: number): Promise<boolean> {
  const blocking = await db
    .prepare(`SELECT 1 FROM quizzes WHERE scheduled_at >= ? AND scheduled_at < ? AND status IN ('scheduled', 'open') LIMIT 1`)
    .bind(startMs, endMs)
    .first()
  return blocking === null
}

export async function aggregateWeeklyScores(db: D1Database, startMs: number, endMs: number, type: QuizType | "overall"): Promise<WeeklyRankable[]> {
  const typeFilter = type === "overall" ? "" : "AND q.type = ?"
  const binds: (number | string)[] = type === "overall" ? [startMs, endMs] : [startMs, endMs, type]
  const { results } = await db
    .prepare(
      `SELECT u.id AS user_id, u.name AS name, SUM(p.total_score) AS total_score, COUNT(*) AS quizzes_taken
       FROM participants p
       JOIN quizzes q ON q.id = p.quiz_id
       JOIN users u ON u.id = p.user_id
       WHERE q.scheduled_at >= ? AND q.scheduled_at < ? AND q.status = 'ended' ${typeFilter}
       GROUP BY u.id, u.name`
    )
    .bind(...binds)
    .all<{ user_id: string; name: string; total_score: number; quizzes_taken: number }>()
  return results.map((r) => ({ userId: r.user_id, name: r.name, totalScore: r.total_score, quizzesTaken: r.quizzes_taken }))
}

export type WeeklyBoardToPublish = { type: QuizType | "overall"; ranked: WeeklyRanked[] }

// Deletes the prior (week_start, type) rows before inserting the fresh set, in the same batch —
// a re-run cleanly replaces stale ranks/rows rather than appending duplicates.
export async function publishWeeklyBoards(db: D1Database, weekStart: string, boards: WeeklyBoardToPublish[]): Promise<void> {
  const statements: D1PreparedStatement[] = []
  for (const board of boards) {
    statements.push(db.prepare("DELETE FROM weekly_boards WHERE week_start = ? AND type = ?").bind(weekStart, board.type))
    for (const row of board.ranked) {
      statements.push(
        db
          .prepare("INSERT INTO weekly_boards (week_start, type, user_id, quizzes_taken, total_score, rank) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(weekStart, board.type, row.userId, row.quizzesTaken, row.totalScore, row.rank)
      )
    }
  }
  if (statements.length > 0) await db.batch(statements)
}

export async function getMostRecentlyPublishedWeekStart(db: D1Database): Promise<string | null> {
  const row = await db.prepare("SELECT MAX(week_start) AS week_start FROM weekly_boards").first<{ week_start: string | null }>()
  return row?.week_start ?? null
}

export type WeeklyBoardRowRead = { rank: number; userId: string; name: string; totalScore: number; quizzesTaken: number }

export async function getWeeklyBoardPage(
  db: D1Database,
  weekStart: string,
  type: QuizType | "overall",
  limit: number,
  offset: number
): Promise<{ items: WeeklyBoardRowRead[]; total: number }> {
  const totalRow = await db.prepare("SELECT COUNT(*) AS n FROM weekly_boards WHERE week_start = ? AND type = ?").bind(weekStart, type).first<{ n: number }>()
  const { results } = await db
    .prepare(
      `SELECT wb.rank, wb.user_id, u.name, wb.total_score, wb.quizzes_taken
       FROM weekly_boards wb
       JOIN users u ON u.id = wb.user_id
       WHERE wb.week_start = ? AND wb.type = ?
       ORDER BY wb.rank ASC, wb.user_id ASC
       LIMIT ? OFFSET ?`
    )
    .bind(weekStart, type, limit, offset)
    .all<{ rank: number; user_id: string; name: string; total_score: number; quizzes_taken: number }>()
  return {
    items: results.map((r) => ({ rank: r.rank, userId: r.user_id, name: r.name, totalScore: r.total_score, quizzesTaken: r.quizzes_taken })),
    total: totalRow?.n ?? 0,
  }
}
