/**
 * Chart colours and styles from the design tokens (web/src/tokens.css), read when
 * a chart is built so charts follow the theme. The tokens are oklch() strings;
 * canvas understands those but Chart.js's colour helper (used by plugins, e.g. the
 * sankey's flow bands, to add transparency) doesn't, so colours are resolved to
 * rgb() here so Chart.js and its plugins can parse and derive from them. Chart.js's
 * own hover-colour derivation has the same limitation, so datasets still set their
 * hover colours explicitly from these values.
 */
export interface ChartTheme {
  text: string;
  muted: string;
  grid: string;
  card: string;
  accent: string;
  income: string;
  expense: string;
}

/** Any CSS colour as rgb()/rgba(): canvas understands oklch(), but Chart.js's colour helper (used by plugins to add transparency) doesn't. */
function toRgb(color: string): string {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!ctx || !color) return color;
  ctx.canvas.width = ctx.canvas.height = 1;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  if (a === 0 && r === 0 && g === 0 && b === 0) return color;
  return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${+(a / 255).toFixed(3)})`;
}

export function chartTheme(): ChartTheme {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  return {
    text: toRgb(token('--text')),
    muted: toRgb(token('--text-muted')),
    grid: toRgb(token('--border')),
    card: toRgb(token('--bg-card')),
    accent: toRgb(token('--accent')),
    income: toRgb(token('--income')),
    expense: toRgb(token('--expense')),
  };
}

/** `color` made see-through: rgb(r, g, b) → rgba(r, g, b, a); oklch(L C H) → oklch(L C H / a); #rrggbb → rgba(r, g, b, a); anything else unchanged. */
export function withAlpha(color: string, alpha: number): string {
  const c = color.trim();
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c);
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;
  const oklch = /^oklch\(([^/)]*)\)$/i.exec(c);
  if (oklch) return `oklch(${oklch[1].trim()} / ${alpha})`;
  const hex = /^#([0-9a-f]{6})$/i.exec(c);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  return color;
}

/** The tooltip every chart uses. */
export function tooltipStyle(t: ChartTheme) {
  return { backgroundColor: t.card, borderColor: t.grid, borderWidth: 1, titleColor: t.muted, bodyColor: t.text };
}

/** One axis's grid and tick labels. */
export function axisStyle(t: ChartTheme) {
  return { grid: { color: t.grid }, ticks: { color: t.muted, font: { size: 11 } } };
}

/** Hovering anywhere over a column shows its tooltip, with every series in it. */
export const HOVER_COLUMN = { mode: 'index', intersect: false } as const;
