import { describe, expect, it } from "vitest";
import { buildWeeklyRrule, parseWeeklyRrule } from "./rrule-builder";

describe("buildWeeklyRrule", () => {
  it("orders days Monday-first regardless of input order", () => {
    expect(buildWeeklyRrule(["TH", "MO"], 18, 0)).toBe(
      "FREQ=WEEKLY;BYDAY=MO,TH;BYHOUR=18;BYMINUTE=0",
    );
  });

  it("drops duplicate days", () => {
    expect(buildWeeklyRrule(["TU", "TU"], 9, 30)).toBe(
      "FREQ=WEEKLY;BYDAY=TU;BYHOUR=9;BYMINUTE=30",
    );
  });
});

describe("parseWeeklyRrule", () => {
  it("round-trips a rrule built by buildWeeklyRrule", () => {
    const rrule = buildWeeklyRrule(["SU", "WE"], 6, 5);
    expect(parseWeeklyRrule(rrule)).toEqual({ days: ["WE", "SU"], hour: 6, minute: 5 });
  });

  it("returns null for a non-weekly frequency", () => {
    expect(parseWeeklyRrule("FREQ=DAILY;BYHOUR=6;BYMINUTE=0")).toBeNull();
  });

  it("returns null when a required part is missing", () => {
    expect(parseWeeklyRrule("FREQ=WEEKLY;BYHOUR=6;BYMINUTE=0")).toBeNull();
  });

  it("returns null for an out-of-range hour or minute", () => {
    expect(parseWeeklyRrule("FREQ=WEEKLY;BYDAY=MO;BYHOUR=24;BYMINUTE=0")).toBeNull();
    expect(parseWeeklyRrule("FREQ=WEEKLY;BYDAY=MO;BYHOUR=6;BYMINUTE=60")).toBeNull();
  });

  it("returns null for an unrecognized weekday code", () => {
    expect(parseWeeklyRrule("FREQ=WEEKLY;BYDAY=XX;BYHOUR=6;BYMINUTE=0")).toBeNull();
  });
});
