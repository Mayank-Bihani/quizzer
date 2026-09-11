// KV: jwks:*, role:<uid>, unit:<quizId>:<unitPosition> as redacted UnitContent only, board:<quizId|weekStart>. Personal clocks/drafts never in shared content; use fresh values directly on cache miss — MODULES.md.

import type { BoardSummary, UnitContent } from "../core/contracts"
import type { FullRankedBoard } from "../db/results"

function unitCacheKey(quizId: string, unitPosition: number): string {
  return `unit:${quizId}:${unitPosition}`
}

function isUnitContentShape(value: unknown): value is UnitContent {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.unitPosition === "number" &&
    typeof v.unitCount === "number" &&
    typeof v.questionCount === "number" &&
    typeof v.kind === "string" &&
    typeof v.timeLimitSec === "number" &&
    Array.isArray(v.questions)
  )
}

// A miss, a KV outage, or a corrupt stored value are all treated the same way: the caller falls
// back to the freshly constructed value already in memory. KV is acceleration, never authority.
export async function getCachedUnitContent(
  kv: KVNamespace,
  quizId: string,
  unitPosition: number
): Promise<UnitContent | null> {
  let raw: string | null
  try {
    raw = await kv.get(unitCacheKey(quizId, unitPosition))
  } catch {
    return null
  }
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isUnitContentShape(parsed) ? parsed : null
  } catch {
    return null
  }
}

// Rebuilds the payload field by field. `content` is typed UnitContent, but TypeScript's
// structural typing would silently accept a ServedUnit here too (it has every UnitContent field
// plus participant clocks) — spreading it would leak those clocks into shared KV. Never spread.
export async function putCachedUnitContent(
  kv: KVNamespace,
  quizId: string,
  unitPosition: number,
  content: UnitContent
): Promise<void> {
  const safe: UnitContent = {
    unitPosition: content.unitPosition,
    unitCount: content.unitCount,
    questionCount: content.questionCount,
    kind: content.kind,
    timeLimitSec: content.timeLimitSec,
    passage:
      content.passage === null
        ? null
        : { title: content.passage.title, bodyMd: content.passage.bodyMd, imageUrl: content.passage.imageUrl },
    questions: content.questions.map((q) => ({
      position: q.position,
      subPosition: q.subPosition,
      format: q.format,
      bodyMd: q.bodyMd,
      imageUrl: q.imageUrl,
      options: q.options === null ? null : ([q.options[0], q.options[1], q.options[2], q.options[3]] as [string, string, string, string]),
    })),
  }
  try {
    await kv.put(unitCacheKey(quizId, unitPosition), JSON.stringify(safe))
  } catch {
    // write failure is not fatal — caller already has `content` and serves it directly
  }
}

function boardCacheKey(quizId: string): string {
  return `board:${quizId}`
}

function isFullRankedBoardShape(value: unknown): value is FullRankedBoard {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.participantCount === "number" && typeof v.boardComputedAt === "number" && Array.isArray(v.ranked)
}

// Never the source of publication truth: only ever warmed from an already-committed D1 board
// (AC-7), and every read here still requires the caller to have independently checked
// board_computed_at against D1 — a stale or failed cache can never unlock or hide a real result.
export async function getCachedBoard(kv: KVNamespace, quizId: string): Promise<FullRankedBoard | null> {
  let raw: string | null
  try {
    raw = await kv.get(boardCacheKey(quizId))
  } catch {
    return null
  }
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isFullRankedBoardShape(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function putCachedBoard(kv: KVNamespace, quizId: string, board: FullRankedBoard): Promise<void> {
  const safe: FullRankedBoard = {
    participantCount: board.participantCount,
    boardComputedAt: board.boardComputedAt,
    ranked: board.ranked.map((r) => ({ userId: r.userId, name: r.name, totalScore: r.totalScore, totalTimeMs: r.totalTimeMs, rank: r.rank })),
  }
  try {
    await kv.put(boardCacheKey(quizId), JSON.stringify(safe))
  } catch {
    // write failure is not fatal — the committed D1 write already succeeded independently
  }
}

function weeklyBoardCacheKey(weekStart: string): string {
  return `board:${weekStart}`
}

function isBoardSummaryArrayShape(value: unknown): value is BoardSummary[] {
  if (!Array.isArray(value)) return false
  return value.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false
    const v = entry as Record<string, unknown>
    return typeof v.type === "string" && typeof v.weekStart === "string" && Array.isArray(v.top10)
  })
}

// A warm-only projection of an already-committed weekly publish — never consulted by the paginated
// read path (which needs an authoritative row count top10 alone cannot provide), only written here
// so the key exists for other/future consumers without risking a stale or truncated total.
export async function getCachedWeeklyBoard(kv: KVNamespace, weekStart: string): Promise<BoardSummary[] | null> {
  let raw: string | null
  try {
    raw = await kv.get(weeklyBoardCacheKey(weekStart))
  } catch {
    return null
  }
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isBoardSummaryArrayShape(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function putCachedWeeklyBoard(kv: KVNamespace, weekStart: string, boards: BoardSummary[]): Promise<void> {
  const safe: BoardSummary[] = boards.map((b) => ({
    type: b.type,
    weekStart: b.weekStart,
    top10: b.top10.map((r) => ({ rank: r.rank, userId: r.userId, name: r.name, totalScore: r.totalScore, quizzesTaken: r.quizzesTaken })),
  }))
  try {
    await kv.put(weeklyBoardCacheKey(weekStart), JSON.stringify(safe))
  } catch {
    // write failure is not fatal — the committed D1 publish already succeeded independently
  }
}
