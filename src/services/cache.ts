// KV: jwks:*, role:<uid>, unit:<quizId>:<unitPosition> as redacted UnitContent only, board:<quizId|weekStart>. Personal clocks/drafts never in shared content; use fresh values directly on cache miss — MODULES.md.

import type { UnitContent } from "../core/contracts"

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
