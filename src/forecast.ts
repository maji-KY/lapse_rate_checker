/** 4モデルの並列取得と、日ごとのまとめ。 */

import { type DaySummary, summarizeDay } from "./analysis";
import type { Area, Settings, Thresholds } from "./config";
import { addDays, type JstNow, jstNow } from "./dates";
import { buildUrl, DataError, fetchJson, type ModelForecast, parse } from "./openmeteo";

export interface ForecastResult {
  readonly start: string;
  readonly days: readonly DaySummary[];
  /** 終了日まで過去（その日に出ていた予報） */
  readonly historical: boolean;
  readonly warnings: readonly string[];
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 同じ URL を短時間に取り直さない（モデルの更新は数時間おき）。失敗した取得は残さない */
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { readonly at: number; readonly body: Promise<unknown> }>();

function cachedFetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const hit = cache.get(url);
  if (hit !== undefined && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.body;
  }
  const body = fetchJson(url, signal);
  cache.set(url, { at: Date.now(), body });
  body.catch(() => cache.delete(url));
  return body;
}

export function clearForecastCache(): void {
  cache.clear();
}

export async function loadForecast(
  area: Area,
  settings: Settings,
  th: Thresholds,
  start: string,
  days: number,
  signal?: AbortSignal,
  now: JstNow = jstNow(),
): Promise<ForecastResult> {
  const end = addDays(start, days - 1);
  // 終了日まで過去なら過去予報の API。今日以降を含む範囲は通常の予報 API（過去の開始日も受け付ける）
  const historical = end < now.date;
  const fetchModel = async (model: string): Promise<ModelForecast> =>
    parse(
      await cachedFetchJson(buildUrl(settings, area, model, start, end, historical), signal),
      model,
      settings.pressureLevels,
      settings.hours,
    );

  const detailPromise = fetchModel(settings.detailModel);
  const trendResults = Promise.allSettled(settings.trendModels.map(fetchModel));
  let detail: ModelForecast;
  try {
    detail = await detailPromise;
  } catch (e) {
    throw new DataError(`${settings.detailModel} を取得できませんでした: ${errorText(e)}`, { cause: e });
  }
  const warnings: string[] = [];
  const trends = (await trendResults).flatMap((r, i) => {
    if (r.status === "fulfilled") {
      return [r.value];
    }
    warnings.push(`${settings.trendModels[i]} を取得できなかったため、傾向から外しました: ${errorText(r.reason)}`);
    return [];
  });

  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
  const opts = { th, hours: settings.hours, displayMaxM: settings.displayMaxM };
  const summaries = dates.flatMap((d) => summarizeDay(d, detail, trends, opts) ?? []);
  if (summaries.length === 0) {
    throw new DataError(`${start}〜${end} に使えるデータがありません（予報範囲外の可能性）`);
  }
  const covered = new Set(summaries.map((s) => s.day));
  const missing = dates.filter((d) => !covered.has(d));
  if (missing.length > 0) {
    warnings.push(`データが無いため省いた日: ${missing.join(", ")}`);
  }
  return { start, days: summaries, historical, warnings };
}
