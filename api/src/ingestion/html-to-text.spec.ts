import { htmlToText } from './html-to-text';
import { bhdParser } from './parsers/bhd.parser';

/** Builds a synthetic BHD-shaped alert. `tipo` varies Compra vs Retiro. */
function bhdFixture(tipo: string): string {
  return `<html>
<head><style>.titleA{font-family:Arial;color:#000}.foot{font-size:10px}</style></head>
<body>
<table><tr><td><img src='cid:img1'></td></tr></table>
<table class='alert_div'><tr><td>
<div class='titleA'>BHD Notificación de Transacciones</div>
<p class='justify'>Visa Débito Intl # 0000</p>
<div class='titleB'>Detalle de Criterios</div>
<p class='justify'>Te notificamos la transacción realizada con tu Tarjeta Visa Débito Intl # 0000<br/><br/>En caso de no reconocer esta transacción, por favor llama de inmediato.</p>
<div class='titleB'>Detalle de Transacciones</div>
<table class='table_trans'>
<thead><tr>
<td class="header_table" style="font-family: 'OpenSans', Arial;" align="center" bgcolor="#e7e7e7">
  Fecha
</td>
<td class="header_table" style="font-family: 'OpenSans', Arial;" align="center" bgcolor="#e7e7e7">
  Moneda
</td>
<td class="header_table" style="font-family: 'OpenSans', Arial;" align="center" bgcolor="#e7e7e7">
  Monto
</td>
<td class="header_table" style="font-family: 'OpenSans', Arial;" align="center" bgcolor="#e7e7e7">
  Comercio
</td>
<td class="header_table" style="font-family: 'OpenSans', Arial;" align="center" bgcolor="#e7e7e7">
  Estado
</td>
<td class="header_table" style="font-family: 'OpenSans', Arial;" align="center" bgcolor="#e7e7e7">
  Tipo
</td>
</tr></thead>
<tbody><tr>
<td style="font-family: Arial;" align="center">24/09/2026 09:53 pm</td>
<td style="font-family: Arial;" align="center">RD</td>
<td style="font-family: Arial;" align="center">$1,234.56</td>
<td style="font-family: Arial;" align="center">SOME MERCHANT INC</td>
<td style="font-family: Arial;" align="center">Aprobada</td>
<td style="font-family: Arial;" align="center">${tipo}</td>
</tr></tbody>
</table></br></br><div class='foot'>Ahora, tus Tarjetas … <br/>Recuerda … <br/></div></td></tr></table>
</body></html>`;
}

const FIXTURE = bhdFixture('Compra');

describe('htmlToText', () => {
  it('turns leaf table rows into pipe lines and everything else into plain lines', () => {
    const text = htmlToText(FIXTURE);

    expect(text).toContain('| Fecha | Moneda | Monto | Comercio | Estado | Tipo |');
    expect(text).toContain('| 24/09/2026 09:53 pm | RD | $1,234.56 | SOME MERCHANT INC | Aprobada | Compra |');
    expect(text.split('\n')).toContain('Visa Débito Intl # 0000');
    expect(text).not.toContain('<');
    expect(text).not.toContain('{');
    expect(text.split('\n').some((line) => line.trim() === '')).toBe(false);
  });

  it('feeds bhdParser an approved purchase end to end', () => {
    const r = bhdParser.parse({ subject: 'BHD Notificación de Transacciones', body: htmlToText(FIXTURE) })!;

    expect(r.amount).toBe(1234.56);
    expect(r.currency).toBe('DOP');
    expect(r.counterparty).toBe('SOME MERCHANT INC');
    expect(r.cardLast4).toBe('0000');
    expect(r.isWithdrawal).toBe(false);
    expect(r.occurredAt.getHours()).toBe(21); // 09:53 pm
    expect(r.occurredAt.getMinutes()).toBe(53);
  });

  it('recognises a withdrawal when Tipo is Retiro', () => {
    const html = bhdFixture('Retiro');
    const r = bhdParser.parse({ subject: 'BHD Notificación de Transacciones', body: htmlToText(html) })!;

    expect(r.isWithdrawal).toBe(true);
  });

  it('produces no pipe line for a row whose cells are all empty (the logo row)', () => {
    const html = "<table><tr><td><img src='cid:img1'></td></tr></table>";

    expect(htmlToText(html)).toBe('');
  });

  it('flattens inline tags inside a cell to plain text', () => {
    const html = '<table><tr><td><b>A</b> <span>B</span></td><td>C</td></tr></table>';

    expect(htmlToText(html)).toBe('| A B | C |');
  });

  it('decodes named, decimal and hex entities, and leaves unknown ones alone', () => {
    expect(htmlToText('<p>A &amp; B</p>')).toBe('A & B');
    expect(htmlToText('<p>A&nbsp;B</p>')).toBe('A B');
    expect(htmlToText('<p>&#243;</p>')).toBe('ó');
    expect(htmlToText('<p>&#xF3;</p>')).toBe('ó');
    expect(htmlToText('<p>&foo;</p>')).toBe('&foo;');
  });

  describe('numeric entities no string can hold', () => {
    it('keeps the highest code point', () => {
      expect(htmlToText('<p>&#x10FFFF;</p>')).toBe('\u{10FFFF}');
    });
    it('turns one beyond it, a huge one, or a lone surrogate into U+FFFD instead of throwing', () => {
      expect(htmlToText('<p>a&#x110000;b</p>')).toBe('a�b');
      expect(htmlToText('<p>&#99999999;</p>')).toBe('�');
      expect(htmlToText('<p>&#xD800;</p>')).toBe('�');
    });
  });
});
