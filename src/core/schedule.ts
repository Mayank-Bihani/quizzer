// Recurring-template rrule expansion; UTC storage, Asia/Kolkata is presentation only — SCHEDULER.md §4.2, §6

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000 // UTC+5:30, fixed — Asia/Kolkata observes no DST
const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

// 0=Sunday..6=Saturday, matching Date.UTC's getUTCDay() convention.
const WEEKDAY_CODES: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

// Shifting by the fixed IST offset and reading UTC getters off the result yields IST wall-clock
// fields without ever touching the host's local timezone — the only DST-free way to do this with
// the platform Date object.
function istWeekStartMsContaining(ms: number): number {
  const shifted = new Date(ms + IST_OFFSET_MS)
  const daysSinceMonday = (shifted.getUTCDay() + 6) % 7 // Monday -> 0, ..., Sunday -> 6
  const shiftedMidnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
  return shiftedMidnight - daysSinceMonday * DAY_MS - IST_OFFSET_MS
}

function formatIstDate(ms: number): string {
  const shifted = new Date(ms + IST_OFFSET_MS)
  const year = shifted.getUTCFullYear()
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0")
  const day = String(shifted.getUTCDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

// AC-1 — given a Monday IST calendar date, the inclusive-start/exclusive-end epoch-ms bounds of
// that Monday-00:00-IST-to-next-Monday-00:00-IST week.
export function weekBoundsForWeekStart(weekStart: string): { startMs: number; endMs: number } {
  const [year, month, day] = weekStart.split("-").map(Number)
  const startMs = Date.UTC(year as number, (month as number) - 1, day as number, 0, 0, 0) - IST_OFFSET_MS
  return { startMs, endMs: startMs + WEEK_MS }
}

// AC-1 — the week_start of the most recently *fully elapsed* IST week (never the week containing
// `now`, which hasn't ended yet).
export function mostRecentlyElapsedWeekStart(nowMs: number): string {
  const currentWeekStartMs = istWeekStartMsContaining(nowMs)
  return formatIstDate(currentWeekStartMs - WEEK_MS)
}

// AC-14's weekly-retry sweep candidate weeks: the same Monday IST anchor `weeksBack` whole weeks earlier.
export function weekStartOffsetBy(weekStart: string, weeksBack: number): string {
  const { startMs } = weekBoundsForWeekStart(weekStart)
  return formatIstDate(startMs - weeksBack * WEEK_MS)
}

// Months vary in length (28-31 days), unlike weeks — computed from calendar year/month fields
// (Date.UTC(year, month, 1)) rather than a fixed-duration offset.
function istMonthStartMsContaining(ms: number): number {
  const shifted = new Date(ms + IST_OFFSET_MS)
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - IST_OFFSET_MS
}

// AC-3 — given a "YYYY-MM-01" IST calendar-month start, the inclusive-start/exclusive-end epoch-ms
// bounds of that month, IST wall-clock. Date.UTC normalizes a month-index of 12 into January of
// the following year, so the December->January rollover needs no special-casing.
export function monthBoundsForMonthStart(monthStart: string): { startMs: number; endMs: number } {
  const [year, month] = monthStart.split("-").map(Number)
  const startMs = Date.UTC(year as number, (month as number) - 1, 1, 0, 0, 0) - IST_OFFSET_MS
  const endMs = Date.UTC(year as number, month as number, 1, 0, 0, 0) - IST_OFFSET_MS
  return { startMs, endMs }
}

// AC-4 — the month_start of the most recently *fully elapsed* IST calendar month (never the month
// containing `now`, which hasn't ended yet).
export function mostRecentlyElapsedMonthStart(nowMs: number): string {
  const currentMonthStartMs = istMonthStartMsContaining(nowMs)
  const shifted = new Date(currentMonthStartMs + IST_OFFSET_MS)
  const previousMonthStartMs = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() - 1, 1) - IST_OFFSET_MS
  return formatIstDate(previousMonthStartMs)
}

// AC-5's monthly-retry sweep candidate months: the same 1st-of-month IST anchor `monthsBack`
// whole calendar months earlier.
export function monthStartOffsetBy(monthStart: string, monthsBack: number): string {
  const [year, month] = monthStart.split("-").map(Number)
  const targetMs = Date.UTC(year as number, (month as number) - 1 - monthsBack, 1) - IST_OFFSET_MS
  return formatIstDate(targetMs)
}

export type RruleExpansionResult = { ok: true; timestampsMs: number[] } | { ok: false }

// A defensive sanity cap, not a product limit: a pathological window (or a bug passing years
// instead of days) must never hang or produce unbounded output — AC-2.
const MAX_EXPANSION_WEEKS = 60

// AC-2 — the resolved minimal RFC 5545 RRULE subset: FREQ=WEEKLY;BYDAY=<day list>;BYHOUR=<H>;
// BYMINUTE=<MM>. No COUNT/UNTIL/other part is recognized; any other FREQ, an unparseable string,
// or a missing required part is rejected rather than guessed.
export function expandRrule(rrule: string, fromMs: number, toMs: number): RruleExpansionResult {
  const parts = new Map<string, string>()
  for (const segment of rrule.split(";")) {
    const eq = segment.indexOf("=")
    if (eq === -1) return { ok: false }
    parts.set(segment.slice(0, eq), segment.slice(eq + 1))
  }

  if (parts.get("FREQ") !== "WEEKLY") return { ok: false }
  const byDay = parts.get("BYDAY")
  const byHour = parts.get("BYHOUR")
  const byMinute = parts.get("BYMINUTE")
  if (!byDay || !byHour || !byMinute) return { ok: false }

  const dayNumbers = new Set<number>()
  for (const code of byDay.split(",")) {
    const dayNumber = WEEKDAY_CODES[code]
    if (dayNumber === undefined) return { ok: false }
    dayNumbers.add(dayNumber)
  }
  if (dayNumbers.size === 0) return { ok: false }

  const hour = Number(byHour)
  const minute = Number(byMinute)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { ok: false }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return { ok: false }

  const timestampsMs: number[] = []
  let weekStartMs = istWeekStartMsContaining(fromMs)
  for (let weeksProcessed = 0; weekStartMs < toMs && weeksProcessed < MAX_EXPANSION_WEEKS; weeksProcessed++) {
    for (const dayNumber of dayNumbers) {
      const daysFromMonday = (dayNumber + 6) % 7 // Monday -> 0, ..., Sunday -> 6
      const occurrenceMs = weekStartMs + daysFromMonday * DAY_MS + hour * 60 * 60 * 1000 + minute * 60 * 1000
      if (occurrenceMs >= fromMs && occurrenceMs < toMs) timestampsMs.push(occurrenceMs)
    }
    weekStartMs += WEEK_MS
  }

  timestampsMs.sort((a, b) => a - b)
  return { ok: true, timestampsMs }
}
