import { describe, expect, it } from "vitest";
import {
  analyzeHour,
  classify,
  inversionLayers,
  modelPeak,
  parcelTop,
  roughLayer,
  type SummarizeOptions,
  summarizeDay,
} from "../src/analysis";
import { bandsAreContiguous, SETTINGS, THRESHOLDS } from "../src/config";
import { type HourProfile, type ModelForecast, parse } from "../src/openmeteo";
import ecmwf20260321 from "./fixtures/ecmwf_ifs025_2026-03-21.json";
import gfs20220115 from "./fixtures/gfs_seamless_2022-01-15.json";
import gsm20260321 from "./fixtures/jma_gsm_2026-03-21.json";
import msm20260117 from "./fixtures/jma_msm_2026-01-17.json";
import msm20260321 from "./fixtures/jma_msm_2026-03-21.json";

const TH = THRESHOLDS;
const OPTS: SummarizeOptions = { th: TH, hours: SETTINGS.hours, displayMaxM: SETTINGS.displayMaxM };

const load = (data: unknown, model: string): ModelForecast =>
  parse(data, model, SETTINGS.pressureLevels, SETTINGS.hours);

function profile(t2m: number, levels: readonly (readonly [number, number])[], td2m: number | null = null): HourProfile {
  return { t2m, td2m, cloud: null, sw: null, levels: levels.map(([heightM, tempC]) => ({ heightM, tempC })) };
}

describe("config", () => {
  it("区間が全範囲を隙間なく覆っている", () => {
    expect(bandsAreContiguous(TH.lapseClasses)).toBe(true);
    expect(bandsAreContiguous(TH.topClasses)).toBe(true);
  });
});

describe("parcelTop", () => {
  it("空気塊が周りの気温と交わる高さ", () => {
    // 地上 300m 20℃。1300m で環境 10℃ → 空気塊 10.2℃（まだ暖かい）、2300m で環境 3℃ → 空気塊 0.4℃（冷たい）
    const r = parcelTop(
      profile(20, [
        [1300, 10],
        [2300, 3],
      ]),
      300,
    );
    expect(r.capped).toBe(false);
    expect(r.topM).toBeCloseTo(1300 + (1000 * 0.2) / 2.8, 3);
  });

  it("地上直上が逆転なら頂は地上", () => {
    const r = parcelTop(
      profile(10, [
        [500, 11],
        [1000, 8],
      ]),
      300,
    );
    expect(r).toEqual({ topM: 300, capped: false });
  });

  it("最上面でも暖かければデータ上端で打ち切り", () => {
    expect(
      parcelTop(
        profile(20, [
          [1300, 5],
          [2300, -5],
        ]),
        300,
      ),
    ).toEqual({ topM: 2300, capped: true });
  });
});

describe("analyzeHour", () => {
  it("雲底の方が低ければ雲底が上限", () => {
    const r = analyzeHour(
      13,
      profile(
        20,
        [
          [1300, 5],
          [2300, -5],
        ],
        14,
      ),
      300,
      TH,
    ); // 雲底 = 300 + 125*6
    expect(r.top.cloudLimited).toBe(true);
    expect(r.top.topM).toBeCloseTo(1050);
    expect(r.top.dryM).toBeGreaterThan(r.top.topM);
  });

  it("地表層は荒れの判定から外す", () => {
    const r = analyzeHour(
      13,
      profile(20, [
        [400, 18],
        [1300, 10],
        [2300, 3],
      ]),
      300,
      TH,
    );
    expect(r.layers[0]?.surface).toBe(true);
    expect(roughLayer(r, TH)).toBeNull();
  });

  it("逆転層を拾う", () => {
    const r = analyzeHour(
      13,
      profile(15, [
        [500, 13.5],
        [900, 14.5],
        [1500, 10],
      ]),
      300,
      TH,
    );
    expect(inversionLayers(r, 1700).map((l) => [l.bottomM, l.topM])).toEqual([[500, 900]]);
  });
});

describe("classify", () => {
  it("減率の区分", () => {
    const ids = [-0.1, 0, 0.49, 0.5, 0.7, 0.89, 0.9, 1.5].map((v) => classify(TH.lapseClasses, v).id);
    expect(ids).toEqual(["inversion", "stable", "stable", "weakish", "good", "good", "strong", "strong"]);
  });

  it("到達高度の区分", () => {
    const ids = [600, 800, 1099, 1100, 1500, 2500].map((v) => classify(TH.topClasses, v).id);
    expect(ids).toEqual(["poor", "local", "local", "good", "strong", "strong"]);
  });
});

describe("過去予報（Python 版 lapse-report と同じ結果になること）", () => {
  it("2026-03-21 春の強い日", () => {
    const s = summarizeDay(
      "2026-03-21",
      load(msm20260321, "jma_msm"),
      [load(gsm20260321, "jma_gsm"), load(ecmwf20260321, "ecmwf_ifs025")],
      OPTS,
    );
    expect(s?.detail).toBe(true);
    expect(s?.rating.id).toBe("strong");
    expect(Math.round(s?.topM ?? 0)).toBe(2082);
    expect(s?.peakHour).toBe(15);
    expect(s?.hours).toHaveLength(SETTINGS.hours.length);
    expect(s?.spread.map((p) => [p.model, Math.round(p.topM)])).toEqual([
      ["jma_msm", 2082],
      ["jma_gsm", 2105],
      ["ecmwf_ifs025", 2224],
    ]);
  });

  it("2026-01-17 冬の渋い日", () => {
    const s = summarizeDay("2026-01-17", load(msm20260117, "jma_msm"), [], OPTS);
    expect(s?.rating.id).toBe("poor");
    expect(Math.round(s?.topM ?? 0)).toBe(596);
    expect(s?.usableHours).toEqual([]);
  });

  it("詳細モデルが無い日は傾向モデルの中央値", () => {
    const empty: ModelForecast = { model: "jma_msm", groundM: 297, hours: new Map() };
    const trends = [load(gsm20260321, "jma_gsm"), load(ecmwf20260321, "ecmwf_ifs025")];
    const s = summarizeDay("2026-03-21", empty, trends, OPTS);
    expect(s?.detail).toBe(false);
    expect(s?.hours).toEqual([]);
    expect(s?.topM).toBeCloseTo(((s?.spread[0]?.topM ?? 0) + (s?.spread[1]?.topM ?? 0)) / 2);
  });

  it("詳細モデルが一部の時刻だけの日は傾向の1モデルとして数える", () => {
    const full = load(msm20260321, "jma_msm");
    const day = full.hours.get("2026-03-21") ?? new Map<number, HourProfile>();
    const partial: ModelForecast = {
      ...full,
      hours: new Map([["2026-03-21", new Map([...day].filter(([h]) => h <= 14))]]),
    };
    const s = summarizeDay("2026-03-21", partial, [load(gsm20260321, "jma_gsm")], OPTS);
    expect(s?.detail).toBe(false);
    expect(s?.spread.map((p) => p.model)).toEqual(["jma_msm", "jma_gsm"]);
    expect(s?.notes.at(-1)).toBe("jma_msm は 9〜14時のみ（予報範囲の端）");
  });

  it("2022-01-15 日記「1300mほど上がりました」を GFS の +0℃ で", () => {
    const pk = modelPeak(load(gfs20220115, "gfs_seamless"), "2022-01-15");
    expect(Math.round(pk?.topM ?? 0)).toBe(1156);
    expect(pk?.hour).toBe(12);
  });

  it("地上より低い面は捨て、面は低い順", () => {
    const f = load(msm20260321, "jma_msm");
    for (const p of f.hours.get("2026-03-21")?.values() ?? []) {
      expect(p.levels.every((lv) => lv.heightM > f.groundM)).toBe(true);
      expect(p.levels.every((lv, i, a) => i === 0 || (a[i - 1]?.heightM ?? 0) < lv.heightM)).toBe(true);
    }
  });
});
