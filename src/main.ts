import { type DaySummary, DRY_ADIABATIC_C_PER_100M } from "./analysis";
import { AREAS, SETTINGS, THRESHOLDS } from "./config";
import { dayLabel, defaultStart, isIsoDate, jstNow } from "./dates";
import { h } from "./dom";
import { loadForecast } from "./forecast";
import { type RenderContext, renderDayCard, renderDetail, renderWeek } from "./render";

const area = AREAS[0];
const ctx: RenderContext = { area, settings: SETTINGS, th: THRESHOLDS };

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const e = document.getElementById(id);
  if (!(e instanceof type)) {
    throw new Error(`#${id} が見つかりません`);
  }
  return e;
}

const els = {
  title: byId("title", HTMLHeadingElement),
  form: byId("controls", HTMLFormElement),
  start: byId("start", HTMLInputElement),
  days: byId("days", HTMLSelectElement),
  status: byId("status", HTMLSpanElement),
  meta: byId("meta", HTMLDivElement),
  warnings: byId("warnings", HTMLUListElement),
  cards: byId("days-cards", HTMLDivElement),
  weekCard: byId("week-card", HTMLElement),
  week: byId("week", HTMLDivElement),
  detail: byId("detail", HTMLElement),
  footer: byId("footer", HTMLElement),
};

interface Query {
  /** null = 指定なし（16時より前は当日、以降は翌日から） */
  readonly date: string | null;
  readonly days: number;
}

const startOf = (q: Query): string => q.date ?? defaultStart(jstNow(), SETTINGS.dateCutoffHourJst);

/** URL の ?date=YYYY-MM-DD&days=N を読む。不正な値は指定なしとして扱う。 */
function readQuery(): Query {
  const params = new URLSearchParams(location.search);
  const date = params.get("date");
  const days = Number(params.get("days"));
  return {
    date: date !== null && isIsoDate(date) ? date : null,
    days: Number.isInteger(days) && days >= 1 && days <= SETTINGS.maxDays ? days : SETTINGS.days,
  };
}

function writeQuery(q: Query): void {
  const params = new URLSearchParams();
  if (q.date !== null) params.set("date", q.date);
  if (q.days !== SETTINGS.days) params.set("days", String(q.days));
  const search = params.toString();
  history.replaceState(null, "", search === "" ? location.pathname : `?${search}`);
}

function setupControls(q: Query): void {
  for (let n = 1; n <= SETTINGS.maxDays; n++) {
    els.days.append(h("option", { value: n }, [`${n}日`]));
  }
  els.start.value = startOf(q);
  els.days.value = String(q.days);
}

function select(days: readonly DaySummary[], i: number): void {
  els.cards.querySelectorAll(".day").forEach((b, j) => {
    b.setAttribute("aria-pressed", String(i === j));
  });
  const d = days[i];
  if (d === undefined) return;
  els.detail.replaceChildren(...renderDetail(ctx, d));
  els.detail.hidden = false;
}

/** 前の結果を消す。取得に失敗したとき、古い結果が新しい条件の結果に見えないようにする。 */
function clearResults(): void {
  els.meta.textContent = "";
  els.cards.replaceChildren();
  els.week.replaceChildren();
  els.weekCard.hidden = true;
  els.detail.replaceChildren();
  els.detail.hidden = true;
}

let current: AbortController | null = null;

async function show(q: Query): Promise<void> {
  current?.abort();
  const controller = new AbortController();
  current = controller;
  els.status.textContent = "取得中…";
  els.warnings.replaceChildren();
  try {
    const start = startOf(q);
    const result = await loadForecast(area, SETTINGS, THRESHOLDS, start, q.days, controller.signal);
    if (controller.signal.aborted) return;
    const first = result.days[0];
    const last = result.days.at(-1);
    const range = first && last ? `${dayLabel(first.day)}〜${dayLabel(last.day)}` : "";
    els.meta.textContent = [
      range,
      q.date === null && start !== jstNow().date ? "16時を過ぎているので翌日から" : "",
      result.historical ? "過去予報（その日に出ていた予報）" : "",
    ]
      .filter((s) => s !== "")
      .join(" ／ ");
    els.warnings.replaceChildren(...result.warnings.map((w) => h("li", {}, [w])));
    const onSelect = (i: number) => select(result.days, i);
    els.cards.replaceChildren(...result.days.map((d, i) => renderDayCard(ctx, d, () => onSelect(i))));
    els.week.replaceChildren(...renderWeek(ctx, result.days, onSelect));
    els.weekCard.hidden = false;
    select(result.days, 0);
    els.status.textContent = "";
    document.title = `気温減率 ${area.name} ${result.start}〜`;
  } catch (e) {
    if (controller.signal.aborted) return;
    clearResults();
    els.status.textContent = "";
    els.warnings.replaceChildren(h("li", { class: "error" }, [e instanceof Error ? e.message : String(e)]));
  }
}

function renderFooter(): void {
  els.footer.replaceChildren(
    h("p", {}, [
      `到達高度 = 地上2m気温の空気塊を乾燥断熱（${DRY_ADIABATIC_C_PER_100M}℃/100m）で持ち上げ、周りより冷たくなる高さ（上乗せ +0℃）。雲底がそれより低ければ雲底。`,
      "減率の区分は DHV、到達高度の区分は nasa 日記と XC の目安による暫定値。テイクオフの可否は現地で判断すること。",
    ]),
    h("p", {}, [
      `データ: `,
      h("a", { href: "https://open-meteo.com/", rel: "noopener" }, ["Open-Meteo"]),
      `（CC BY 4.0、非商用利用）。詳細 ${SETTINGS.detailModel}、傾向 ${SETTINGS.trendModels.join("・")}。`,
    ]),
  );
}

const initial = readQuery();
els.title.textContent = `気温減率・サーマル到達高度 — ${area.name}`;
setupControls(initial);
renderFooter();
els.form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const start = els.start.value;
  if (!isIsoDate(start)) return;
  const q: Query = { date: start, days: Number(els.days.value) };
  writeQuery(q);
  void show(q);
});
writeQuery(initial);
void show(initial);
