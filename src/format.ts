/** 表示用の数値フォーマット（要点の文・グラフ・表で共通）。 */

export const num = (m: number): string => Math.round(m).toLocaleString("ja-JP");

export const fmtM = (m: number): string => `${num(m)}m`;

export const fmtRangeM = (lo: number, hi: number): string => `${fmtM(lo)}〜${fmtM(hi)}`;

/** 減率（℃/100m）。単位まで付ける */
export const fmtLapse = (lapse: number): string => `${lapse.toFixed(2)}℃/100m`;

/** 表示範囲より上の値は ↑ を付ける（グラフでは上端に寄せて描くため）。単位なし */
export const topLabel = (m: number, displayMaxM: number): string => (m > displayMaxM ? "↑" : "") + num(m);
