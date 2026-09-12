import { describe, expect, it } from "vitest"
import {
  expandRrule,
  monthBoundsForMonthStart,
  monthStartOffsetBy,
  mostRecentlyElapsedMonthStart,
  mostRecentlyElapsedWeekStart,
  weekBoundsForWeekStart,
  weekStartOffsetBy,
} from "../src/core/schedule"

describe("weekBoundsForWeekStart", () => {
  it("returns exact Monday-00:00-IST-to-next-Monday-00:00-IST bounds", () => {
    const { startMs, endMs } = weekBoundsForWeekStart("2026-09-07") // a Monday
    // 2026-09-07 00:00 IST = 2026-09-06 18:30:00 UTC
    expect(new Date(startMs).toISOString()).toBe("2026-09-06T18:30:00.000Z")
    expect(endMs - startMs).toBe(7 * 24 * 60 * 60 * 1000)
    expect(new Date(endMs).toISOString()).toBe("2026-09-13T18:30:00.000Z")
  })

  it("handles a week crossing a calendar-year boundary with no DST drift", () => {
    const { startMs, endMs } = weekBoundsForWeekStart("2026-12-28") // a Monday, week wraps into Jan 2027
    expect(new Date(startMs).toISOString()).toBe("2026-12-27T18:30:00.000Z")
    expect(new Date(endMs).toISOString()).toBe("2027-01-03T18:30:00.000Z")
    expect(endMs - startMs).toBe(7 * 24 * 60 * 60 * 1000) // exactly 7 days, no DST adjustment
  })
})

describe("mostRecentlyElapsedWeekStart", () => {
  it("returns the prior week's Monday just before, at, and after the Monday-00:30-IST boundary", () => {
    // Monday 2026-09-07 00:00 IST = 2026-09-06T18:30:00.000Z
    const mondayMidnightIst = Date.parse("2026-09-06T18:30:00.000Z")

    // 1ms before the new week starts: we're still deep in the week that started 2026-08-31.
    expect(mostRecentlyElapsedWeekStart(mondayMidnightIst - 1)).toBe("2026-08-24")
    // Exactly at the boundary: the week starting 2026-08-31 has just fully elapsed.
    expect(mostRecentlyElapsedWeekStart(mondayMidnightIst)).toBe("2026-08-31")
    // The cron fires at 00:30 IST, safely after the boundary.
    const cronFireTime = mondayMidnightIst + 30 * 60 * 1000
    expect(mostRecentlyElapsedWeekStart(cronFireTime)).toBe("2026-08-31")
  })

  it("stays consistent with weekBoundsForWeekStart's own boundaries", () => {
    const now = Date.parse("2026-09-10T12:00:00.000Z")
    const weekStart = mostRecentlyElapsedWeekStart(now)
    const { endMs } = weekBoundsForWeekStart(weekStart)
    expect(endMs).toBeLessThanOrEqual(now)
  })
})

describe("weekStartOffsetBy", () => {
  it("steps back the given number of whole IST weeks", () => {
    expect(weekStartOffsetBy("2026-09-07", 0)).toBe("2026-09-07")
    expect(weekStartOffsetBy("2026-09-07", 1)).toBe("2026-08-31")
    expect(weekStartOffsetBy("2026-09-07", 7)).toBe("2026-07-20")
  })

  it("crosses a calendar-year boundary with no drift", () => {
    expect(weekStartOffsetBy("2027-01-04", 1)).toBe("2026-12-28")
  })
})

describe("monthBoundsForMonthStart", () => {
  it("returns exact 1st-00:00-IST-to-next-1st-00:00-IST bounds for a 30-day month", () => {
    const { startMs, endMs } = monthBoundsForMonthStart("2026-09-01")
    expect(new Date(startMs).toISOString()).toBe("2026-08-31T18:30:00.000Z")
    expect(new Date(endMs).toISOString()).toBe("2026-09-30T18:30:00.000Z")
    expect(endMs - startMs).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it("handles a month crossing a calendar-year boundary with no DST drift", () => {
    const { startMs, endMs } = monthBoundsForMonthStart("2026-12-01")
    expect(new Date(startMs).toISOString()).toBe("2026-11-30T18:30:00.000Z")
    expect(new Date(endMs).toISOString()).toBe("2026-12-31T18:30:00.000Z") // 2027-01-01 00:00 IST
  })

  it("spans 29 days for a leap-year February", () => {
    const { startMs, endMs } = monthBoundsForMonthStart("2028-02-01")
    expect(endMs - startMs).toBe(29 * 24 * 60 * 60 * 1000)
  })
})

describe("mostRecentlyElapsedMonthStart", () => {
  it("returns the prior month's 1st for any instant in September 2026 IST", () => {
    const anyInstantInSeptemberIst = Date.parse("2026-09-15T12:00:00.000Z")
    expect(mostRecentlyElapsedMonthStart(anyInstantInSeptemberIst)).toBe("2026-08-01")
  })

  it("rolls over the calendar year for any instant in January 2027 IST", () => {
    const anyInstantInJanuaryIst = Date.parse("2027-01-15T12:00:00.000Z")
    expect(mostRecentlyElapsedMonthStart(anyInstantInJanuaryIst)).toBe("2026-12-01")
  })

  it("stays consistent with monthBoundsForMonthStart's own boundaries", () => {
    const now = Date.parse("2026-09-10T12:00:00.000Z")
    const monthStart = mostRecentlyElapsedMonthStart(now)
    const { endMs } = monthBoundsForMonthStart(monthStart)
    expect(endMs).toBeLessThanOrEqual(now)
  })
})

describe("monthStartOffsetBy", () => {
  it("steps back the given number of whole calendar months", () => {
    expect(monthStartOffsetBy("2026-09-01", 3)).toBe("2026-06-01")
    expect(monthStartOffsetBy("2026-02-01", 1)).toBe("2026-01-01")
  })
})

describe("expandRrule", () => {
  const fromMs = Date.parse("2026-09-07T00:00:00.000Z") // a Monday-ish anchor for window math
  const toMs = fromMs + 7 * 24 * 60 * 60 * 1000

  it("expands a single weekday/time into the correct IST-local timestamp", () => {
    const result = expandRrule("FREQ=WEEKLY;BYDAY=TU;BYHOUR=18;BYMINUTE=0", fromMs, toMs)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.timestampsMs).toHaveLength(1)
    // Tuesday 18:00 IST = 12:30 UTC
    const iso = new Date(result.timestampsMs[0] as number).toISOString()
    expect(iso.endsWith("T12:30:00.000Z")).toBe(true)
  })

  it("expands multiple BYDAY entries with no duplicate timestamps, in ascending order", () => {
    const result = expandRrule("FREQ=WEEKLY;BYDAY=TU,TH;BYHOUR=18;BYMINUTE=0", fromMs, toMs)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.timestampsMs).toHaveLength(2)
    expect(result.timestampsMs).toEqual([...result.timestampsMs].sort((a, b) => a - b))
    expect(new Set(result.timestampsMs).size).toBe(result.timestampsMs.length)
  })

  it("de-duplicates a repeated BYDAY code", () => {
    const result = expandRrule("FREQ=WEEKLY;BYDAY=TU,TU;BYHOUR=18;BYMINUTE=0", fromMs, toMs)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.timestampsMs).toHaveLength(1)
  })

  it("only returns timestamps within the [fromMs, toMs) window", () => {
    const result = expandRrule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU;BYHOUR=0;BYMINUTE=0", fromMs, toMs)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const ts of result.timestampsMs) {
      expect(ts).toBeGreaterThanOrEqual(fromMs)
      expect(ts).toBeLessThan(toMs)
    }
  })

  it("rejects any FREQ other than WEEKLY", () => {
    expect(expandRrule("FREQ=DAILY;BYDAY=MO;BYHOUR=10;BYMINUTE=0", fromMs, toMs)).toEqual({ ok: false })
    expect(expandRrule("FREQ=MONTHLY;BYDAY=MO;BYHOUR=10;BYMINUTE=0", fromMs, toMs)).toEqual({ ok: false })
  })

  it("rejects a completely unparseable string", () => {
    expect(expandRrule("not an rrule at all", fromMs, toMs)).toEqual({ ok: false })
    expect(expandRrule("", fromMs, toMs)).toEqual({ ok: false })
  })

  it("rejects a missing required part", () => {
    expect(expandRrule("FREQ=WEEKLY;BYHOUR=10;BYMINUTE=0", fromMs, toMs)).toEqual({ ok: false }) // no BYDAY
    expect(expandRrule("FREQ=WEEKLY;BYDAY=MO;BYMINUTE=0", fromMs, toMs)).toEqual({ ok: false }) // no BYHOUR
    expect(expandRrule("FREQ=WEEKLY;BYDAY=MO;BYHOUR=10", fromMs, toMs)).toEqual({ ok: false }) // no BYMINUTE
  })

  it("rejects an unrecognized weekday code, an out-of-range hour, and an out-of-range minute", () => {
    expect(expandRrule("FREQ=WEEKLY;BYDAY=XX;BYHOUR=10;BYMINUTE=0", fromMs, toMs)).toEqual({ ok: false })
    expect(expandRrule("FREQ=WEEKLY;BYDAY=MO;BYHOUR=24;BYMINUTE=0", fromMs, toMs)).toEqual({ ok: false })
    expect(expandRrule("FREQ=WEEKLY;BYDAY=MO;BYHOUR=10;BYMINUTE=60", fromMs, toMs)).toEqual({ ok: false })
  })

  it("never recognizes COUNT/UNTIL as limiting expansion — no other RRULE part changes output", () => {
    const withExtra = expandRrule("FREQ=WEEKLY;BYDAY=TU;BYHOUR=18;BYMINUTE=0;COUNT=1", fromMs, toMs)
    const without = expandRrule("FREQ=WEEKLY;BYDAY=TU;BYHOUR=18;BYMINUTE=0", fromMs, toMs)
    expect(withExtra).toEqual(without)
  })

  it("bounds expansion for a pathological huge window instead of hanging or returning unbounded output", () => {
    const hugeToMs = fromMs + 100 * 365 * 24 * 60 * 60 * 1000 // 100 years
    const result = expandRrule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU;BYHOUR=0;BYMINUTE=0", fromMs, hugeToMs)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.timestampsMs.length).toBeLessThan(1000) // bounded, not ~36,500 entries
  })

  it("returns an empty list for an empty or inverted window without erroring", () => {
    const result = expandRrule("FREQ=WEEKLY;BYDAY=MO;BYHOUR=10;BYMINUTE=0", toMs, fromMs)
    expect(result).toEqual({ ok: true, timestampsMs: [] })
  })
})
