/**
 * Chart colours and styles from the design tokens (web/src/tokens.css), read when
 * a chart is built so charts follow the theme. The tokens are oklch() strings;
 * Chart.js's colour helper (used by plugins, e.g. the sankey's flow bands, to add
 * transparency) can't parse those, so colours are converted to rgb() here, by
 * formula, so Chart.js and its plugins can parse and derive from them. Chart.js's
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

const OKLCH = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/i;

/**
 * An oklch() colour as rgb()/rgba(), by the standard OKLab → linear sRGB → sRGB
 * formula. Chart.js's colour helper (used by plugins to add transparency) can't
 * parse oklch(); this needs no canvas, so anti-fingerprinting canvas noise can't
 * scramble the charts. Any other colour string is returned unchanged.
 */
export function toRgb(color: string): string {
  const m = OKLCH.exec(color.trim());
  if (!m) return color;
  const L = m[2] ? Number(m[1]) / 100 : Number(m[1]);
  const C = Number(m[3]);
  const h = (Number(m[4]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963378 * a + 0.2158038 * b) ** 3;
  const mm = (L - 0.1055613 * a - 0.0638542 * b) ** 3;
  const s = (L - 0.0894842 * a - 1.2914855 * b) ** 3;
  const linear = [
    4.0767417 * l - 3.3077116 * mm + 0.2309699 * s,
    -1.268438 * l + 2.609757 * mm - 0.3413194 * s,
    -0.0041961 * l - 0.7034186 * mm + 1.7076147 * s,
  ];
  const [r, g, bl] = linear.map((c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  });
  if (m[5] === undefined) return `rgb(${r}, ${g}, ${bl})`;
  const alpha = m[6] ? Number(m[5]) / 100 : Number(m[5]);
  return `rgba(${r}, ${g}, ${bl}, ${alpha})`;
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

/**
 * `color` made see-through: rgb(r, g, b) → rgba(r, g, b, a); oklch(L C H) → oklch(L C H / a);
 * #rrggbb → rgba(r, g, b, a); anything else unchanged. `alpha` replaces any alpha `color`
 * already carries (e.g. an rgba() input's own alpha is discarded) rather than multiplying it.
 */
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
  return {
    backgroundColor: t.card,
    borderColor: t.grid,
    borderWidth: 1,
    titleColor: t.text,
    bodyColor: t.text,
    // Chart.js draws each tooltip colour key over white by default; match the tooltip card.
    multiKeyBackground: t.card,
  };
}

/** One axis's grid and tick labels. */
export function axisStyle(t: ChartTheme) {
  return { grid: { color: t.grid }, ticks: { color: t.muted, font: { size: 11 } } };
}

/** Hovering anywhere over a column shows its tooltip, with every series in it. */
export const HOVER_COLUMN = { mode: 'index', intersect: false } as const;

const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** A tooltip label "Income: $52,000" (or just "$52,000" for an unlabelled series). */
export function moneyLabel(ctx: { dataset: { label?: string }; parsed: { y: number | null } }): string {
  const value = MONEY.format(ctx.parsed.y ?? 0);
  return ctx.dataset.label ? `${ctx.dataset.label}: ${value}` : value;
}
