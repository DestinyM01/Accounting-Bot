import { santaCruzParser } from './santacruz.parser';
import { htmlToText } from '../html-to-text';
import { santoDomingoInstant } from '../../shared/santo-domingo';

// A received transfer as the text part lays it out: a tab after each bullet,
// a trailing space on each line, and a 12-hour time with no AM or PM (this one
// was sent at 3:51 PM). Names and numbers are made up.
const TRANSFER = [
  '\t',
  'TRANSFERENCIA RECIBIDA',
  ' \t',
  'Estimado (a): JUAN ANTONIO RIVERA ',
  '',
  'Te notificamos que has recibido la siguiente transferencia: ',
  '',
  '*\tMonto: DOP 500.00 ',
  '*\tTerminal de cuenta: 2001 ',
  '*\tTipo de cuenta: Cuenta de Ahorro ',
  '*\tFecha y hora: 2/10/2026 03:51:40 ',
  '*\tBanco remitente: BANCO POPULAR DOMINICANO, C. POR A. ',
  '*\tRemitente: SR JUAN RIVERA ',
  '',
  'En caso de no reconocer esta transacción, por favor llámanos.',
].join('\n');

/** The same receipt from the HTML part, for a mail that comes without a text part. */
const TRANSFER_HTML = `<div><span><b>TRANSFERENCIA RECIBIDA</b></span></div>
<p>Estimado (a): <b> JUAN ANTONIO RIVERA </b><br/>Te notificamos que has recibido la siguiente transferencia:</p>
<ul>
 <li>Monto: <b>DOP  500.00  </b> </li>
 <li>Terminal de cuenta: <b> 2001 </b> </li>
 <li>Tipo de cuenta: <b> Cuenta de Ahorro </b> </li>
 <li>Fecha y hora: <b> 2/10/2026  03:51:40</b> </li>
 <li>Banco remitente: <b> BANCO POPULAR DOMINICANO, C. POR A. </b> </li>
 <li>Remitente: <b> SR JUAN RIVERA </b> </li>
</ul>`;

/** When Gmail received the receipt: 3:52 PM on 2 October 2026, Santo Domingo time. */
const ARRIVED_AFTERNOON = santoDomingoInstant(2026, 9, 2, 15, 52, 56);

const CONSUMO = `NOTIFICACIÓN DE consumo

Te notificamos que desde tu tarjeta de Crédito Gold terminada en 8002
fue realizada la siguiente transacción:

Monto: RD$ 520.00
Lugar de transacción: UBER*EATS SANTO DOMINGODO
Fecha y hora: 21/9/2026 12:32:21
Estado: Aprobada`;

describe('santaCruzParser', () => {
  it('parses an approved purchase with unpadded date', () => {
    const r = santaCruzParser.parse({ subject: 'Notificación, Banco Santa Cruz', body: CONSUMO })!;
    expect(r.amount).toBe(520);
    expect(r.counterparty).toBe('UBER*EATS SANTO DOMINGODO');
    expect(r.cardLast4).toBe('8002');
    expect(r.occurredAt.getDate()).toBe(21);
    expect(r.occurredAt.getMonth()).toBe(8);
    expect(r.occurredAt.getHours()).toBe(12);
  });

  it('returns null when not approved', () => {
    expect(
      santaCruzParser.parse({ subject: 'x', body: CONSUMO.replace('Aprobada', 'Declinada') }),
    ).toBeNull();
  });

  describe('a received transfer (TRANSFERENCIA RECIBIDA)', () => {
    it('is an unresolved received leg, never income on its own', () => {
      const r = santaCruzParser.parse({ subject: 'Banco Santa Cruz', body: TRANSFER, arrivedAt: ARRIVED_AFTERNOON })!;

      expect(r).not.toBeNull();
      expect(r.bank).toBe('santacruz');
      expect(r.direction).toBe('income');
      expect(r.amount).toBe(500);
      expect(r.currency).toBe('DOP');
      expect(r.transferKind).toBe('unresolved');
      expect(r.isReceivedTransfer).toBe(true);
      expect(r.counterparty).toBe('SR JUAN RIVERA'); // the Remitente line, not "Banco remitente"
      expect(r.cardLast4).toBeUndefined();
    });

    it('reads its 12-hour time as PM when the mail arrived in the afternoon', () => {
      const r = santaCruzParser.parse({ subject: 'Banco Santa Cruz', body: TRANSFER, arrivedAt: ARRIVED_AFTERNOON })!;

      expect(r.occurredAt.getDate()).toBe(2);
      expect(r.occurredAt.getMonth()).toBe(9);
      expect(r.occurredAt.getHours()).toBe(15);
      expect(r.occurredAt.getMinutes()).toBe(51);
    });

    it('keeps AM when the mail arrived in the morning', () => {
      const arrivedAt = santoDomingoInstant(2026, 9, 2, 3, 52, 56);
      expect(santaCruzParser.parse({ subject: 'Banco Santa Cruz', body: TRANSFER, arrivedAt })!.occurredAt.getHours()).toBe(3);
    });

    it('reads the time as written when the arrival time is unknown', () => {
      expect(santaCruzParser.parse({ subject: 'Banco Santa Cruz', body: TRANSFER })!.occurredAt.getHours()).toBe(3);
    });

    it('reads the HTML-only version the same way', () => {
      const r = santaCruzParser.parse({ subject: 'Banco Santa Cruz', body: htmlToText(TRANSFER_HTML), arrivedAt: ARRIVED_AFTERNOON })!;

      expect(r).not.toBeNull();
      expect(r.amount).toBe(500);
      expect(r.counterparty).toBe('SR JUAN RIVERA');
      expect(r.occurredAt.getHours()).toBe(15);
    });

    it('leaves card purchases to the card path', () => {
      const r = santaCruzParser.parse({ subject: 'Notificación, Banco Santa Cruz', body: CONSUMO, arrivedAt: ARRIVED_AFTERNOON })!;

      expect(r.direction).toBe('expense');
      expect(r.transferKind).toBeUndefined();
      expect(r.occurredAt.getHours()).toBe(12); // card alerts are read as before
    });
  });
});
