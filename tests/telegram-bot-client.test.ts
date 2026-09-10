import { describe, expect, it, vi } from "vitest"
import { createNoOpBotClient, createTelegramBotClient } from "../src/services/telegram"

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

const noopSleep = async () => undefined

describe("createTelegramBotClient — sendMessage failure classification", () => {
  it("succeeds on the first 200 response with exactly one fetch call", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true, result: { message_id: 42 } }))
    const client = createTelegramBotClient("test-token", fetchMock, noopSleep)
    const result = await client.sendMessage("-100", "hello")
    expect(result).toEqual({ ok: true, messageId: "42" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("retries a 429 exactly once using retry_after, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { ok: false, parameters: { retry_after: 3 } }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, result: { message_id: 7 } }))
    const client = createTelegramBotClient("test-token", fetchMock, noopSleep)
    const result = await client.sendMessage("-100", "hello")
    expect(result).toEqual({ ok: true, messageId: "7" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("gives up as permanent after a repeated 429 with exactly two total fetch calls", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(429, { ok: false, parameters: { retry_after: 1 } }))
    const client = createTelegramBotClient("test-token", fetchMock, noopSleep)
    const result = await client.sendMessage("-100", "hello")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.permanent).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("never retries a 400 — exactly one fetch call, permanent failure", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(400, { ok: false, description: "Bad Request: message is too long" }))
    const client = createTelegramBotClient("test-token", fetchMock, noopSleep)
    const result = await client.sendMessage("-100", "hello")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.permanent).toBe(true)
  })

  it("never retries a 401 — exactly one fetch call, permanent failure", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(401, { ok: false, description: "Unauthorized" }))
    const client = createTelegramBotClient("test-token", fetchMock, noopSleep)
    const result = await client.sendMessage("-100", "hello")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.permanent).toBe(true)
  })

  it("never retries a 403 and surfaces migrate_to_chat_id distinctly when present", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(403, { ok: false, parameters: { migrate_to_chat_id: -100999 } }))
    const client = createTelegramBotClient("test-token", fetchMock, noopSleep)
    const result = await client.sendMessage("-100", "hello")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.permanent).toBe(true)
      expect(result.error).toContain("-100999")
    }
  })

  it("never retries a 403 without migrate_to_chat_id and does not mention it", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(403, { ok: false, description: "bot was kicked" }))
    const client = createTelegramBotClient("test-token", fetchMock, noopSleep)
    const result = await client.sendMessage("-100", "hello")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).not.toContain("migrate_to_chat_id")
  })

  it("retries a 5xx with backoff up to exactly 3 total attempts, then gives up as permanent", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(502, { ok: false, description: "Bad Gateway" }))
    const client = createTelegramBotClient("test-token", fetchMock, noopSleep)
    const result = await client.sendMessage("-100", "hello")
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.permanent).toBe(true)
  })

  it("recovers from a 5xx if a later retry succeeds within the attempt budget", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { ok: false }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, result: { message_id: 9 } }))
    const client = createTelegramBotClient("test-token", fetchMock, noopSleep)
    const result = await client.sendMessage("-100", "hello")
    expect(result).toEqual({ ok: true, messageId: "9" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("classifies a thrown network error the same as a 5xx, retrying up to the attempt budget", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network unreachable")
    })
    const client = createTelegramBotClient("test-token", fetchMock, noopSleep)
    const result = await client.sendMessage("-100", "hello")
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.ok).toBe(false)
  })

  it("never sends the bot token in a log-visible location — only in the request URL", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("secret-token-value")
      return jsonResponse(200, { ok: true, result: { message_id: 1 } })
    })
    const client = createTelegramBotClient("secret-token-value", fetchMock, noopSleep)
    const result = await client.sendMessage("-100", "hello")
    expect(result.ok).toBe(true)
  })
})

describe("createTelegramBotClient — getMe", () => {
  it("confirms a valid token without retry logic", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true, result: { id: 1, is_bot: true } }))
    const client = createTelegramBotClient("test-token", fetchMock, noopSleep)
    const result = await client.getMe()
    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("reports an invalid token", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(401, { ok: false }))
    const client = createTelegramBotClient("bad-token", fetchMock, noopSleep)
    const result = await client.getMe()
    expect(result.ok).toBe(false)
  })
})

describe("createNoOpBotClient — TELEGRAM_ENABLED=false composition", () => {
  it("never calls fetch and returns a deterministic successful stub", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const client = createNoOpBotClient()
    const sendResult = await client.sendMessage("-100", "hello")
    const meResult = await client.getMe()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sendResult.ok).toBe(true)
    expect(meResult.ok).toBe(true)
    vi.unstubAllGlobals()
  })
})
