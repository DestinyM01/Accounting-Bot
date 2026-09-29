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

/**
 * A synthetic BHD transfer receipt, shaped like the real ones: HTML only, the
 * detail rows in a table nested inside the outer one, and every accented label
 * written as a named entity (`transacci&oacute;n`). Names and numbers are made up.
 */
function bhdTransferFixture(f: { destino: string; monto: string; beneficiario: string; fecha: string; tipo: string }): string {
  const row = (label: string, value: string) =>
    `<tr><td style="text-align:right;"><p>${label}</p></td><td style="font-size:14px;"><p><strong>${value}</strong></p></td></tr>`;
  return `<table align="center" width="650"><tbody>
<tr id="idImagenTopMail"><td height="90"><img alt="" src="https://example.com/imagencorreo.png" /></td></tr>
<tr><td><p>Estimado(a):&nbsp;<strong>JUAN ANTONIO RIVERA</strong></p></td></tr>
<tr><td><p>A continuaci&oacute;n la informaci&oacute;n relacionada a tu transacci&oacute;n:</p></td></tr>
<tr><td><table><tbody>
${row('Producto origen:', 'DO94BCBH000000000XXXXXXX2002')}
${row('Producto destino:', f.destino)}
${row('Descripci&oacute;n:', '')}
${row('Monto:', f.monto)}
${row('Beneficiario:', f.beneficiario)}
${row('N&uacute;mero de confirmaci&oacute;n:', 'M10-1111-2222-3333-4')}
${row('Fecha y hora de la transacci&oacute;n:', f.fecha)}
${row('Tipo de transacci&oacute;n:', f.tipo)}
</tbody></table></td></tr>
<tr><td><p><strong>Nota:</strong>&nbsp;Este correo electr&oacute;nico es generado de manera autom&aacute;tica.</p></td></tr>
<tr><td><p><strong>Banco BHD</strong></p></td></tr>
</tbody></table>`;
}

const OWN_CASH = ['2001', '2002', '2003'];

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
    expect(r.transferKind).toBeUndefined(); // a card purchase, not a transfer
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

  it('decodes the accented Latin-1 named entities, case by case', () => {
    expect(htmlToText('<p>transacci&oacute;n</p>')).toBe('transacción');
    expect(htmlToText('<p>N&uacute;mero autom&aacute;tica</p>')).toBe('Número automática');
    expect(htmlToText('<p>&Oacute; &oacute; &Ntilde; &ntilde;</p>')).toBe('Ó ó Ñ ñ');
    expect(htmlToText('<p>&iquest;&eacute;&iacute;&uuml;?</p>')).toBe('¿éíü?');
    expect(htmlToText('<p>A &AMP; B</p>')).toBe('A & B');
    expect(htmlToText('<p>&iexcl;&frac12;&yuml;</p>')).toBe('¡½ÿ'); // both ends of the table line up
  });

  describe('BHD transfer receipts end to end', () => {
    it('reads a transfer to a third party as an external expense', () => {
      const html = bhdTransferFixture({
        destino: 'XXXXXX4400',
        monto: 'RD$ 20,000.00',
        beneficiario: 'MARIA ALTAGRACIA GOMEZ REYES',
        fecha: '28/09/2026 - 9:21 AM',
        tipo: 'Transacciones entre productos BHD y a otros Bancos',
      });
      const r = bhdParser.parse({
        subject: 'Transacciones entre productos BHD y a otros Bancos',
        body: htmlToText(html),
        ownCashAccounts: OWN_CASH,
      })!;

      expect(r).not.toBeNull();
      expect(r.direction).toBe('expense');
      expect(r.amount).toBe(20000);
      expect(r.currency).toBe('DOP');
      expect(r.counterparty).toBe('MARIA ALTAGRACIA GOMEZ REYES');
      expect(r.externalRef).toBe('M10-1111-2222-3333-4');
      expect(r.transferKind).toBe('external');
      expect(r.occurredAt.getHours()).toBe(9);
      expect(r.occurredAt.getMinutes()).toBe(21);
    });

    it('reads "entre mis productos" to a loan as an expense: only a cash account is internal', () => {
      const html = bhdTransferFixture({
        destino: 'XXX3050',
        monto: 'RD$ 1,942.10',
        beneficiario: 'JUAN RIVERA',
        fecha: '28/09/2026 - 9:22 AM',
        tipo: 'Transacciones entre mis productos',
      });
      const r = bhdParser.parse({ subject: 'Transacciones entre mis productos', body: htmlToText(html), ownCashAccounts: OWN_CASH })!;

      expect(r).not.toBeNull();
      expect(r.direction).toBe('expense');
      expect(r.amount).toBe(1942.1);
      expect(r.transferKind).toBe('external');
    });

    it('reads a transfer to an own cash account as internal', () => {
      const html = bhdTransferFixture({
        destino: 'XXXXXXXXXX2003',
        monto: 'RD$ 1,000.00',
        beneficiario: 'JUAN ANTONIO RIVERA MARTE',
        fecha: '28/09/2026 - 11:06 PM',
        tipo: 'Transacciones entre productos BHD y a otros Bancos',
      });
      const r = bhdParser.parse({
        subject: 'Transacciones entre productos BHD y a otros Bancos',
        body: htmlToText(html),
        ownCashAccounts: OWN_CASH,
      })!;

      expect(r).not.toBeNull();
      expect(r.transferKind).toBe('internal');
      expect(r.occurredAt.getHours()).toBe(23);
    });
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
