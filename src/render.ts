/** 週間グラフ・日付カード・時間×高さの減率表・毎時の表の描画。 */

import type { DaySummary, HourResult } from "./analysis";
import type { Area, Band, Settings, Thresholds, TopClassId } from "./config";
import { dayLabel } from "./dates";
import { h, svg } from "./dom";

export interface RenderContext {
  readonly area: Area;
  readonly settings: Settings;
  readonly th: Thresholds;
}

interface Pad {
  readonly l: number;
  readonly r: number;
  readonly t: number;
  readonly b: number;
}

const num = (m: number): string => Math.round(m).toLocaleString("ja-JP");
const fmt = (m: number): string => `${num(m)}m`;
const lapseColor = (id: string): string => `var(--c-${id})`;
const TOP_COLOR: Readonly<Record<TopClassId, string>> = {
  poor: "var(--c-poor)",
  local: "var(--c-local)",
  good: "var(--c-top-good)",
  strong: "var(--c-top-strong)",
};

/** 区間 {min,max} の表示。unit は数値の後ろに付ける文字 */
function rangeText(b: Band, unit: string): string {
  if (b.min === null) return `${b.max}${unit}未満`;
  if (b.max === null) return `${b.min}${unit}以上`;
  return `${b.min}〜${b.max}${unit}`;
}

function scales(ctx: RenderContext) {
  const lo = ctx.settings.displayMinM;
  const hi = ctx.settings.displayMaxM;
  /** 表示範囲より上の値は ↑ を付ける（グラフは上端に寄せる） */
  const topLabel = (m: number): string => (m > hi ? "↑" : "") + num(m);
  const y =
    (height: number, pad: Pad) =>
    (m: number): number =>
      pad.t + (1 - (Math.min(Math.max(m, lo), hi) - lo) / (hi - lo)) * (height - pad.t - pad.b);
  const ticks: number[] = [];
  for (let m = Math.ceil(lo / 300) * 300; m <= hi; m += 300) ticks.push(m);
  return { topLabel, y, ticks };
}

/** gridX2 = 目盛り線の右端。null なら線を引かず数値だけ（減率表の上に線を重ねないため） */
function axis(root: SVGSVGElement, y: (m: number) => number, left: number, gridX2: number | null, ticks: number[]) {
  for (const m of ticks) {
    if (gridX2 !== null) root.append(svg("line", { x1: left, x2: gridX2, y1: y(m), y2: y(m), stroke: "var(--grid)" }));
    root.append(svg("text", { x: left - 6, y: y(m) + 4, "text-anchor": "end" }, num(m)));
  }
}

function refLine(root: SVGSVGElement, yy: number, x1: number, x2: number, color: string, label: string, dash = "") {
  root.append(svg("line", { x1, x2, y1: yy, y2: yy, stroke: color, "stroke-width": 1.5, "stroke-dasharray": dash }));
  root.append(svg("text", { x: x2 - 4, y: yy - 4, "text-anchor": "end", style: `fill:${color}` }, label));
}

export function renderWeek(ctx: RenderContext, days: readonly DaySummary[], onSelect: (i: number) => void): Node[] {
  const W = 960;
  const H = 320;
  const pad: Pad = { l: 48, r: 12, t: 16, b: 40 };
  const { topLabel, y: yOf, ticks } = scales(ctx);
  const y = yOf(H, pad);
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "7日間の到達高度" });
  axis(root, y, pad.l, W - pad.r, ticks);
  const slot = (W - pad.l - pad.r) / days.length;
  const bw = Math.min(56, slot * 0.5);
  days.forEach((d, i) => {
    const cx = pad.l + slot * (i + 0.5);
    const color = TOP_COLOR[d.rating.id];
    const g = svg("g", { style: "cursor:pointer" });
    g.addEventListener("click", () => onSelect(i));
    g.append(
      svg("rect", {
        x: cx - bw / 2,
        y: y(d.topM),
        width: bw,
        height: y(ctx.settings.displayMinM) - y(d.topM),
        rx: 4,
        fill: color,
        "fill-opacity": d.detail ? 1 : 0.45,
        stroke: d.detail ? "none" : color,
        "stroke-dasharray": "4 3",
      }),
    );
    const tops = d.spread.map((s) => s.topM);
    const lo = Math.min(...tops);
    const hi = Math.max(...tops);
    if (tops.length > 1) {
      g.append(svg("line", { x1: cx, x2: cx, y1: y(lo), y2: y(hi), stroke: "var(--ink)", "stroke-width": 1.5 }));
      for (const v of [lo, hi]) {
        g.append(
          svg("line", { x1: cx - 8, x2: cx + 8, y1: y(v), y2: y(v), stroke: "var(--ink)", "stroke-width": 1.5 }),
        );
      }
    }
    const labelAt = Math.max(d.topM, ...tops);
    const valueStyle = "fill:var(--ink);font-weight:600";
    g.append(
      svg(
        "text",
        { class: "halo", x: cx, y: y(labelAt) - 8, "text-anchor": "middle", style: valueStyle },
        topLabel(d.topM),
      ),
    );
    g.append(svg("text", { x: cx, y: H - 22, "text-anchor": "middle", style: "fill:var(--ink)" }, dayLabel(d.day)));
    g.append(svg("text", { x: cx, y: H - 8, "text-anchor": "middle" }, d.detail ? "詳細" : "傾向"));
    const width = tops.length > 1 ? `（モデル幅 ${fmt(lo)}〜${fmt(hi)}）` : "";
    g.append(svg("title", {}, `${dayLabel(d.day)} ${fmt(d.topM)} ${d.rating.label}${width}`));
    root.append(g);
  });
  refLine(root, y(ctx.area.summitM), pad.l, W - pad.r, "var(--summit)", `山頂 ${ctx.area.summitM}m`);
  refLine(root, y(ctx.th.usableTopM), pad.l, W - pad.r, "var(--usable)", `${ctx.th.usableTopM}m`, "4 4");

  const legend = h("div", { class: "legend" });
  for (const b of ctx.th.topClasses) {
    legend.append(
      h("span", {}, [h("i", { style: `background:${TOP_COLOR[b.id]}` }), `${b.label}（${rangeText(b, "m")}）`]),
    );
  }
  const trendNames = ctx.settings.trendModels.join("・");
  legend.append(h("span", {}, [`薄い棒 = 傾向（4日目以降、${trendNames} の中央値）／ ひげ = モデル間の幅`]));
  return [h("div", { class: "chart" }, [root]), legend];
}

function renderGrid(ctx: RenderContext, d: DaySummary): SVGSVGElement {
  const W = 960;
  const H = 420;
  const pad: Pad = { l: 48, r: 12, t: 16, b: 28 };
  const { topLabel, y: yOf, ticks } = scales(ctx);
  const y = yOf(H, pad);
  const maxM = ctx.settings.displayMaxM;
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "時間×高さの気温減率" });
  const pattern = svg("pattern", {
    id: "hatch",
    width: 6,
    height: 6,
    patternUnits: "userSpaceOnUse",
    patternTransform: "rotate(45)",
  });
  pattern.append(svg("rect", { width: 6, height: 6, fill: "var(--grid)" }));
  pattern.append(svg("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "var(--muted)", "stroke-width": 1.5 }));
  const defs = svg("defs");
  defs.append(pattern);
  root.append(defs);

  const cw = (W - pad.l - pad.r) / d.hours.length;
  const cx = (i: number) => pad.l + cw * (i + 0.5);
  d.hours.forEach((hr, i) => {
    const x = pad.l + cw * i;
    for (const l of hr.layers) {
      if (l.bottomM >= maxM) continue;
      const y1 = y(l.topM);
      const y2 = y(l.bottomM);
      const rect = svg("rect", {
        x: x + 1,
        y: y1,
        width: cw - 2,
        height: Math.max(0, y2 - y1),
        fill: l.surface ? "url(#hatch)" : lapseColor(l.cls.id),
      });
      const note = l.surface ? "（地表層・評価外）" : "";
      rect.append(
        svg("title", {}, `${hr.hour}時 ${num(l.bottomM)}〜${num(l.topM)}m: ${l.lapse.toFixed(2)}℃/100m${note}`),
      );
      root.append(rect);
      if (y2 - y1 > 16 && !l.surface) {
        const style = "fill:#111;font-size:10px;opacity:.75";
        root.append(
          svg("text", { x: x + cw - 6, y: (y1 + y2) / 2 + 4, "text-anchor": "end", style }, l.lapse.toFixed(2)),
        );
      }
    }
    root.append(svg("text", { x: cx(i), y: H - 8, "text-anchor": "middle", style: "fill:var(--ink)" }, `${hr.hour}時`));
  });
  axis(root, y, pad.l, null, ticks);
  refLine(root, y(ctx.area.summitM), pad.l, W - pad.r, "var(--summit)", `山頂 ${ctx.area.summitM}m`);

  const polyline = (pick: (hr: HourResult) => number | null, attrs: Readonly<Record<string, string | number>>) => {
    const pts = d.hours.flatMap((hr, i) => {
      const v = pick(hr);
      return v === null ? [] : [`${cx(i)},${y(v)}`];
    });
    root.append(svg("polyline", { points: pts.join(" "), fill: "none", ...attrs }));
  };
  polyline((hr) => hr.top.lclM, { stroke: "var(--lcl)", "stroke-width": 2, "stroke-dasharray": "6 4" });
  polyline((hr) => hr.top.topM, { stroke: "var(--top)", "stroke-width": 3 });
  d.hours.forEach((hr, i) => {
    root.append(svg("circle", { cx: cx(i), cy: y(hr.top.topM), r: 4, fill: "var(--top)" }));
    const style = "fill:var(--ink);font-weight:600;font-size:12px";
    root.append(
      svg(
        "text",
        { class: "halo", x: cx(i), y: y(hr.top.topM) - 8, "text-anchor": "middle", style },
        topLabel(hr.top.topM),
      ),
    );
  });
  return root;
}

function lapseLegend(ctx: RenderContext): HTMLElement {
  const legend = h("div", { class: "legend" });
  for (const b of ctx.th.lapseClasses) {
    legend.append(
      h("span", {}, [h("i", { style: `background:${lapseColor(b.id)}` }), `${b.label} ${rangeText(b, "")}`]),
    );
  }
  legend.append(
    h("span", {}, [h("i", { style: "background:var(--grid);border:1px dashed var(--muted)" }), "地表層（評価外）"]),
    h("span", {}, [h("i", { style: "background:var(--top)" }), "到達高度（+0℃）"]),
    h("span", {}, [h("i", { style: "background:var(--lcl)" }), "雲底（破線）"]),
  );
  return legend;
}

function table(head: readonly string[], rows: readonly (readonly string[])[]): HTMLElement {
  const t = h("table", {}, [
    h(
      "tr",
      {},
      head.map((c) => h("th", {}, [c])),
    ),
  ]);
  for (const r of rows)
    t.append(
      h(
        "tr",
        {},
        r.map((c) => h("td", {}, [c])),
      ),
    );
  return h("div", { class: "scroll" }, [t]);
}

function hourTable(d: DaySummary): HTMLElement {
  return table(
    ["時刻", "地上気温", "到達高度", "乾燥の頂", "雲底", "雲量", "日射"],
    d.hours.map((hr) => [
      `${hr.hour}時`,
      `${hr.t2m.toFixed(1)}℃`,
      fmt(hr.top.topM) + (hr.top.cloudLimited ? "（雲底）" : ""),
      (hr.top.capped ? "≥" : "") + fmt(hr.top.dryM),
      hr.top.lclM === null ? "—" : fmt(hr.top.lclM),
      hr.cloud === null ? "—" : `${Math.round(hr.cloud)}%`,
      hr.sw === null ? "—" : `${Math.round(hr.sw)}W/m²`,
    ]),
  );
}

export function renderDetail(ctx: RenderContext, d: DaySummary): Node[] {
  const title = h("h2", {}, [`${dayLabel(d.day)} `, h("span", { class: `badge r-${d.rating.id}` }, [d.rating.label])]);
  const notes = h(
    "ul",
    { class: "notes" },
    d.notes.map((n) => h("li", {}, [n])),
  );
  if (d.detail) {
    return [
      title,
      notes,
      h("div", { class: "chart" }, [renderGrid(ctx, d)]),
      lapseLegend(ctx),
      h("h2", { class: "sub" }, ["毎時の値"]),
      hourTable(d),
    ];
  }
  return [
    title,
    notes,
    h("p", { class: "trend-note" }, [
      "4日目以降は上空の層が粗いモデル（GSM・ECMWF は 925/850/700hPa のみ）なので、毎時の減率表は出していません。モデルごとの最高到達高度:",
    ]),
    table(
      ["モデル", "最高到達", "時刻"],
      d.spread.map((s) => [s.model, fmt(s.topM), `${s.hour}時`]),
    ),
  ];
}

export function renderDayCard(ctx: RenderContext, d: DaySummary, onSelect: () => void): HTMLButtonElement {
  const { topLabel } = scales(ctx);
  const source = d.detail
    ? `詳細（${ctx.settings.detailModel}）${d.peakHour === null ? "" : ` ${d.peakHour}時`}`
    : "傾向";
  const b = h("button", { class: "day", type: "button", "aria-pressed": "false" }, [
    h("div", { class: "d" }, [dayLabel(d.day)]),
    h("div", { class: "v" }, [`${topLabel(d.topM)}m`]),
    h("span", { class: `badge r-${d.rating.id}` }, [d.rating.label]),
    h("div", { class: "src" }, [source]),
  ]);
  b.addEventListener("click", onSelect);
  return b;
}
