import { describe, expect, it } from "vitest"
import type { BoardSummary, CancelledPayload, CloseResult, QuizAnnouncePayload } from "../src/core/contracts"
import {
  renderCancelled,
  renderQuizAnnounce,
  renderQuizResult,
  renderRoomOpen,
  renderStartingSoon,
  renderWeeklyBoards,
} from "../src/core/telegram-render"

const MESSAGE_LIMIT = 4096

function announcePayload(overrides: Partial<QuizAnnouncePayload> = {}): QuizAnnouncePayload {
  return {
    title: "Weekend Quant Sprint",
    scheduledAt: 1_700_000_000_000,
    endsAt: 1_700_000_600_000,
    questionCount: 20,
    unitCount: 5,
    windowSec: 1800,
    timingSummary: [{ kind: "standalone", count: 20, minTimeSec: 60, maxTimeSec: 90 }],
    ...overrides,
  }
}

describe("renderQuizAnnounce (TG-1)", () => {
  it("renders title, timing, and question/unit counts with no room code even when present on the payload", () => {
    const text = renderQuizAnnounce(announcePayload({ roomCode: "QNT-1234" }))
    expect(text).toContain("Weekend Quant Sprint")
    expect(text).toContain("20")
    expect(text).toContain("5")
    expect(text).not.toContain("QNT-1234")
  })

  it("escapes only &, <, > in a title containing an em dash", () => {
    const text = renderQuizAnnounce(announcePayload({ title: "Quiz <Night> & Chill — Fun" }))
    expect(text).toContain("&lt;Night&gt;")
    expect(text).toContain("&amp;")
    expect(text).toContain("—") // em dash is not HTML-escaped
    expect(text).not.toContain("<Night>")
  })

  it("formats mixed unit-kind timing summaries with no invented uniform per-question time", () => {
    const text = renderQuizAnnounce(
      announcePayload({
        timingSummary: [
          { kind: "rc", count: 1, minTimeSec: 480, maxTimeSec: 480 },
          { kind: "standalone", count: 8, minTimeSec: 45, maxTimeSec: 90 },
        ],
      })
    )
    expect(text).toContain("480")
    expect(text).toContain("45")
    expect(text).toContain("90")
  })

  it("never contains bonus, grace, or per-question timing wording", () => {
    const text = renderQuizAnnounce(announcePayload())
    for (const forbidden of ["bonus", "grace", "per question", "per-question"]) {
      expect(text.toLowerCase()).not.toContain(forbidden)
    }
  })
})

describe("renderStartingSoon (TG-2)", () => {
  it("never includes a room code even when present on the payload", () => {
    const text = renderStartingSoon(announcePayload({ roomCode: "QNT-1234" }))
    expect(text).not.toContain("QNT-1234")
    expect(text).toContain("Weekend Quant Sprint")
  })
})

describe("renderRoomOpen (TG-3)", () => {
  it("includes the room code only when present on the payload", () => {
    const withCode = renderRoomOpen(announcePayload({ roomCode: "QNT-1234" }))
    expect(withCode).toContain("QNT-1234")

    const withoutCode = renderRoomOpen(announcePayload())
    expect(withoutCode).not.toContain("QNT-1234")
  })
})

describe("renderQuizResult (TG-4)", () => {
  const result: CloseResult = {
    participantCount: 3,
    top10: [
      { rank: 1, userId: "u1", name: "Alice", score: 40 },
      { rank: 2, userId: "u2", name: "Bob", score: 35 },
      { rank: 3, userId: "u3", name: "Carol", score: 30 },
    ],
    boardComputedAt: 1_700_001_000_000,
  }

  it("renders participant count and top 10 rows", () => {
    const text = renderQuizResult(result)
    expect(text).toContain("3")
    expect(text).toContain("Alice")
    expect(text).toContain("Bob")
    expect(text).toContain("Carol")
  })

  it("renders the nobody-played variant when participantCount is 0, distinct from an empty list", () => {
    const text = renderQuizResult({ participantCount: 0, top10: [], boardComputedAt: 1_700_001_000_000 })
    expect(text.toLowerCase()).toContain("nobody")
  })

  it("stays under the 4096-character limit for a worst-case long-name result", () => {
    const longName = "A".repeat(200)
    const worstCase: CloseResult = {
      participantCount: 120,
      top10: Array.from({ length: 15 }, (_, i) => ({ rank: i + 1, userId: `u${i}`, name: longName, score: 100 - i })),
      boardComputedAt: 1_700_001_000_000,
    }
    const text = renderQuizResult(worstCase)
    expect(text.length).toBeLessThan(MESSAGE_LIMIT)
    // Defends the row bound even if the caller mistakenly handed more than 10.
    expect(text.split(longName)).toHaveLength(11) // 10 occurrences => 11 split parts
  })
})

describe("renderWeeklyBoards (TG-5)", () => {
  function board(type: BoardSummary["type"], rows: number): BoardSummary {
    return {
      type,
      weekStart: "2026-09-07",
      top10: Array.from({ length: rows }, (_, i) => ({ rank: i + 1, userId: `u${i}`, name: `Student ${i}`, totalScore: 100 - i, quizzesTaken: 3 })),
    }
  }

  it("returns exactly four messages in fixed order verbal, quant, lr, overall", () => {
    const messages = renderWeeklyBoards([board("overall", 5), board("lr", 3), board("verbal", 4), board("quant", 2)])
    expect(messages.map((m) => m.type)).toEqual(["verbal", "quant", "lr", "overall"])
    expect(messages).toHaveLength(4)
  })

  it("shows totalScore and quizzesTaken as context only, never averaged or used to rank", () => {
    const messages = renderWeeklyBoards([board("verbal", 3), board("quant", 0), board("lr", 0), board("overall", 0)])
    const verbal = messages.find((m) => m.type === "verbal")
    expect(verbal?.text).toContain("100") // totalScore
    expect(verbal?.text).toContain("3") // quizzesTaken
    expect(verbal?.text.toLowerCase()).not.toContain("average")
  })

  it("renders a valid nobody-ranked message for an empty section instead of erroring", () => {
    const messages = renderWeeklyBoards([board("verbal", 0), board("quant", 0), board("lr", 0), board("overall", 0)])
    for (const m of messages) expect(m.text.toLowerCase()).toContain("nobody")
  })

  it("keeps every section under 4096 characters for a 100-row board with long names", () => {
    const longName = "B".repeat(200)
    const bigBoard = (type: BoardSummary["type"]): BoardSummary => ({
      type,
      weekStart: "2026-09-07",
      top10: Array.from({ length: 100 }, (_, i) => ({ rank: i + 1, userId: `u${i}`, name: longName, totalScore: 100 - i, quizzesTaken: 5 })),
    })
    const messages = renderWeeklyBoards([bigBoard("verbal"), bigBoard("quant"), bigBoard("lr"), bigBoard("overall")])
    for (const m of messages) expect(m.text.length).toBeLessThan(MESSAGE_LIMIT)
  })
})

describe("renderCancelled", () => {
  const payload: CancelledPayload = { title: "Evening Verbal Round", scheduledAt: 1_700_000_000_000 }

  it("renders the notify message with title and scheduled time", () => {
    const text = renderCancelled(payload)
    expect(text).toContain("Evening Verbal Round")
    expect(text.toLowerCase()).toContain("cancelled")
  })

  it("includes an optional reason when present", () => {
    const text = renderCancelled({ ...payload, reason: "Venue conflict" })
    expect(text).toContain("Venue conflict")
  })
})

describe("HTML escaping across all render functions", () => {
  it("escapes a student name containing <, &, and an em dash in the weekly board", () => {
    const dangerousName = "Priya <script>&Sons — Co"
    const board: BoardSummary = {
      type: "verbal",
      weekStart: "2026-09-07",
      top10: [{ rank: 1, userId: "u1", name: dangerousName, totalScore: 50, quizzesTaken: 2 }],
    }
    const messages = renderWeeklyBoards([board, { type: "quant", weekStart: "2026-09-07", top10: [] }, { type: "lr", weekStart: "2026-09-07", top10: [] }, { type: "overall", weekStart: "2026-09-07", top10: [] }])
    const verbal = messages.find((m) => m.type === "verbal")
    expect(verbal?.text).toContain("&lt;script&gt;")
    expect(verbal?.text).toContain("&amp;Sons")
    expect(verbal?.text).not.toContain("<script>")
  })
})
