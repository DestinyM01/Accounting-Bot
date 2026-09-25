/**
 * Chart colours and styles from the design tokens (web/src/tokens.css), read when
 * a chart is built so charts follow the theme. Chart.js derives hover colours
 * with a colour library that can't parse oklch(), so datasets set their hover
 * colours explicitly from these values.
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

export function chartTheme(): ChartTheme {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  return {
    text: token('--text'),
    muted: token('--text-muted'),
    grid: token('--border'),
    card: token('--bg-card'),
    accent: token('--accent'),
    income: token('--income'),
    expense: token('--expense'),
  };
}

/** `color` made see-through: oklch(L C H) → oklch(L C H / a); #rrggbb → rgba(r, g, b, a); anything else unchanged. */
export function withAlpha(color: string, alpha: number): string {
  const c = color.trim();
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
