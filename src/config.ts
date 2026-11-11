/** 地点・閾値・モデルの設定。根拠は docs/knowledge.md。 */

export interface Area {
  readonly id: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  readonly summitM: number;
}

/** [min, max) の区間。null は片側が開いている。 */
export interface Band<Id extends string = string> {
  readonly min: number | null;
  readonly max: number | null;
  readonly id: Id;
  readonly label: string;
}

export type LapseClassId = "inversion" | "stable" | "weakish" | "good" | "strong";
export type TopClassId = "poor" | "local" | "good" | "strong";

export interface Thresholds {
  readonly lapseClasses: readonly Band<LapseClassId>[];
  readonly topClasses: readonly Band<TopClassId>[];
  /** 「使える」とみなす到達高度（標高 m） */
  readonly usableTopM: number;
  /** これ以上の減率（℃/100m）を「荒れ注意」とする */
  readonly roughLapse: number;
}

export interface Settings {
  readonly dateCutoffHourJst: number;
  readonly hours: readonly number[];
  readonly days: number;
  readonly maxDays: number;
  readonly displayMinM: number;
  readonly displayMaxM: number;
  readonly forecastUrl: string;
  readonly historicalUrl: string;
  readonly detailModel: string;
  readonly trendModels: readonly string[];
  readonly pressureLevels: readonly number[];
}

export const AREAS: readonly Area[] = [
  { id: "ASHIO", name: "茨城県足尾山エリア", lat: 36.285, lon: 140.138, summitM: 628 },
];

export const SETTINGS: Settings = {
  dateCutoffHourJst: 16,
  hours: [9, 10, 11, 12, 13, 14, 15, 16],
  days: 7,
  maxDays: 16,
  displayMinM: 200,
  displayMaxM: 1700,
  forecastUrl: "https://api.open-meteo.com/v1/forecast",
  historicalUrl: "https://historical-forecast-api.open-meteo.com/v1/forecast",
  detailModel: "jma_msm",
  trendModels: ["jma_gsm", "ecmwf_ifs025", "gfs_seamless"],
  pressureLevels: [1000, 975, 950, 925, 900, 875, 850, 825, 800, 775, 750, 700],
};

/** 減率は DHV info 174/180、到達高度は nasa 日記と Technical Soaring の XC 条件から決めた暫定値。 */
export const THRESHOLDS: Thresholds = {
  lapseClasses: [
    { min: null, max: 0.0, id: "inversion", label: "逆転" },
    { min: 0.0, max: 0.5, id: "stable", label: "弱い・蓋" },
    { min: 0.5, max: 0.7, id: "weakish", label: "弱め" },
    { min: 0.7, max: 0.9, id: "good", label: "良い" },
    { min: 0.9, max: null, id: "strong", label: "強い・荒れ" },
  ],
  topClasses: [
    { min: null, max: 800, id: "poor", label: "渋い" },
    { min: 800, max: 1100, id: "local", label: "粘れる" },
    { min: 1100, max: 1500, id: "good", label: "良い" },
    { min: 1500, max: null, id: "strong", label: "強い" },
  ],
  usableTopM: 800,
  roughLapse: 0.9,
};

/** 区間が下から上へ隙間なく全範囲を覆っているか。隙間があると判定が黙ってずれるため、テストで確かめる。 */
export function bandsAreContiguous(bands: readonly Band[]): boolean {
  const first = bands[0];
  const last = bands.at(-1);
  if (first === undefined || last === undefined || first.min !== null || last.max !== null) {
    return false;
  }
  return bands.every((b, i) => i === 0 || bands[i - 1]?.max === b.min);
}
