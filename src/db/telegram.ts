// telegram_posts table; TelegramContract — claimAndSend: insert status='pending' before the Bot API call (message_id/sent_at unknown until after), then update to 'sent' or 'failed' — TELEGRAM.md §6-7; CONTRACTS.md §6

import type { FailedTelegramPostRef, TelegramPostKind } from "../core/contracts"
import { SCHEDULER_DISCOVERY_LIMIT } from "../core/config"

type FailedPostRow = { quiz_id: string | null; week_start: string | null; kind: TelegramPostKind; claimed_at: number }

// Bounded, read-only, and safe: never returns the stored error text, message id, or destination —
// only enough identity for a failure alert to name what's stuck — SCHEDULER.md §"failure alerts".
export async function listFailedPosts(db: D1Database, limit: number): Promise<FailedTelegramPostRef[]> {
  const boundedLimit = Math.min(limit, SCHEDULER_DISCOVERY_LIMIT)
  const { results } = await db
    .prepare(
      `SELECT quiz_id, week_start, kind, claimed_at FROM telegram_posts
       WHERE status = 'failed'
       ORDER BY claimed_at ASC, rowid ASC LIMIT ?`
    )
    .bind(boundedLimit)
    .all<FailedPostRow>()

  return results.map((row) => ({ quizId: row.quiz_id, weekStart: row.week_start, kind: row.kind, claimedAt: row.claimed_at }))
}
