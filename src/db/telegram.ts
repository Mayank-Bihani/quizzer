// telegram_posts table; TelegramContract — claimAndSend: insert status='pending' before the Bot API call (message_id/sent_at unknown until after), then update to 'sent' or 'failed' — TELEGRAM.md §6-7; CONTRACTS.md §6

import type { BoardSummary, CancelledPayload, ClaimAndSendResult, CloseResult, FailedTelegramPostRef, QuizAnnouncePayload, QuizType, TelegramContract, TelegramPayload, TelegramPostKind } from "../core/contracts"
import { renderCancelled, renderQuizAnnounce, renderQuizResult, renderRoomOpen, renderStartingSoon, renderWeeklyBoards } from "../core/telegram-render"
import type { BotApiClient } from "../services/telegram"
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

// ============================================================================
// claimAndSend — AC-6/AC-7
// ============================================================================

const WEEKLY_SECTION_ORDER: (QuizType | "overall")[] = ["verbal", "quant", "lr", "overall"]

async function claimRow(db: D1Database, quizId: string | null, weekStart: string | null, kind: TelegramPostKind, now: number): Promise<boolean> {
  const result = await db
    .prepare(`INSERT INTO telegram_posts (quiz_id, kind, week_start, status, claimed_at) VALUES (?, ?, ?, 'pending', ?) ON CONFLICT DO NOTHING`)
    .bind(quizId, kind, weekStart, now)
    .run()
  return result.meta.changes === 1
}

async function markSent(db: D1Database, quizId: string | null, weekStart: string | null, kind: TelegramPostKind, messageId: string, now: number): Promise<void> {
  await db
    .prepare(`UPDATE telegram_posts SET status = 'sent', message_id = ?, sent_at = ? WHERE quiz_id IS ? AND week_start IS ? AND kind = ?`)
    .bind(messageId, now, quizId, weekStart, kind)
    .run()
}

async function markFailed(db: D1Database, quizId: string | null, weekStart: string | null, kind: TelegramPostKind, error: string): Promise<void> {
  await db
    .prepare(`UPDATE telegram_posts SET status = 'failed', error = ? WHERE quiz_id IS ? AND week_start IS ? AND kind = ?`)
    .bind(error, quizId, weekStart, kind)
    .run()
}

async function hasOpenPostSent(db: D1Database, quizId: string): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 FROM telegram_posts WHERE quiz_id = ? AND kind = 'open' AND status = 'sent'`).bind(quizId).first()
  return row !== null
}

function renderSingle(kind: Exclude<TelegramPostKind, "weekly">, payload: TelegramPayload): string {
  if (kind === "announce") return renderQuizAnnounce(payload as QuizAnnouncePayload)
  if (kind === "soon") return renderStartingSoon(payload as QuizAnnouncePayload)
  if (kind === "open") return renderRoomOpen(payload as QuizAnnouncePayload)
  if (kind === "result") return renderQuizResult(payload as CloseResult)
  return renderCancelled(payload as CancelledPayload)
}

async function sendWeekly(db: D1Database, bot: BotApiClient, chatId: string, weekStart: string, boards: BoardSummary[], now: number): Promise<ClaimAndSendResult> {
  const sections = renderWeeklyBoards(boards)
  const messageIds: Partial<Record<QuizType | "overall", string>> = {}
  for (const section of sections) {
    const result = await bot.sendMessage(chatId, section.text)
    if (!result.ok) {
      await markFailed(db, null, weekStart, "weekly", `section '${section.type}' failed: ${result.error}`)
      return { sent: false, skipped: false }
    }
    messageIds[section.type] = result.messageId
  }
  await markSent(db, null, weekStart, "weekly", JSON.stringify(messageIds), now)
  return { sent: true, skipped: false }
}

export async function claimAndSend(
  db: D1Database,
  bot: BotApiClient,
  chatId: string,
  kind: TelegramPostKind,
  target: { quizId: string } | { weekStart: string },
  payload: TelegramPayload,
  now: number
): Promise<ClaimAndSendResult> {
  const quizId = "quizId" in target ? target.quizId : null
  const weekStart = "weekStart" in target ? target.weekStart : null

  if (kind === "cancelled") {
    if (quizId === null) throw new Error("telegram invariant: cancelled kind requires a quizId target")
    if (!(await hasOpenPostSent(db, quizId))) return { sent: false, skipped: true } // silent — no insert, no send
  }

  const claimed = await claimRow(db, quizId, weekStart, kind, now)
  if (!claimed) return { sent: false, skipped: true }

  if (kind === "weekly") {
    if (weekStart === null) throw new Error("telegram invariant: weekly kind requires a weekStart target")
    return sendWeekly(db, bot, chatId, weekStart, payload as BoardSummary[], now)
  }

  const text = renderSingle(kind, payload)
  const result = await bot.sendMessage(chatId, text)
  if (!result.ok) {
    await markFailed(db, quizId, weekStart, kind, result.error)
    return { sent: false, skipped: false }
  }
  await markSent(db, quizId, weekStart, kind, result.messageId, now)
  return { sent: true, skipped: false }
}

export function createTelegramContract(db: D1Database, bot: BotApiClient, chatId: string, now: () => number = Date.now): TelegramContract {
  return {
    listFailedPosts: (limit) => listFailedPosts(db, limit),
    claimAndSend: (kind, target, payload) => claimAndSend(db, bot, chatId, kind, target, payload, now()),
  }
}
