/** 小さな DOM / SVG 生成ヘルパー。 */

const SVG_NS = "http://www.w3.org/2000/svg";

type Attrs = Readonly<Record<string, string | number>>;
type Child = Node | string;

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  text?: string,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    e.setAttribute(k, String(v));
  }
  if (text !== undefined) {
    e.textContent = text;
  }
  return e;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    e.setAttribute(k, String(v));
  }
  e.append(...children);
  return e;
}
