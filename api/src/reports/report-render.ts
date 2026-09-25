import { santoDomingoWallClock } from '../shared/santo-domingo';
import { BudgetLine, Health, MonthlyReportData, WeeklyReportData } from './report-types';

export interface RenderOptions {
  webUrl: string;
  /** Prefixes the subject with "[Test] ". */
  test?: boolean;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface Row {
  label: string;
  value: string;
}

interface Section {
  title: string;
  paragraphs?: string[];
  rows?: Row[];
  link?: { href: string; label: string };
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MINUS = '−';
const EN_DASH = '–';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const PESOS = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Whole pesos, unsigned: "RD$ 12,345". */
export function money(n: number): string {
  return `RD$ ${PESOS.format(Math.round(Math.abs(n)))}`;
}

function signedMoney(n: number): string {
  return `${n < 0 ? MINUS : '+'}${money(n)}`;
}

function local(d: Date): Date {
  return santoDomingoWallClock(d);
}

function day(d: Date): string {
  const l = local(d);
  return `${MONTHS[l.getUTCMonth()].slice(0, 3)} ${l.getUTCDate()}`;
}

function weekRange(from: Date, to: Date): string {
  const a = local(from);
  const b = local(new Date(to.getTime() - 1));
  const monthA = MONTHS[a.getUTCMonth()].slice(0, 3);
  const monthB = MONTHS[b.getUTCMonth()].slice(0, 3);
  return monthA === monthB
    ? `${monthA} ${a.getUTCDate()}${EN_DASH}${b.getUTCDate()}`
    : `${monthA} ${a.getUTCDate()} ${EN_DASH} ${monthB} ${b.getUTCDate()}`;
}

function share(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '0%';
}

function change(current: number, previous: number): string | null {
  if (!(previous > 0)) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct > 0) return `+${pct}%`;
  if (pct < 0) return `${MINUS}${Math.abs(pct)}%`;
  return '0%';
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A budget's standing mid-month: over only past the limit; 80% up to and including it. */
export function budgetStatus(b: BudgetLine): string {
  if (b.spent > b.limit) return `over by ${money(b.spent - b.limit)}`;
  if (b.limit > 0 && b.spent >= 0.8 * b.limit) return '≥ 80%';
  return 'on track';
}

/** A budget's result for a finished month, in the whole pesos the email shows. */
export function budgetResult(b: BudgetLine): string {
  const over = Math.round(b.spent) - Math.round(b.limit);
  if (over > 0) return `over by ${money(over)}`;
  if (over === 0) return 'on budget';
  return `under by ${money(-over)}`;
}

function healthLines(h: Health): string[] {
  const lines = h.overdueRecurring.map((r) => `Recurring "${r.name}" was due ${day(r.dueAt)} and hasn't been booked.`);
  if (h.lastIngestedAt === null) {
    lines.push('No bank email has been ingested yet.');
  } else if (h.ingestionStale) {
    lines.push(`No bank email ingested since ${day(h.lastIngestedAt)} (${h.daysSinceIngest} days).`);
  } else if (lines.length === 0) {
    lines.push(`Recurring payments and bank emails are up to date. Last bank email ingested ${day(h.lastIngestedAt)}.`);
  } else {
    lines.push(`Last bank email ingested ${day(h.lastIngestedAt)}.`);
  }
  return lines;
}

export function renderWeekly(d: WeeklyReportData, opts: RenderOptions): RenderedEmail {
  const range = weekRange(d.from, d.to);
  const sections: Section[] = [
    {
      title: 'Last week',
      rows: [
        { label: 'Spent', value: money(d.week.spent) },
        { label: 'Income', value: money(d.week.income) },
        ...d.week.topCategories.map((c) => ({
          label: c.category,
          value: `${money(c.total)} (${share(c.total, d.week.spent)})`,
        })),
      ],
    },
  ];
  if (d.week.largest.length > 0) {
    sections.push({
      title: 'Largest expenses',
      rows: d.week.largest.map((e) => ({ label: `${e.name} · ${day(e.at)}`, value: money(e.amount) })),
    });
  }
  sections.push({
    title: `${d.month.label} so far`,
    rows: [
      { label: 'Spent', value: money(d.month.spent) },
      { label: 'Income', value: money(d.month.income) },
      { label: 'Net', value: signedMoney(d.month.net) },
      ...d.month.budgets.map((b) => ({
        label: `${b.category} budget`,
        value: `${money(b.spent)} of ${money(b.limit)} · ${budgetStatus(b)}`,
      })),
    ],
  });
  const waiting: string[] = [];
  if (d.waiting.unresolved > 0) {
    waiting.push(`${count(d.waiting.unresolved, 'transfer', 'transfers')} waiting for Internal/Expense`);
  }
  if (d.waiting.toReview > 0) {
    waiting.push(`${count(d.waiting.toReview, 'category', 'categories')} to review`);
  }
  if (waiting.length > 0) {
    sections.push({
      title: 'Waiting for you',
      paragraphs: waiting,
      link: { href: `${opts.webUrl}/transactions`, label: 'Open Transactions' },
    });
  }
  sections.push({ title: 'Health', paragraphs: healthLines(d.health) });

  const subject = `${opts.test ? '[Test] ' : ''}Weekly digest · ${range} · ${money(d.week.spent)} spent`;
  return build(subject, 'Weekly digest', `Week of ${range}`, sections, opts);
}

export function renderMonthly(d: MonthlyReportData, opts: RenderOptions): RenderedEmail {
  const label = `${MONTHS[d.month - 1]} ${d.year}`;
  const delta = change(d.expense, d.previousExpense);
  const sections: Section[] = [
    {
      title: 'The month',
      rows: [
        { label: 'Income', value: money(d.income) },
        { label: 'Expenses', value: `${money(d.expense)}${delta ? ` (${delta} vs the month before)` : ''}` },
        { label: 'Net', value: signedMoney(d.net) },
      ],
    },
    d.categories.length > 0
      ? {
          title: 'Spending by category',
          rows: d.categories.map((c) => ({ label: c.category, value: `${money(c.total)} (${share(c.total, d.expense)})` })),
        }
      : { title: 'Spending by category', paragraphs: ['No spending recorded.'] },
  ];
  if (d.budgets.length > 0) {
    sections.push({
      title: 'Budgets',
      rows: d.budgets.map((b) => ({
        label: b.category,
        value: `${money(b.spent)} of ${money(b.limit)} · ${budgetResult(b)}`,
      })),
    });
  }

  const subject = `${opts.test ? '[Test] ' : ''}${label} · ${money(d.expense)} spent · net ${signedMoney(d.net)}`;
  return build(subject, `${label} summary`, 'The month that just ended', sections, opts);
}

function build(subject: string, title: string, subtitle: string, sections: Section[], opts: RenderOptions): RenderedEmail {
  return { subject, html: toHtml(title, subtitle, sections, opts), text: toText(title, subtitle, sections, opts) };
}

function toHtml(title: string, subtitle: string, sections: Section[], opts: RenderOptions): string {
  const body = sections
    .map((s) => {
      const paragraphs = (s.paragraphs ?? [])
        .map((p) => `<p style="margin:4px 0;color:#374151">${escapeHtml(p)}</p>`)
        .join('');
      const rows = (s.rows ?? [])
        .map(
          (r) =>
            `<tr><td style="padding:4px 12px 4px 0;color:#374151">${escapeHtml(r.label)}</td>` +
            `<td style="padding:4px 0;text-align:right;color:#111827;white-space:nowrap">${escapeHtml(r.value)}</td></tr>`,
        )
        .join('');
      const table = rows
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">${rows}</table>`
        : '';
      const link = s.link
        ? `<p style="margin:8px 0 0"><a href="${escapeHtml(s.link.href)}" style="color:#2563eb">${escapeHtml(s.link.label)}</a></p>`
        : '';
      return `<h2 style="font-size:15px;margin:24px 0 8px;color:#111827">${escapeHtml(s.title)}</h2>${paragraphs}${table}${link}`;
    })
    .join('');

  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>` +
    `<body style="margin:0;padding:24px;background:#f3f4f6">` +
    `<div style="max-width:600px;margin:0 auto;background:#ffffff;padding:24px;border-radius:8px;font-family:${FONT}">` +
    `<h1 style="font-size:20px;margin:0 0 4px;color:#111827">${escapeHtml(title)}</h1>` +
    `<p style="margin:0;color:#6b7280;font-size:14px">${escapeHtml(subtitle)}</p>` +
    body +
    `<p style="margin:32px 0 0;font-size:13px"><a href="${escapeHtml(opts.webUrl)}" style="color:#2563eb">Open the dashboard</a></p>` +
    `</div></body></html>`
  );
}

function toText(title: string, subtitle: string, sections: Section[], opts: RenderOptions): string {
  const out = [title, subtitle, ''];
  for (const s of sections) {
    out.push(s.title.toUpperCase());
    for (const p of s.paragraphs ?? []) out.push(p);
    for (const r of s.rows ?? []) out.push(`  ${r.label}: ${r.value}`);
    if (s.link) out.push(`${s.link.label}: ${s.link.href}`);
    out.push('');
  }
  out.push(`Dashboard: ${opts.webUrl}`);
  return out.join('\n');
}
