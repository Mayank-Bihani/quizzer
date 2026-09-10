// SCHEDULER: bounded prepare pass, typed-but-unwired close pass, and dual-channel failure
// alerts. Issues no SQL/KV itself — every read/write goes through the injected QUIZZING/TELEGRAM
// seams — SCHEDULER.md §4.1; CONTRACTS.md §5; src/core/contracts.ts:125-181.

import type { CloseResult, DueCloseQuiz, FailedTelegramPostRef, OpenResult } from "../core/contracts"
import { CLOSE_ALERT_DELAY_MS, SCHEDULER_DISCOVERY_LIMIT } from "../core/config"
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
