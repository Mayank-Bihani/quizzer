// Pure rendering for announce/soon/open/result/weekly/cancelled; question/unit counts and unit timing summary, no V1 bonus text; code at admission — TELEGRAM.md.

import type { BoardSummary, CancelledPayload, CloseResult, QuizAnnouncePayload, QuizType, UnitKind, WeeklyBoardRow } from "./contracts"

const MAX_BOARD_ROWS = 10

// HTML parse_mode only ever needs these three escaped — MarkdownV2's full escape surface is a
// footgun that would also mangle scores like "5.44" or "-1.00" — TELEGRAM.md §4.3.
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

// Presentation-only IST rendering (storage stays UTC epoch-ms) — mirrors the fixed-offset trick in
// core/schedule.ts. A student-facing message showing a raw ISO timestamp ("2026-09-11T19:57:37Z")
// is unreadable on a phone and in the wrong timezone; every quiz is IST-scheduled.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000 // UTC+5:30, fixed — Asia/Kolkata observes no DST
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function formatTimestamp(ms: number): string {
  const shifted = new Date(ms + IST_OFFSET_MS)
  const weekday = WEEKDAY_NAMES[shifted.getUTCDay()]
  const day = shifted.getUTCDate()
  const month = MONTH_NAMES[shifted.getUTCMonth()]
  let hour = shifted.getUTCHours()
  const minute = String(shifted.getUTCMinutes()).padStart(2, "0")
  const ampm = hour >= 12 ? "PM" : "AM"
  hour = hour % 12 || 12
  return `${weekday}, ${day} ${month} · ${hour}:${minute} ${ampm} IST`
}

const UNIT_KIND_LABEL: Record<UnitKind, string> = { standalone: "Standalone", rc: "Reading Comprehension", lrdi: "LRDI" }

function formatTimingSummary(summary: QuizAnnouncePayload["timingSummary"]): string {
  return summary
    .map((entry) => {
      const range = entry.minTimeSec === entry.maxTimeSec ? `${entry.minTimeSec}s` : `${entry.minTimeSec}-${entry.maxTimeSec}s`
      return `• ${UNIT_KIND_LABEL[entry.kind]}: ${pluralize(entry.count, "question")}, ${range} each`
    })
    .join("\n")
}

function formatQuizMeta(payload: QuizAnnouncePayload): string {
  return [
    `${pluralize(payload.questionCount, "question")} across ${pluralize(payload.unitCount, "unit")}.`,
    `Your duration: ${pluralize(Math.round(payload.windowSec / 60), "minute")}.`,
    "",
    "Timing:",
    formatTimingSummary(payload.timingSummary),
  ].join("\n")
}

// TG-1 — T-2h. Never a room code (TG-6 withholds it until T).
export function renderQuizAnnounce(payload: QuizAnnouncePayload): string {
  return [
    `📢 <b>${escapeHtml(payload.title)}</b>`,
    `Starts: ${formatTimestamp(payload.scheduledAt)} · Admission closes: ${formatTimestamp(payload.endsAt)}`,
    "",
    formatQuizMeta(payload),
  ].join("\n")
}

// TG-2 — T-30m. Never a room code, even if the shared payload happens to carry one.
export function renderStartingSoon(payload: QuizAnnouncePayload): string {
  return [`⏰ <b>${escapeHtml(payload.title)}</b> starts in 30 minutes.`, "", formatQuizMeta(payload)].join("\n")
}

// TG-3 — admission opens at T. Room code only when the payload actually carries one.
export function renderRoomOpen(payload: QuizAnnouncePayload): string {
  const lines = [`✅ <b>${escapeHtml(payload.title)}</b> is open now!`]
  if (payload.roomCode) lines.push(`Room code: <b>${escapeHtml(payload.roomCode)}</b>`)
  lines.push(`Admission closes: ${formatTimestamp(payload.endsAt)}`, "", formatQuizMeta(payload))
  return lines.join("\n")
}

// TG-4 — after safe close and committed ranking. participantCount===0 is a distinct variant so
// silence on the group always signals a bug, never an ambiguous empty room.
export function renderQuizResult(payload: CloseResult): string {
  if (payload.participantCount === 0) {
    return "🏆 <b>Results are in</b> — nobody played this one."
  }
  const rows = payload.top10
    .slice(0, MAX_BOARD_ROWS)
    .map((row) => `${row.rank}. ${escapeHtml(row.name)} — ${row.score}`)
    .join("\n")
  return ["🏆 <b>Results are in!</b>", `${pluralize(payload.participantCount, "student")} played.`, "", "Top 10:", rows, "", "See the full board and your result in the Quizzer app."].join("\n")
}

const WEEKLY_SECTION_ORDER: (QuizType | "overall")[] = ["verbal", "quant", "lr", "overall"]
const SECTION_LABEL: Record<QuizType | "overall", string> = { verbal: "Verbal", quant: "Quant", lr: "LR", overall: "Overall" }

function renderWeeklySection(board: BoardSummary): string {
  const rows =
    board.top10.length === 0
      ? "Nobody ranked this section this week."
      : board.top10
          .slice(0, MAX_BOARD_ROWS)
          .map((row: WeeklyBoardRow) => `${row.rank}. ${escapeHtml(row.name)} — ${row.totalScore} (${pluralize(row.quizzesTaken, "quiz", "quizzes")})`)
          .join("\n")
  return [`📊 <b>Weekly Board — ${SECTION_LABEL[board.type]}</b>`, `Week of ${board.weekStart}`, "", rows, "", "Full board in the Quizzer app."].join("\n")
}

// TG-5 — exactly four messages, one per section plus overall, in a fixed order — never one
// combined message (TELEGRAM.md §4.2's 4096-char math is why: a full week's worth in one message
// would blow past it outright).
export function renderWeeklyBoards(boards: BoardSummary[]): { type: QuizType | "overall"; text: string }[] {
  return WEEKLY_SECTION_ORDER.map((type) => {
    const board = boards.find((b) => b.type === type)
    if (!board) throw new Error(`telegram-render invariant: missing weekly board for section ${type}`)
    return { type, text: renderWeeklySection(board) }
  })
}

// Notify-path only — the silent case never calls this function at all (TELEGRAM.md §10).
export function renderCancelled(payload: CancelledPayload): string {
  const lines = [`❌ <b>${escapeHtml(payload.title)}</b> has been cancelled.`, `Was scheduled: ${formatTimestamp(payload.scheduledAt)}`]
  if (payload.reason) lines.push(`Reason: ${escapeHtml(payload.reason)}`)
  return lines.join("\n")
}
