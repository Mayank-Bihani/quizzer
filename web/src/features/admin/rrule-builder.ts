// Builds/parses the minimal RRULE subset the backend accepts for recurring templates:
// FREQ=WEEKLY;BYDAY=<day list>;BYHOUR=<H>;BYMINUTE=<MM> — no COUNT/UNTIL (SCHEDULER.md §4.2;
// src/core/schedule.ts's expandRrule is the source of truth this mirrors for the admin form).

export const WEEKDAY_ORDER = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type WeekdayCode = (typeof WEEKDAY_ORDER)[number];

export const WEEKDAY_LABELS: Record<WeekdayCode, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

export function buildWeeklyRrule(
  days: WeekdayCode[],
  hour: number,
  minute: number,
): string {
  const ordered = WEEKDAY_ORDER.filter((day) => days.includes(day));
  return `FREQ=WEEKLY;BYDAY=${ordered.join(",")};BYHOUR=${hour};BYMINUTE=${minute}`;
}

export function parseWeeklyRrule(
  rrule: string,
): { days: WeekdayCode[]; hour: number; minute: number } | null {
  const parts = new Map<string, string>();
  for (const segment of rrule.split(";")) {
    const eq = segment.indexOf("=");
    if (eq === -1) return null;
    parts.set(segment.slice(0, eq), segment.slice(eq + 1));
  }
  if (parts.get("FREQ") !== "WEEKLY") return null;

  const byDay = parts.get("BYDAY");
  const byHour = parts.get("BYHOUR");
  const byMinute = parts.get("BYMINUTE");
  if (!byDay || !byHour || !byMinute) return null;

  const days = byDay.split(",");
  if (days.some((day) => !WEEKDAY_ORDER.includes(day as WeekdayCode))) return null;

  const hour = Number(byHour);
  const minute = Number(byMinute);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;

  return { days: days as WeekdayCode[], hour, minute };
}
