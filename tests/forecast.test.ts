import { afterEach, describe, expect, it, vi } from "vitest";
import { AREAS, SETTINGS, THRESHOLDS } from "../src/config";
import { clearForecastCache, loadForecast } from "../src/forecast";
import { DataError, fetchJson, NetworkError } from "../src/openmeteo";
import ecmwf20260321 from "./fixtures/ecmwf_ifs025_2026-03-21.json";
import gsm20260321 from "./fixtures/jma_gsm_2026-03-21.json";
import msm20260321 from "./fixtures/jma_msm_2026-03-21.json";

const AREA = AREAS[0];

const FIXTURES: Readonly<Record<string, unknown>> = {
  jma_msm: msm20260321,
  jma_gsm: gsm20260321,
  ecmwf_ifs025: ecmwf20260321,
};

/** URL の models= に応じてテスト用データを返す fetch。FIXTURES に無いモデルは通信失敗にする。 */
function stubFetch(): void {
  vi.stubGlobal("fetch", async (input: string | URL): Promise<Response> => {
    const model = new URL(String(input)).searchParams.get("models") ?? "";
    const body = FIXTURES[model];
    if (body === undefined) {
      throw new TypeError("Failed to fetch");
    }
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearForecastCache();
});

describe("loadForecast", () => {
  it("取れなかった傾向モデルは警告にして続行する", async () => {
    stubFetch(); // gfs_seamless は失敗
    const r = await loadForecast(AREA, SETTINGS, THRESHOLDS, "2026-03-21", 1);
    expect(r.historical).toBe(true);
    expect(r.days.map((d) => d.day)).toEqual(["2026-03-21"]);
    expect(r.days[0]?.spread.map((p) => p.model)).toEqual(["jma_msm", "jma_gsm", "ecmwf_ifs025"]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("gfs_seamless");
  });

  it("データが無い日は省いて警告する", async () => {
    stubFetch();
    const r = await loadForecast(AREA, SETTINGS, THRESHOLDS, "2026-03-21", 2);
    expect(r.days.map((d) => d.day)).toEqual(["2026-03-21"]);
    expect(r.warnings.at(-1)).toBe("データが無いため省いた日: 2026-03-22");
  });

  it("詳細モデルが取れなければ失敗にする", async () => {
    vi.stubGlobal("fetch", async (): Promise<Response> => {
      throw new TypeError("Failed to fetch");
    });
    await expect(loadForecast(AREA, SETTINGS, THRESHOLDS, "2026-03-21", 1)).rejects.toBeInstanceOf(DataError);
  });
});

describe("キャッシュ", () => {
  it("同じ条件の2回目は取得し直さない", async () => {
    const fetchSpy = vi.fn(async (input: string | URL): Promise<Response> => {
      const model = new URL(String(input)).searchParams.get("models") ?? "";
      return new Response(JSON.stringify(FIXTURES[model] ?? { error: true, reason: "no model" }), {
        status: FIXTURES[model] === undefined ? 400 : 200,
      });
    });
    vi.stubGlobal("fetch", fetchSpy);
    await loadForecast(AREA, SETTINGS, THRESHOLDS, "2026-03-21", 1);
    await loadForecast(AREA, SETTINGS, THRESHOLDS, "2026-03-21", 1);
    // 1回目: 4モデル。2回目: 失敗した gfs_seamless だけ取り直す
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });
});

describe("fetchJson", () => {
  it("通信できなければ NetworkError", async () => {
    vi.stubGlobal("fetch", async (): Promise<Response> => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchJson("https://example.invalid/")).rejects.toBeInstanceOf(NetworkError);
  });

  it("JSON でないエラー応答は HTTP の状態を伝える", async () => {
    vi.stubGlobal(
      "fetch",
      async (): Promise<Response> =>
        new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" }),
    );
    await expect(fetchJson("https://example.invalid/")).rejects.toThrow("HTTP 502: Bad Gateway");
  });

  it("Open-Meteo のエラー理由を伝える", async () => {
    vi.stubGlobal(
      "fetch",
      async (): Promise<Response> =>
        new Response(JSON.stringify({ error: true, reason: "start_date is out of range" }), { status: 400 }),
    );
    await expect(fetchJson("https://example.invalid/")).rejects.toThrow("HTTP 400: start_date is out of range");
  });
});
