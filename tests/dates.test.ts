import { describe, expect, it } from "vitest";
import { addDays, dayLabel, defaultStart, isIsoDate, jstNow } from "../src/dates";

describe("dates", () => {
  it("UTC から JST の日付と時刻", () => {
    expect(jstNow(new Date("2026-11-11T06:59:00Z"))).toEqual({ date: "2026-11-11", hour: 15 });
    expect(jstNow(new Date("2026-11-11T15:30:00Z"))).toEqual({ date: "2026-11-12", hour: 0 });
  });

  it("16時より前は当日、16時以降は翌日から", () => {
    expect(defaultStart({ date: "2026-11-11", hour: 15 }, 16)).toBe("2026-11-11");
    expect(defaultStart({ date: "2026-11-11", hour: 16 }, 16)).toBe("2026-11-12");
  });

  it("月またぎ・うるう年", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("日付の形式チェック", () => {
    expect(isIsoDate("2026-11-15")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-1-5")).toBe(false);
  });

  it("曜日つきの表示", () => {
    expect(dayLabel("2026-11-12")).toBe("11/12（木）");
  });
});
