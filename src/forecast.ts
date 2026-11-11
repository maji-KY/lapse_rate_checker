/** 4モデルの並列取得と、日ごとのまとめ。 */

import { type DaySummary, summarizeDay } from "./analysis";
import type { Area, Settings, Thresholds } from "./config";
import { addDays, jstNow } from "./dates";
import { buildUrl, DataError, fetchJson, type ModelForecast, parse } from "./openmeteo";

export interface ForecastResult {
  readonly start: string;
  readonly days: readonly DaySummary[];
  /** 終了日まで過去（その日に出ていた予報） */
  readonly historical: boolean;
  readonly warnings: readonly string[];
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function loadForecast(
  area: Area,
  settings: Settings,
  th: Thresholds,
  start: string,
  days: number,
  signal?: AbortSignal,
): Promise<ForecastResult> {
  const end = addDays(start, days - 1);
  // 終了日まで過去なら過去予報の API。今日以降を含む範囲は通常の予報 API（過去の開始日も受け付ける）
  const historical = end < jstNow().date;
  const fetchModel = async (model: string): Promise<ModelForecast> =>
    parse(
      await fetchJson(buildUrl(settings, area, model, start, end, historical), signal),
      model,
      settings.pressureLevels,
      settings.hours,
    );

  const [detailRes, ...trendRes] = await Promise.allSettled([
    fetchModel(settings.detailModel),
    ...settings.trendModels.map(fetchModel),
  ]);
  if (detailRes === undefined || detailRes.status === "rejected") {
    throw new DataError(`${settings.detailModel} を取得できませんでした: ${errorText(detailRes?.reason)}`);
  }
  const warnings: string[] = [];
  const trends = trendRes.flatMap((r, i) => {
    if (r.status === "fulfilled") {
      return [r.value];
    }
    warnings.push(`${settings.trendModels[i]} を取得できなかったため、傾向から外しました: ${errorText(r.reason)}`);
    return [];
  });

  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
  const opts = { th, hours: settings.hours, displayMaxM: settings.displayMaxM };
  const summaries = dates.flatMap((d) => summarizeDay(d, detailRes.value, trends, opts) ?? []);
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
