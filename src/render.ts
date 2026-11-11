/** 週間グラフ・日付カード・時間×高さの減率表・毎時の表の描画。 */

import type { DaySummary, DetailDay, HourResult } from "./analysis";
import type { Area, Band, Settings, Thresholds } from "./config";
import { dayLabel } from "./dates";
import { h, svg } from "./dom";
import { fmtLapse, fmtM, fmtRangeM, num, topLabel } from "./format";

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

/** 減率の区分・到達高度の区分とも、色は CSS 変数 --c-<id> */
const bandColor = (id: string): string => `var(--c-${id})`;

/** 区間 {min,max} の表示。unit は数値の後ろに付ける文字 */
function rangeText(b: Band, unit: string): string {
  if (b.min === null) return `${b.max}${unit}未満`;
  if (b.max === null) return `${b.min}${unit}以上`;
  return `${b.min}〜${b.max}${unit}`;
}

/** 縦軸（表示範囲 displayMinM〜displayMaxM、超えた値は端に寄せる）と目盛り */
function makeScale(ctx: RenderContext, height: number, pad: Pad) {
  const lo = ctx.settings.displayMinM;
  const hi = ctx.settings.displayMaxM;
  const y = (m: number): number =>
    pad.t + (1 - (Math.min(Math.max(m, lo), hi) - lo) / (hi - lo)) * (height - pad.t - pad.b);
  const ticks: number[] = [];
  for (let m = Math.ceil(lo / 300) * 300; m <= hi; m += 300) ticks.push(m);
  return { y, ticks };
}

/** gridX2 = 目盛り線の右端。null なら線を引かず数値だけ（減率表の上に線を重ねないため） */
function axis(root: SVGSVGElement, y: (m: number) => number, left: number, gridX2: number | null, ticks: number[]) {
  for (const m of ticks) {
    if (gridX2 !== null) root.append(svg("line", { x1: left, x2: gridX2, y1: y(m), y2: y(m), class: "gridline" }));
    root.append(svg("text", { x: left - 6, y: y(m) + 4, "text-anchor": "end" }, num(m)));
  }
}

function refLine(root: SVGSVGElement, yy: number, x1: number, x2: number, color: string, label: string, dash = "") {
  root.append(svg("line", { x1, x2, y1: yy, y2: yy, stroke: color, "stroke-width": 1.5, "stroke-dasharray": dash }));
  root.append(svg("text", { x: x2 - 4, y: yy - 4, "text-anchor": "end", style: `fill:${color}` }, label));
}

function legendItem(swatchClass: string, swatchColor: string | null, label: string): HTMLElement {
  const attrs =
    swatchColor === null ? { class: swatchClass } : { class: swatchClass, style: `background:${swatchColor}` };
  return h("span", {}, [h("i", attrs), label]);
}

const W = 960;

export function renderWeek(ctx: RenderContext, days: readonly DaySummary[], onSelect: (i: number) => void): Node[] {
  const H = 320;
  const pad: Pad = { l: 48, r: 12, t: 16, b: 40 };
  const { y, ticks } = makeScale(ctx, H, pad);
  const maxM = ctx.settings.displayMaxM;
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "日ごとの到達高度" });
  axis(root, y, pad.l, W - pad.r, ticks);
  const slot = (W - pad.l - pad.r) / days.length;
  const bw = Math.min(56, slot * 0.5);
  days.forEach((d, i) => {
    const cx = pad.l + slot * (i + 0.5);
    const color = bandColor(d.rating.id);
    const detail = d.kind === "detail";
    const g = svg("g", { class: "bar" });
    g.addEventListener("click", () => onSelect(i));
    g.append(
      svg("rect", {
        x: cx - bw / 2,
        y: y(d.topM),
        width: bw,
        height: y(ctx.settings.displayMinM) - y(d.topM),
        rx: 4,
        fill: color,
        "fill-opacity": detail ? 1 : 0.45,
        stroke: detail ? "none" : color,
        "stroke-dasharray": "4 3",
      }),
    );
    const tops = d.spread.map((s) => s.topM);
    const range = tops.length > 1 ? { lo: Math.min(...tops), hi: Math.max(...tops) } : null;
    if (range !== null) {
      g.append(svg("line", { x1: cx, x2: cx, y1: y(range.lo), y2: y(range.hi), class: "whisker" }));
      for (const v of [range.lo, range.hi]) {
        g.append(svg("line", { x1: cx - 8, x2: cx + 8, y1: y(v), y2: y(v), class: "whisker" }));
      }
    }
    const labelAt = Math.max(d.topM, range?.hi ?? d.topM);
    g.append(
      svg("text", { class: "halo value", x: cx, y: y(labelAt) - 8, "text-anchor": "middle" }, topLabel(d.topM, maxM)),
    );
    g.append(svg("text", { class: "ink", x: cx, y: H - 22, "text-anchor": "middle" }, dayLabel(d.day)));
    g.append(svg("text", { x: cx, y: H - 8, "text-anchor": "middle" }, detail ? "詳細" : "傾向"));
    const width = range === null ? "" : `（モデル幅 ${fmtRangeM(range.lo, range.hi)}）`;
    g.append(svg("title", {}, `${dayLabel(d.day)} ${fmtM(d.topM)} ${d.rating.label}${width}`));
    root.append(g);
  });
  refLine(root, y(ctx.area.summitM), pad.l, W - pad.r, "var(--summit)", `山頂 ${fmtM(ctx.area.summitM)}`);
  refLine(root, y(ctx.th.usableTopM), pad.l, W - pad.r, "var(--usable)", fmtM(ctx.th.usableTopM), "4 4");

  const trendNames = ctx.settings.trendModels.join("・");
  const legend = h("div", { class: "legend" }, [
    ...ctx.th.topClasses.map((b) => legendItem("swatch", bandColor(b.id), `${b.label}（${rangeText(b, "m")}）`)),
    h("span", {}, [`薄い棒 = 傾向（4日目以降、${trendNames} の中央値）／ ひげ = モデル間の幅`]),
  ]);
  return [h("div", { class: "scroll" }, [root]), legend];
}

function renderGrid(ctx: RenderContext, d: DetailDay): SVGSVGElement {
  const H = 420;
  const pad: Pad = { l: 48, r: 12, t: 16, b: 28 };
  const { y, ticks } = makeScale(ctx, H, pad);
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
        fill: l.surface ? "url(#hatch)" : bandColor(l.cls.id),
      });
      const note = l.surface ? "（地表層・評価外）" : "";
      rect.append(svg("title", {}, `${hr.hour}時 ${fmtRangeM(l.bottomM, l.topM)}: ${fmtLapse(l.lapse)}${note}`));
      root.append(rect);
      if (y2 - y1 > 16 && !l.surface) {
        root.append(
          svg("text", { class: "cell", x: x + cw - 6, y: (y1 + y2) / 2 + 4, "text-anchor": "end" }, l.lapse.toFixed(2)),
        );
      }
    }
    root.append(svg("text", { class: "ink", x: cx(i), y: H - 8, "text-anchor": "middle" }, `${hr.hour}時`));
  });
  axis(root, y, pad.l, null, ticks);
  refLine(root, y(ctx.area.summitM), pad.l, W - pad.r, "var(--summit)", `山頂 ${fmtM(ctx.area.summitM)}`);

  const polyline = (pick: (hr: HourResult) => number | null, cls: string) => {
    const pts = d.hours.flatMap((hr, i) => {
      const v = pick(hr);
      return v === null ? [] : [`${cx(i)},${y(v)}`];
    });
    root.append(svg("polyline", { points: pts.join(" "), class: cls }));
  };
  polyline((hr) => hr.top.lclM, "lcl-line");
  polyline((hr) => hr.top.topM, "top-line");
  d.hours.forEach((hr, i) => {
    root.append(svg("circle", { cx: cx(i), cy: y(hr.top.topM), r: 4, class: "top-dot" }));
    root.append(
      svg(
        "text",
        { class: "halo value small", x: cx(i), y: y(hr.top.topM) - 8, "text-anchor": "middle" },
        topLabel(hr.top.topM, maxM),
      ),
    );
  });
  return root;
}

function lapseLegend(ctx: RenderContext): HTMLElement {
  return h("div", { class: "legend" }, [
    ...ctx.th.lapseClasses.map((b) => legendItem("swatch", bandColor(b.id), `${b.label} ${rangeText(b, "")}`)),
    legendItem("swatch swatch-surface", null, "地表層（評価外）"),
    legendItem("swatch swatch-top", null, "到達高度（+0℃）"),
    legendItem("swatch swatch-lcl", null, "雲底（破線）"),
  ]);
}

function table(head: readonly string[], rows: readonly (readonly string[])[]): HTMLElement {
  const row = (tag: "th" | "td") => (cells: readonly string[]) =>
    h(
      "tr",
      {},
      cells.map((c) => h(tag, {}, [c])),
    );
  return h("div", { class: "scroll" }, [h("table", {}, [row("th")(head), ...rows.map(row("td"))])]);
}

function hourTable(d: DetailDay): HTMLElement {
  return table(
    ["時刻", "地上気温", "到達高度", "乾燥の頂", "雲底", "雲量", "日射"],
    d.hours.map((hr) => [
      `${hr.hour}時`,
      `${hr.t2m.toFixed(1)}℃`,
      fmtM(hr.top.topM) + (hr.top.cloudLimited ? "（雲底）" : ""),
      (hr.top.capped ? "≥" : "") + fmtM(hr.top.dryM),
      hr.top.lclM === null ? "—" : fmtM(hr.top.lclM),
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
  if (d.kind === "detail") {
    return [
      title,
      notes,
      h("div", { class: "scroll" }, [renderGrid(ctx, d)]),
      lapseLegend(ctx),
      h("h2", { class: "sub" }, ["毎時の値"]),
      hourTable(d),
    ];
  }
  return [
    title,
    notes,
    h("p", { class: "trend-note" }, [
      "上空の層が粗いモデル（GSM・ECMWF は 925/850/700hPa のみ）なので、毎時の減率表は出していません。モデルごとの最高到達高度:",
    ]),
    table(
      ["モデル", "最高到達", "時刻"],
      d.spread.map((s) => [s.model, fmtM(s.topM), `${s.hour}時`]),
    ),
  ];
}

export function renderDayCard(ctx: RenderContext, d: DaySummary, onSelect: () => void): HTMLButtonElement {
  const source = d.kind === "detail" ? `詳細（${ctx.settings.detailModel}） ${d.peakHour}時` : "傾向";
  const b = h("button", { class: "day", type: "button", "aria-pressed": "false" }, [
    h("div", { class: "d" }, [dayLabel(d.day)]),
    h("div", { class: "v" }, [`${topLabel(d.topM, ctx.settings.displayMaxM)}m`]),
    h("span", { class: `badge r-${d.rating.id}` }, [d.rating.label]),
    h("div", { class: "src" }, [source]),
  ]);
  b.addEventListener("click", onSelect);
  return b;
}
