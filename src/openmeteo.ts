/**
 * Open-Meteo の URL 組み立て・取得・応答の解析（地上 + 気圧面の鉛直プロファイル）。
 *
 * 1モデル = 1リクエスト。気圧面はモデルによって持っている面が違う（MSM は細かく、GSM/ECMWF は粗い）ため、
 * 全モデルに同じ面を要求し、値が null の面は捨てる。
 */

import type { Area, Settings } from "./config";

const SURFACE_VARS = ["temperature_2m", "dew_point_2m", "cloud_cover", "shortwave_radiation"] as const;

export class DataError extends Error {
  override readonly name = "DataError";
}

export interface Level {
  /** 海抜（ジオポテンシャル高度） */
  readonly heightM: number;
  readonly tempC: number;
}

export interface HourProfile {
  readonly t2m: number;
  readonly td2m: number | null;
  readonly cloud: number | null;
  readonly sw: number | null;
  /** 地上より上の面だけ、低い順 */
  readonly levels: readonly Level[];
}

/** 日付（YYYY-MM-DD, JST）→ 時 → プロファイル */
export type HoursByDate = ReadonlyMap<string, ReadonlyMap<number, HourProfile>>;

export interface ModelForecast {
  readonly model: string;
  readonly groundM: number;
  readonly hours: HoursByDate;
}

export function buildUrl(
  settings: Settings,
  area: Area,
  model: string,
  start: string,
  end: string,
  historical: boolean,
): string {
  const hourly = [
    ...SURFACE_VARS,
    ...settings.pressureLevels.flatMap((p) => [`temperature_${p}hPa`, `geopotential_height_${p}hPa`]),
  ];
  const query = new URLSearchParams({
    latitude: String(area.lat),
    longitude: String(area.lon),
    timezone: "Asia/Tokyo",
    models: model,
    start_date: start,
    end_date: end,
    hourly: hourly.join(","),
  });
  return `${historical ? settings.historicalUrl : settings.forecastUrl}?${query.toString()}`;
}

export async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, signal === undefined ? {} : { signal });
  const body: unknown = await res.json();
  if (!res.ok) {
    const reason = isRecord(body) && typeof body["reason"] === "string" ? body["reason"] : res.statusText;
    throw new DataError(`HTTP ${res.status}: ${reason}`);
  }
  return body;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function numberOrNullArray(v: unknown, key: string, length: number): readonly (number | null)[] {
  if (v === undefined || v === null) {
    return Array.from({ length }, () => null);
  }
  if (!Array.isArray(v) || !v.every((x) => x === null || typeof x === "number")) {
    throw new DataError(`hourly.${key}: 数値の配列ではありません`);
  }
  return v as readonly (number | null)[];
}

/** "2026-11-12T13:00" → ["2026-11-12", 13]。timezone=Asia/Tokyo で取得しているので文字列のまま JST として扱う。 */
function splitTime(ts: string): [string, number] {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):\d{2}$/.exec(ts);
  if (m?.[1] === undefined || m[2] === undefined) {
    throw new DataError(`hourly.time の形式が違います: ${ts}`);
  }
  return [m[1], Number(m[2])];
}

export function parse(
  data: unknown,
  model: string,
  levels: readonly number[],
  hours: readonly number[],
): ModelForecast {
  if (!isRecord(data)) {
    throw new DataError(`${model}: 応答が JSON オブジェクトではありません`);
  }
  if (data["error"] === true) {
    throw new DataError(`${model}: ${String(data["reason"])}`);
  }
  const ground = data["elevation"];
  const hourly = data["hourly"];
  if (typeof ground !== "number" || !isRecord(hourly)) {
    throw new DataError(`${model}: elevation か hourly がありません`);
  }
  const rawTimes = hourly["time"];
  if (!Array.isArray(rawTimes) || !rawTimes.every((t) => typeof t === "string")) {
    throw new DataError(`${model}: hourly.time が文字列の配列ではありません`);
  }
  const times = (rawTimes as readonly string[]).map(splitTime);
  const series = (key: string) => numberOrNullArray(hourly[key], key, times.length);
  const t2m = series("temperature_2m");
  const td2m = series("dew_point_2m");
  const cloud = series("cloud_cover");
  const sw = series("shortwave_radiation");
  const lv = levels.map((p) => [series(`geopotential_height_${p}hPa`), series(`temperature_${p}hPa`)] as const);
  const wanted = new Set(hours);

  const result = new Map<string, Map<number, HourProfile>>();
  times.forEach(([day, hour], i) => {
    const temp = t2m[i];
    if (!wanted.has(hour) || temp === null || temp === undefined) {
      return;
    }
    const found = lv
      .flatMap(([zs, ts]) => {
        const z = zs[i];
        const t = ts[i];
        return z !== null && z !== undefined && t !== null && t !== undefined && z > ground
          ? [{ heightM: z, tempC: t }]
          : [];
      })
      .sort((a, b) => a.heightM - b.heightM);
    if (found.length === 0) {
      return;
    }
    const byHour = result.get(day) ?? new Map<number, HourProfile>();
    byHour.set(hour, { t2m: temp, td2m: td2m[i] ?? null, cloud: cloud[i] ?? null, sw: sw[i] ?? null, levels: found });
    result.set(day, byHour);
  });
  return { model, groundM: ground, hours: result };
}
