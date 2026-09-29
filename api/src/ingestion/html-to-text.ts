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

/**
 * The HTML 4 Latin-1 entities, U+00A0 to U+00FF in order. BHD's transfer
 * receipts spell every accented label this way ("Tipo de transacci&oacute;n"),
 * and the parsers compare labels exactly.
 */
const LATIN1 = (
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr ' +
  'deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest ' +
  'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ' +
  'ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig ' +
  'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml ' +
  'eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'
).split(' ');

/** Named entities, matched by exact case: &Oacute; and &oacute; are different letters. */
const NAMED: Record<string, string> = {
  ...Object.fromEntries(LATIN1.map((name, i) => [name, String.fromCharCode(0xa0 + i)])),
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** The six entities decoded before accents were, still accepted in any case (&AMP;). */
const CASELESS = new Set(['nbsp', 'amp', 'lt', 'gt', 'quot', 'apos']);

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? codePoint(n) : whole;
    }
    const lower = code.toLowerCase();
    return NAMED[code] ?? (CASELESS.has(lower) ? NAMED[lower] : whole);
  });
}

/**
 * The character for a numeric entity. One no string can hold (beyond U+10FFFF,
 * or a lone surrogate) becomes U+FFFD: String.fromCodePoint would throw, and
 * one such entity in a mail must not fail the whole ingestion run.
 */
function codePoint(n: number): string {
  return n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) ? '�' : String.fromCodePoint(n);
}
