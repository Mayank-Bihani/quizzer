// Dual-channel failure-alert sender, called from SCHEDULER's minute tick (SCHEDULER.md §4.1) — both TELEGRAM_ALERT_CHAT_ID and EMAIL_ALERT_ADDRESS (via the ALERT_EMAIL send_email binding, or a third-party email API if no custom domain is attached), neither replacing the other. Owned by SCHEDULER, not a separate module — MODULES.md §6

import type { TelegramPostKind } from "../core/contracts"

export type AlertMessage =
  | { category: "close_overdue"; quizId: string; safeCloseAt: number }
  | { category: "telegram_post_failed"; quizId: string | null; weekStart: string | null; kind: TelegramPostKind; claimedAt: number }

// Only safe quiz/week identity, kind/timestamps, and category — never question content, answers,
// session cookies, bot tokens, email addresses, SQL traces, provider errors, or chat IDs.
export function renderAlertText(message: AlertMessage): string {
  if (message.category === "close_overdue") {
    return `[Quizzer alert] quiz ${message.quizId} is overdue for safe close (safeCloseAt=${message.safeCloseAt})`
  }
  const target = message.quizId !== null ? `quiz ${message.quizId}` : `week ${message.weekStart}`
  return `[Quizzer alert] Telegram post '${message.kind}' failed for ${target} (claimed ${message.claimedAt})`
}

export type TelegramSender = { send(chatId: string, text: string): Promise<void> }
export type EmailSender = { send(toAddress: string, subject: string, text: string): Promise<void> }

export type AlertOutcome = { telegramOk: boolean; emailOk: boolean }

export async function sendFailureAlert(
  deps: { telegram: TelegramSender | null; email: EmailSender | null; alertChatId: string | null; alertEmailAddress: string | null },
  message: AlertMessage
): Promise<AlertOutcome> {
  const text = renderAlertText(message)
  let telegramOk = false
  let emailOk = false

  if (deps.telegram && deps.alertChatId) {
    try {
      await deps.telegram.send(deps.alertChatId, text)
      telegramOk = true
    } catch {
      // independent failure — the email attempt below must still be tried
    }
  }

  if (deps.email && deps.alertEmailAddress) {
    try {
      await deps.email.send(deps.alertEmailAddress, "Quizzer alert", text)
      emailOk = true
    } catch {
      // independent failure — never suppressed by (or suppressing) the Telegram attempt
    }
  }

  return { telegramOk, emailOk }
}

// Real Telegram Bot API adapter. Token/chat id are read by the caller from env; never logged.
export function createTelegramSender(botToken: string): TelegramSender {
  return {
    async send(chatId, text) {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      })
      if (!res.ok) throw new Error(`telegram sendMessage failed with status ${res.status}`)
    },
  }
}

// Real Cloudflare Email Routing adapter — a production prerequisite (custom managed domain +
// verified destination); absent locally and pre-launch, in which case the caller passes null.
export function createEmailSender(binding: SendEmail, fromAddress: string): EmailSender {
  return {
    async send(toAddress, subject, text) {
      await binding.send({ from: fromAddress, to: toAddress, subject, text })
    },
  }
}
