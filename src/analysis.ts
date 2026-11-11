/**
 * 気温減率・サーマル到達高度・雲底の計算と、日ごとのまとめ。
 *
 * 到達高度はパーセル法: 地上 2m 気温の空気塊を乾燥断熱減率で持ち上げ、周りの気温を下回る高さ。
 * 上乗せ温度は +0℃ 固定（nasa 日記の到達高度と一致し、+2℃ は約300m 過大だったため。docs/knowledge.md 参照）。
 */

import type { Band, LapseClassId, Thresholds, TopClassId } from "./config";
import type { HourProfile, ModelForecast } from "./openmeteo";

export const DRY_ADIABATIC_C_PER_100M = 0.98;
export const LCL_M_PER_C = 125;
/** 地上より上にこれだけ面があれば、毎時の減率表を出せる（MSM は 6〜7、GSM/ECMWF は 2〜3） */
const MIN_DETAIL_LEVELS = 3;

export interface Layer {
  readonly bottomM: number;
  readonly topM: number;
  /** ℃/100m（正 = 上ほど冷たい） */
  readonly lapse: number;
  readonly cls: Band<LapseClassId>;
  /** 地上2m → 最下層の面（超断熱が出やすいので評価から外す） */
  readonly surface: boolean;
}

export interface Top {
  readonly dryM: number;
  /** データの最上面でもまだ空気塊の方が暖かい */
  readonly capped: boolean;
  readonly lclM: number | null;
  readonly cloudLimited: boolean;
  /** 実際に使える上限 = min(乾燥の頂, 雲底) */
  readonly topM: number;
}

export interface HourResult {
  readonly hour: number;
  readonly t2m: number;
  readonly top: Top;
  readonly layers: readonly Layer[];
  readonly cloud: number | null;
  readonly sw: number | null;
}

export interface ModelPeak {
  readonly model: string;
  readonly topM: number;
  readonly hour: number;
}

export interface DaySummary {
  readonly day: string;
  /** 詳細モデル（MSM）の毎時プロファイルがある日 */
  readonly detail: boolean;
  /** 主の値（詳細日は MSM、傾向日はモデルの中央値） */
  readonly topM: number;
  readonly peakHour: number | null;
  readonly rating: Band<TopClassId>;
  /** 全モデルのピーク（ばらつき表示用） */
  readonly spread: readonly ModelPeak[];
  /** 詳細日のみ */
  readonly hours: readonly HourResult[];
  /** 詳細日のみ: top ≥ usableTopM の時刻 */
  readonly usableHours: readonly number[];
  readonly notes: readonly string[];
}

export function classify<Id extends string>(bands: readonly Band<Id>[], value: number): Band<Id> {
  const found = bands.find((b) => (b.min === null || value >= b.min) && (b.max === null || value < b.max));
  if (found === undefined) {
    throw new RangeError(`区間に当てはまりません: ${value}`);
  }
  return found;
}

type Point = readonly [heightM: number, tempC: number];

function points(p: HourProfile, groundM: number): Point[] {
  return [[groundM, p.t2m], ...p.levels.map((lv): Point => [lv.heightM, lv.tempC])];
}

export function parcelTop(p: HourProfile, groundM: number): { readonly topM: number; readonly capped: boolean } {
  const pts = points(p, groundM);
  let prevZ = groundM;
  let prevD = 0;
  for (const [z, env] of pts.slice(1)) {
    const d = p.t2m - (DRY_ADIABATIC_C_PER_100M * (z - groundM)) / 100 - env;
    if (d < 0) {
      const frac = prevD > d ? prevD / (prevD - d) : 0;
      return { topM: prevZ + (z - prevZ) * frac, capped: false };
    }
    prevZ = z;
    prevD = d;
  }
  return { topM: pts.at(-1)?.[0] ?? groundM, capped: true };
}

export function hourTop(p: HourProfile, groundM: number): Top {
  const { topM: dryM, capped } = parcelTop(p, groundM);
  const lclM = p.td2m === null ? null : groundM + LCL_M_PER_C * (p.t2m - p.td2m);
  const cloudLimited = lclM !== null && lclM < dryM;
  return { dryM, capped, lclM, cloudLimited, topM: cloudLimited && lclM !== null ? lclM : dryM };
}

export function layers(p: HourProfile, groundM: number, th: Thresholds): Layer[] {
  const pts = points(p, groundM);
  return pts.slice(1).flatMap(([z1, t1], i) => {
    const prev = pts[i];
    if (prev === undefined) {
      return [];
    }
    const [z0, t0] = prev;
    const lapse = ((t0 - t1) / (z1 - z0)) * 100;
    return [{ bottomM: z0, topM: z1, lapse, cls: classify(th.lapseClasses, lapse), surface: i === 0 }];
  });
}

export function analyzeHour(hour: number, p: HourProfile, groundM: number, th: Thresholds): HourResult {
  return { hour, t2m: p.t2m, top: hourTop(p, groundM), layers: layers(p, groundM, th), cloud: p.cloud, sw: p.sw };
}

/** 乾燥の頂を含む層（ここで頭打ちになる）。地表層とデータ上端超えは除く。 */
export function capLayer(h: HourResult): Layer | null {
  if (h.top.capped) {
    return null;
  }
  return h.layers.find((l) => !l.surface && l.bottomM <= h.top.dryM && h.top.dryM <= l.topM) ?? null;
}

/** 到達高度より下で、減率が荒れの基準以上の層のうち最も強いもの。 */
export function roughLayer(h: HourResult, th: Thresholds): Layer | null {
  const cands = h.layers.filter((l) => !l.surface && l.bottomM < h.top.topM && l.lapse >= th.roughLapse);
  return cands.reduce<Layer | null>((best, l) => (best === null || l.lapse > best.lapse ? l : best), null);
}

/** 表示範囲内（下端が maxM 未満）の逆転層。地表層は除く。 */
export function inversionLayers(h: HourResult, maxM: number): Layer[] {
  return h.layers.filter((l) => !l.surface && l.lapse < 0 && l.bottomM < maxM);
}

export function modelPeak(f: ModelForecast, day: string): ModelPeak | null {
  const hours = f.hours.get(day);
  if (hours === undefined || hours.size === 0) {
    return null;
  }
  let best: ModelPeak | null = null;
  for (const [hour, p] of hours) {
    const topM = hourTop(p, f.groundM).topM;
    if (best === null || topM > best.topM) {
      best = { model: f.model, topM, hour };
    }
  }
  return best;
}

export function hasDetail(f: ModelForecast, day: string, hours: readonly number[]): boolean {
  const d = f.hours.get(day);
  return d !== undefined && hours.every((h) => (d.get(h)?.levels.length ?? 0) >= MIN_DETAIL_LEVELS);
}

const fmt = (m: number): string => `${Math.round(m).toLocaleString("en-US")}m`;

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const hi = s[mid] ?? Number.NaN;
  return s.length % 2 === 1 ? hi : ((s[mid - 1] ?? hi) + hi) / 2;
}

function detailNotes(
  peak: HourResult,
  usable: readonly number[],
  rating: Band,
  th: Thresholds,
  displayMaxM: number,
): string[] {
  const { top } = peak;
  const notes = [`到達 ${fmt(top.topM)}（${peak.hour}時）: ${rating.label}`];
  if (top.lclM !== null) {
    notes.push(
      top.cloudLimited
        ? `雲底 ${fmt(top.lclM)} で頭打ち（積雲が出る見込み）`
        : `雲底 ${fmt(top.lclM)} は到達より上（ブルーサーマルの見込み）`,
    );
  }
  const cap = capLayer(peak);
  if (top.capped) {
    notes.push(`乾燥の頂はデータ上端 ${fmt(top.dryM)} を超える`);
  } else if (cap !== null) {
    notes.push(`頭打ちの層: ${fmt(cap.bottomM)}〜${fmt(cap.topM)}（${cap.lapse.toFixed(2)}℃/100m・${cap.cls.label}）`);
  }
  const first = usable[0];
  const last = usable.at(-1);
  notes.push(
    first !== undefined && last !== undefined
      ? `${fmt(th.usableTopM)} 以上に届くのは ${first}〜${last}時`
      : `${fmt(th.usableTopM)} に届く時間なし`,
  );
  const inv = inversionLayers(peak, displayMaxM)[0];
  notes.push(
    inv === undefined
      ? `逆転層なし（${fmt(displayMaxM)} まで）`
      : `逆転層: ${fmt(inv.bottomM)}〜${fmt(inv.topM)}（${inv.lapse.toFixed(2)}℃/100m）`,
  );
  const rough = roughLayer(peak, th);
  if (rough !== null) {
    notes.push(`荒れ注意: ${fmt(rough.bottomM)}〜${fmt(rough.topM)} が ${rough.lapse.toFixed(2)}℃/100m`);
  }
  return notes;
}

export interface SummarizeOptions {
  readonly th: Thresholds;
  readonly hours: readonly number[];
  readonly displayMaxM: number;
}

export function summarizeDay(
  day: string,
  detail: ModelForecast,
  trends: readonly ModelForecast[],
  { th, hours, displayMaxM }: SummarizeOptions,
): DaySummary | null {
  const trendPeaks = trends.flatMap((f) => modelPeak(f, day) ?? []);
  const detailHours = detail.hours.get(day);
  if (detailHours !== undefined && hasDetail(detail, day, hours)) {
    const hrs = hours.flatMap((h) => {
      const p = detailHours.get(h);
      return p === undefined ? [] : [analyzeHour(h, p, detail.groundM, th)];
    });
    const peak = hrs.reduce((best, r) => (r.top.topM > best.top.topM ? r : best));
    const usable = hrs.filter((r) => r.top.topM >= th.usableTopM).map((r) => r.hour);
    const rating = classify(th.topClasses, peak.top.topM);
    return {
      day,
      detail: true,
      topM: peak.top.topM,
      peakHour: peak.hour,
      rating,
      spread: [{ model: detail.model, topM: peak.top.topM, hour: peak.hour }, ...trendPeaks],
      hours: hrs,
      usableHours: usable,
      notes: detailNotes(peak, usable, rating, th, displayMaxM),
    };
  }
  // 詳細モデルが一部の時刻だけ持っている日（MSM の範囲の端）は、傾向の1モデルとして数える
  const partial = modelPeak(detail, day);
  const peaks = partial === null ? trendPeaks : [partial, ...trendPeaks];
  if (peaks.length === 0) {
    return null;
  }
  const tops = peaks.map((p) => p.topM);
  const med = median(tops);
  const rating = classify(th.topClasses, med);
  const notes = [`傾向（${peaks.length}モデル）: 中央 ${fmt(med)}・${rating.label}`];
  if (peaks.length > 1) {
    notes.push(`モデル間の幅 ${fmt(Math.min(...tops))}〜${fmt(Math.max(...tops))}`);
  }
  if (partial !== null && detailHours !== undefined) {
    const hs = [...detailHours.keys()].sort((a, b) => a - b);
    notes.push(`${detail.model} は ${hs[0]}〜${hs.at(-1)}時のみ（予報範囲の端）`);
  }
  return { day, detail: false, topM: med, peakHour: null, rating, spread: peaks, hours: [], usableHours: [], notes };
}
