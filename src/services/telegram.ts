// Telegram Bot API client — sendMessage, getMe, editMessageText, pinChatMessage — TELEGRAM.md §3.2, §5

const FLOOD_CONTROL_MAX_RETRIES = 1 // one retry after a 429, using retry_after — never a tight loop
const SERVER_ERROR_MAX_ATTEMPTS = 3 // total attempts (initial + 2 retries) for 5xx/timeout
const DEFAULT_RETRY_AFTER_SEC = 1
const BACKOFF_BASE_MS = 500

export type SendResult = { ok: true; messageId: string } | { ok: false; permanent: boolean; error: string }
export type GetMeResult = { ok: boolean }

export type BotApiClient = {
  sendMessage(chatId: string, text: string): Promise<SendResult>
  getMe(): Promise<GetMeResult>
}

type FetchLike = typeof fetch
type SleepLike = (ms: number) => Promise<void>

async function realSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

type TelegramResponseBody = {
  ok?: boolean
  result?: { message_id?: number; id?: number; is_bot?: boolean }
  parameters?: { retry_after?: number; migrate_to_chat_id?: number }
  description?: string
}

async function parseBody(res: Response): Promise<TelegramResponseBody> {
  try {
    return (await res.json()) as TelegramResponseBody
  } catch {
    return {}
  }
}

// Retry/backoff lives here, not in db/telegram.ts: the db layer only ever needs a final
// retryable/permanent classification and, on success, a message ID — TELEGRAM.md §5.
export function createTelegramBotClient(botToken: string, fetchImpl: FetchLike = fetch, sleep: SleepLike = realSleep): BotApiClient {
  const base = `https://api.telegram.org/bot${botToken}`

  async function sendMessage(chatId: string, text: string): Promise<SendResult> {
    let serverErrorAttempts = 0
    let floodRetries = 0

    for (;;) {
      let res: Response
      try {
        res = await fetchImpl(`${base}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
        })
      } catch {
        serverErrorAttempts++
        if (serverErrorAttempts >= SERVER_ERROR_MAX_ATTEMPTS) return { ok: false, permanent: true, error: "network error: retries exhausted" }
        await sleep(BACKOFF_BASE_MS * serverErrorAttempts)
        continue
      }

      if (res.status === 200) {
        const body = await parseBody(res)
        return { ok: true, messageId: String(body.result?.message_id ?? "") }
      }

      if (res.status === 429) {
        if (floodRetries >= FLOOD_CONTROL_MAX_RETRIES) return { ok: false, permanent: true, error: "flood control: retries exhausted" }
        const body = await parseBody(res)
        floodRetries++
        await sleep((body.parameters?.retry_after ?? DEFAULT_RETRY_AFTER_SEC) * 1000)
        continue
      }

      if (res.status === 400) {
        const body = await parseBody(res)
        return { ok: false, permanent: true, error: `bad request: ${body.description ?? "malformed"}` }
      }

      if (res.status === 401) return { ok: false, permanent: true, error: "unauthorized: invalid or revoked token" }

      if (res.status === 403) {
        const body = await parseBody(res)
        const migrateTo = body.parameters?.migrate_to_chat_id
        return {
          ok: false,
          permanent: true,
          error: migrateTo !== undefined ? `forbidden: chat migrated to ${migrateTo}` : "forbidden: bot removed from group",
        }
      }

      if (res.status >= 500) {
        serverErrorAttempts++
        if (serverErrorAttempts >= SERVER_ERROR_MAX_ATTEMPTS) return { ok: false, permanent: true, error: `server error ${res.status}: retries exhausted` }
        await sleep(BACKOFF_BASE_MS * serverErrorAttempts)
        continue
      }

      return { ok: false, permanent: true, error: `unexpected status ${res.status}` }
    }
  }

  async function getMe(): Promise<GetMeResult> {
    try {
      const res = await fetchImpl(`${base}/getMe`)
      return { ok: res.status === 200 }
    } catch {
      return { ok: false }
    }
  }

  return { sendMessage, getMe }
}

// TELEGRAM_ENABLED=false composition path — never calls fetch, so local/test runs exercise full
// claim-then-send idempotency without ever reaching api.telegram.org — TELEGRAM.md §8.
export function createNoOpBotClient(): BotApiClient {
  return {
    async sendMessage() {
      return { ok: true, messageId: "noop" }
    },
    async getMe() {
      return { ok: true }
    },
  }
}
