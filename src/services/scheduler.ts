// SCHEDULER: bounded prepare pass, typed-but-unwired close pass, and dual-channel failure
// alerts. Issues no SQL/KV itself — every read/write goes through the injected QUIZZING/TELEGRAM
// seams — SCHEDULER.md §4.1; CONTRACTS.md §5; src/core/contracts.ts:125-181.

import type {
  BoardSummary,
  CancelledPayload,
  CloseResult,
  DueAnnounceQuiz,
  DueCloseQuiz,
  FailedTelegramPostRef,
  MaterializationFailure,
  MaterializeResult,
  OpenResult,
  QuizAnnouncePayload,
  TelegramContract,
} from "../core/contracts"
import { CLOSE_ALERT_DELAY_MS, MATERIALIZE_LOOKAHEAD_DAYS, MONTHLY_RETRY_LOOKBACK_MONTHS, SCHEDULER_DISCOVERY_LIMIT, WEEKLY_RETRY_LOOKBACK_WEEKS } from "../core/config"
import { monthStartOffsetBy, weekStartOffsetBy } from "../core/schedule"
import { sendFailureAlert, type EmailSender, type TelegramSender } from "./observability"

export type SchedulerDeps = {
  listDuePrepare: (now: number, limit: number) => Promise<string[]>
  openRoom: (quizId: string, now: number) => Promise<OpenResult>
  listDueClose: (now: number, limit: number) => Promise<DueCloseQuiz[]>
  listFailedPosts: (limit: number) => Promise<FailedTelegramPostRef[]>
  telegram: TelegramSender | null
  email: EmailSender | null
  alertChatId: string | null
  alertEmailAddress: string | null
  now: () => number
}

function logPassFailure(pass: string, id: string, err: unknown): void {
  console.error(`scheduler ${pass} pass failed`, id, err instanceof Error ? err.name : typeof err)
}

// AC-17: calls openRoom for every ID discovered by listDuePrepare(now,100). One failing
// candidate never blocks the rest.
export async function runPreparePass(deps: Pick<SchedulerDeps, "listDuePrepare" | "openRoom" | "now">): Promise<{ attempted: number; failed: number }> {
  const now = deps.now()
  const ids = await deps.listDuePrepare(now, SCHEDULER_DISCOVERY_LIMIT)
  let failed = 0
  for (const id of ids) {
    try {
      await deps.openRoom(id, now)
    } catch (err) {
      failed++
      logPassFailure("prepare", id, err)
    }
  }
  return { attempted: ids.length, failed }
}

// Typed but never production-wired in Sprint 4: Sprint 5 supplies the real atomic closeQuiz.
// Kept here, tested, and callable so index.ts's composition seam is exercised without granting
// production traffic access to whole-quiz settlement ahead of its own packet.
export async function runClosePass(
  deps: Pick<SchedulerDeps, "listDueClose" | "now">,
  closeQuiz: (quizId: string, now: number) => Promise<CloseResult>
): Promise<{ attempted: number; failed: number }> {
  const now = deps.now()
  const due = await deps.listDueClose(now, SCHEDULER_DISCOVERY_LIMIT)
  let failed = 0
  for (const item of due) {
    try {
      await closeQuiz(item.quizId, now)
    } catch (err) {
      failed++
      logPassFailure("close", item.quizId, err)
    }
  }
  return { attempted: due.length, failed }
}

// AC-18: fires once a due close has sat unresolved for CLOSE_ALERT_DELAY_MS, and once per still-
// failed Telegram post, every minute this keeps being true. Never gates prepare/join/submit.
export async function runFailureAlertsPass(deps: SchedulerDeps): Promise<{ closeAlerts: number; postAlerts: number }> {
  const now = deps.now()
  const alertDeps = { telegram: deps.telegram, email: deps.email, alertChatId: deps.alertChatId, alertEmailAddress: deps.alertEmailAddress }

  const dueClose = await deps.listDueClose(now, SCHEDULER_DISCOVERY_LIMIT)
  let closeAlerts = 0
  for (const item of dueClose) {
    if (now < item.safeCloseAt + CLOSE_ALERT_DELAY_MS) continue
    try {
      await sendFailureAlert(alertDeps, { category: "close_overdue", quizId: item.quizId, safeCloseAt: item.safeCloseAt })
    } catch (err) {
      logPassFailure("close-alert", item.quizId, err)
    }
    closeAlerts++
  }

  const failedPosts = await deps.listFailedPosts(SCHEDULER_DISCOVERY_LIMIT)
  let postAlerts = 0
  for (const post of failedPosts) {
    const identity = post.quizId ?? post.weekStart ?? "unknown"
    try {
      await sendFailureAlert(alertDeps, { category: "telegram_post_failed", quizId: post.quizId, weekStart: post.weekStart, kind: post.kind, claimedAt: post.claimedAt })
    } catch (err) {
      logPassFailure("post-alert", identity, err)
    }
    postAlerts++
  }

  return { closeAlerts, postAlerts }
}

// ============================================================================
// Telegram hook bodies — this file (and index.ts) are the only places TelegramContract,
// src/db/telegram.ts, or src/services/telegram.ts may be imported (AC-13). quiz-results.ts and
// quiz-creation.ts depend only on the locally-typed callback signatures.
// ============================================================================

export function createOnQuizClosed(telegram: TelegramContract): (quizId: string, result: CloseResult) => Promise<void> {
  return async (quizId, result) => {
    await telegram.claimAndSend("result", { quizId }, result)
  }
}

export function createOnQuizCancelled(telegram: TelegramContract): (quizId: string, payload: CancelledPayload) => Promise<void> {
  return async (quizId, payload) => {
    await telegram.claimAndSend("cancelled", { quizId }, payload)
  }
}

// AC-15: mirrors the already-bound Close pass's shape (bounded limit 100, per-candidate
// isolation). Production-bound in index.ts's minute tick — unlike the weekly pass below, this one
// has no unresolved upstream dependency left.
export async function runAnnouncePass(
  deps: { listDueAnnounce: (now: number, limit: number) => Promise<DueAnnounceQuiz[]>; now: () => number },
  telegram: TelegramContract
): Promise<{ attempted: number; failed: number }> {
  const now = deps.now()
  const due = await deps.listDueAnnounce(now, SCHEDULER_DISCOVERY_LIMIT)
  let failed = 0
  for (const entry of due) {
    // Explicit construction, not a forward of the wider DueAnnounceQuiz object: it carries
    // quizId/kind, two fields TelegramPayload doesn't have (CONTRACTS.md's explicit-DTO rule).
    const { quizId, kind, ...rest } = entry
    const payload: QuizAnnouncePayload = rest
    try {
      await telegram.claimAndSend(kind, { quizId }, payload)
    } catch (err) {
      failed++
      logPassFailure("announce", quizId, err)
    }
  }
  return { attempted: due.length, failed }
}

// Fallback trigger for the cancelled kind — see db/quizzes.ts's listDueCancelledNotifications for
// why this exists alongside (not instead of) quiz-creation.ts's onQuizCancelled callback.
// Production-bound alongside the Announce pass; claimAndSend's own silent/notify check makes a
// duplicate/racing candidate here harmless.
export async function runCancelledNotifyPass(
  deps: { listDueCancelledNotifications: (limit: number) => Promise<{ quizId: string; title: string; scheduledAt: number }[]> },
  telegram: TelegramContract
): Promise<{ attempted: number; failed: number }> {
  const due = await deps.listDueCancelledNotifications(SCHEDULER_DISCOVERY_LIMIT)
  let failed = 0
  for (const entry of due) {
    try {
      await telegram.claimAndSend("cancelled", { quizId: entry.quizId }, { title: entry.title, scheduledAt: entry.scheduledAt })
    } catch (err) {
      failed++
      logPassFailure("cancelled-notify", entry.quizId, err)
    }
  }
  return { attempted: due.length, failed }
}

// Typed but never production-wired in Sprint 6: Sprint 7 supplies the real computeWeeklyBoards
// and binds this into the `0 19 * * SUN` cron trigger. Kept here and tested so the composition
// seam is exercised without granting production traffic access to an unimplemented dependency —
// mirrors the Sprint 4→5 close-pass handoff shape.
export async function runWeeklyPass(
  computeWeeklyBoards: (weekStart: string) => Promise<BoardSummary[]>,
  weekStart: string,
  telegram: TelegramContract
): Promise<{ sent: boolean }> {
  const boards = await computeWeeklyBoards(weekStart)
  if (boards.length === 0) return { sent: false } // week not ready yet — SCHEDULER.md §"weekly"
  await telegram.claimAndSend("weekly", { weekStart }, boards)
  return { sent: true }
}

// AC-14's bounded weekly-retry sweep: the current (most recently elapsed) week plus
// WEEKLY_RETRY_LOOKBACK_WEEKS-1 prior weeks, each attempted through the same runWeeklyPass this
// file already built for the Monday trigger — never a second claimAndSend loop. Every candidate
// week is isolated: one failing week never blocks another, mirroring listDueClose's per-item
// isolation from Sprint 4.
export async function runWeeklyRetrySweep(
  computeWeeklyBoards: (weekStart: string) => Promise<BoardSummary[]>,
  currentWeekStart: string,
  telegram: TelegramContract
): Promise<{ attempted: number; sent: number }> {
  let sent = 0
  for (let weeksBack = 0; weeksBack < WEEKLY_RETRY_LOOKBACK_WEEKS; weeksBack++) {
    const weekStart = weekStartOffsetBy(currentWeekStart, weeksBack)
    try {
      const outcome = await runWeeklyPass(computeWeeklyBoards, weekStart, telegram)
      if (outcome.sent) sent++
    } catch (err) {
      logPassFailure("weekly-retry", weekStart, err)
    }
  }
  return { attempted: WEEKLY_RETRY_LOOKBACK_WEEKS, sent }
}

// Mirrors runWeeklyPass exactly, parameterized by computeMonthlyBoards/'monthly' instead of their
// weekly equivalents.
export async function runMonthlyPass(
  computeMonthlyBoards: (monthStart: string) => Promise<BoardSummary[]>,
  monthStart: string,
  telegram: TelegramContract
): Promise<{ sent: boolean }> {
  const boards = await computeMonthlyBoards(monthStart)
  if (boards.length === 0) return { sent: false } // month not ready yet
  await telegram.claimAndSend("monthly", { weekStart: monthStart }, boards)
  return { sent: true }
}

// Mirrors runWeeklyRetrySweep exactly: the current (most recently elapsed) month plus
// MONTHLY_RETRY_LOOKBACK_MONTHS-1 prior months, each attempted through runMonthlyPass, each
// isolated from the others — no monthly equivalent of WEEKLY_CRON exists, so this sweep (run every
// hourly tick alongside runWeeklyRetrySweep) is monthly publishing's only production trigger.
export async function runMonthlyRetrySweep(
  computeMonthlyBoards: (monthStart: string) => Promise<BoardSummary[]>,
  currentMonthStart: string,
  telegram: TelegramContract
): Promise<{ attempted: number; sent: number }> {
  let sent = 0
  for (let monthsBack = 0; monthsBack < MONTHLY_RETRY_LOOKBACK_MONTHS; monthsBack++) {
    const monthStart = monthStartOffsetBy(currentMonthStart, monthsBack)
    try {
      const outcome = await runMonthlyPass(computeMonthlyBoards, monthStart, telegram)
      if (outcome.sent) sent++
    } catch (err) {
      logPassFailure("monthly-retry", monthStart, err)
    }
  }
  return { attempted: MONTHLY_RETRY_LOOKBACK_MONTHS, sent }
}

// Sprint 4's sendFailureAlert/AlertMessage (src/services/observability.ts) is a frozen file for
// this packet (AC-16) and its AlertMessage union has no materialization-failure variant to add
// one without editing it. This mirrors that helper's exact independent-per-channel dispatch
// shape locally, using only the already-exported TelegramSender/EmailSender adapters — never a
// second alert-transport implementation, only a second call site for a message shape the frozen
// union can't express.
function renderMaterializationAlertText(failure: MaterializationFailure): string {
  return `[Quizzer alert] materialization failed for template ${failure.templateId} at ${failure.scheduledAt} (${failure.code})`
}

async function sendMaterializationAlert(
  deps: { telegram: TelegramSender | null; email: EmailSender | null; alertChatId: string | null; alertEmailAddress: string | null },
  failure: MaterializationFailure
): Promise<void> {
  const text = renderMaterializationAlertText(failure)
  if (deps.telegram && deps.alertChatId) {
    try {
      await deps.telegram.send(deps.alertChatId, text)
    } catch {
      // independent failure — the email attempt below must still be tried
    }
  }
  if (deps.email && deps.alertEmailAddress) {
    try {
      await deps.email.send(deps.alertEmailAddress, "Quizzer alert", text)
    } catch {
      // independent failure — never suppressed by (or suppressing) the Telegram attempt
    }
  }
}

// AC-14's hourly materialize pass: draws/publishes every due occurrence, then independently
// alerts both private channels for every returned failure. One occurrence/failure/channel
// attempt never blocks another.
export async function runMaterializePass(
  deps: {
    materializeTemplates: (days: number, now: number) => Promise<MaterializeResult>
    now: () => number
    telegram: TelegramSender | null
    email: EmailSender | null
    alertChatId: string | null
    alertEmailAddress: string | null
  }
): Promise<{ created: number; failed: number }> {
  const now = deps.now()
  const result = await deps.materializeTemplates(MATERIALIZE_LOOKAHEAD_DAYS, now)
  for (const failure of result.failures) {
    try {
      await sendMaterializationAlert(deps, failure)
    } catch (err) {
      logPassFailure("materialize-alert", failure.templateId, err)
    }
  }
  return { created: result.quizIds.length, failed: result.failures.length }
}
