import { banreservasParser } from './banreservas.parser';

const INCOMING = `| ¡Transacción realizada! |
| Monto: |
| DOP 1,225.00 |
| #concept# |
| Transacción: |
| Transferencia ACH |
| Origen: |
| CARLOS MANUEL PEREZ SANTOS, CuentaAhorro DOP ** - 4500 |
| Destino: |
| JUAN ANTONIO RIVERA MARTE, CuentaAhorro DOP ** - 0010 |
| Fecha de transacción: |
| 18 de Septiembre 2026 - 11:52 AM |
| Impuestos: |
| DOP 2.45 |
| Número de transacción: |
| 100000000001 |`;

const OUTGOING = `| ¡Transacción realizada! |
| Monto: |
| DOP 800.00 |
| #concept# |
| Transacción: |
| Transferencia ACH |
| Origen: |
| JUAN ANTONIO RIVERA MARTE, CuentaAhorro DOP ** - 0010 |
| Destino: |
| ALGUIEN MAS, CuentaAhorro DOP ** - 9999 |
| Fecha de transacción: |
| 20 de Octubre 2026 - 09:05 AM |
| Impuestos: |
| DOP 1.50 |
| Número de transacción: |
| 100000000002 |`;

const OWN = ['2002', 'JUAN ANTONIO RIVERA MARTE'];

describe('banreservasParser', () => {
  it('books an incoming wire as income and strips the thousands separator', () => {
    const r = banreservasParser.parse({ subject: 'Recibo de la transacción', body: INCOMING, ownIdentifiers: OWN })!;
    expect(r).not.toBeNull();
    expect(r.direction).toBe('income');
    expect(r.amount).toBe(1225);
    expect(r.counterparty).toBe('CARLOS MANUEL PEREZ SANTOS');
    expect(r.externalRef).toBe('100000000001');
    expect(r.isWithdrawal).toBe(false);
  });

  it('parses the Spanish long date', () => {
    const r = banreservasParser.parse({ subject: 'x', body: INCOMING, ownIdentifiers: OWN })!;
    expect(r.occurredAt.getDate()).toBe(18);
    expect(r.occurredAt.getMonth()).toBe(8); // Septiembre
    expect(r.occurredAt.getFullYear()).toBe(2026);
    expect(r.occurredAt.getHours()).toBe(11);
  });

  it('books an outgoing wire as an expense', () => {
    const r = banreservasParser.parse({ subject: 'x', body: OUTGOING, ownIdentifiers: OWN })!;
    expect(r.direction).toBe('expense');
    expect(r.amount).toBe(800);
    expect(r.counterparty).toBe('ALGUIEN MAS');
    expect(r.occurredAt.getMonth()).toBe(9); // Octubre
  });

  it('returns null when neither party matches — never guesses direction', () => {
    expect(
      banreservasParser.parse({ subject: 'x', body: INCOMING, ownIdentifiers: ['9999'] }),
    ).toBeNull();
  });

  it('returns null when no own identifiers are configured', () => {
    expect(
      banreservasParser.parse({ subject: 'x', body: INCOMING, ownIdentifiers: [] }),
    ).toBeNull();
  });

  it('treats #concept# as a placeholder, not a description', () => {
    const r = banreservasParser.parse({ subject: 'x', body: INCOMING, ownIdentifiers: OWN })!;
    expect(r.counterparty).not.toContain('#concept#');
  });

  it('does not treat a longer account number as our own (digit-boundary match)', () => {
    const nearMiss = INCOMING.replace('** - 0010', '** - 32002');
    expect(
      banreservasParser.parse({ subject: 'x', body: nearMiss, ownIdentifiers: ['2002'] }),
    ).toBeNull();
  });

  it('still matches a name fragment by substring', () => {
    const r = banreservasParser.parse({
      subject: 'x',
      body: INCOMING,
      ownIdentifiers: ['JUAN ANTONIO RIVERA MARTE'],
    })!;
    expect(r).not.toBeNull();
    expect(r.direction).toBe('income');
  });
});
