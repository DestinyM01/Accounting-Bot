/**
 * Plain text for a bank alert that arrives as HTML only. Mailparser leaves
 * `text` undefined when there is no text/plain part (as with BHD's alerts),
 * and its own HTML conversion runs table cells together, so the parsers
 * would find nothing to read.
 *
 * Each leaf table row (one with no nested table) becomes "| a | b | c |",
 * the pipe-row shape the parsers read. Everything else becomes plain lines.
 */
export function htmlToText(html: string): string {
  let s = html.replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');

  // Leaf rows first: a row whose content holds no other row and no table.
  s = s.replace(/<tr\b[^>]*>((?:(?!<\/?tr\b|<table\b)[\s\S])*?)<\/tr>/gi, (_row, inner: string) => {
    const cells = [...inner.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => inline(m[1]));
    return cells.some(Boolean) ? `\n| ${cells.join(' | ')} |\n` : '\n';
  });

  // Block boundaries become line breaks; any other tag disappears.
  s = s.replace(/<br\s*\/?>|<\/(?:p|div|table|thead|tbody|tr|li|h[1-6])>/gi, '\n').replace(/<[^>]+>/g, ' ');

  return decodeEntities(s)
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** A cell's text on one line: tags dropped, entities decoded, whitespace collapsed. */
function inline(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return NAMED[code.toLowerCase()] ?? whole;
  });
}
