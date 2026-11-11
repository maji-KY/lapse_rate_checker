/** 日付は "YYYY-MM-DD"（JST）の文字列で扱う。Date のタイムゾーン変換に振り回されないため。 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface JstNow {
  readonly date: string;
  readonly hour: number;
}

export function jstNow(now: Date = new Date()): JstNow {
  const iso = new Date(now.getTime() + JST_OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), hour: Number(iso.slice(11, 13)) };
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** cutoffHour 時（JST）より前なら当日、以降なら翌日から。 */
export function defaultStart(now: JstNow, cutoffHour: number): string {
  return now.hour < cutoffHour ? now.date : addDays(now.date, 1);
}

export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && addDays(s, 0) === s;
}

const WEEKDAYS = "日月火水木金土";

export function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEKDAYS[d.getUTCDay()] ?? ""}）`;
}
