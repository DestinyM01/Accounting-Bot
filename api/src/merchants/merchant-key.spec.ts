import { merchantKey } from './merchant-key';

describe('merchantKey', () => {
  it('drops reference codes so every charge from a merchant shares one key', () => {
    expect(merchantKey('PRIME VIDEO*2K3JD')).toBe('prime video');
    expect(merchantKey('prime video*9xq1')).toBe('prime video');
    expect(merchantKey('SOME STORE #1234')).toBe('some store');
  });

  it('keeps words, splitting on spaces, * and #', () => {
    expect(merchantKey('PedidosYa*Expreso  Bonny')).toBe('pedidosya expreso bonny');
  });

  it('gives an empty key for a name with nothing but codes', () => {
    expect(merchantKey('12345 #99')).toBe('');
    expect(merchantKey(undefined)).toBe('');
  });

  // Parser placeholders ("Transferencia", "Desconocido") name no merchant, and
  // neither do generic words left once reference codes are dropped — teaching
  // either would corrupt every other row that happens to share the word.
  it('gives an empty key for a parser placeholder or a generic word', () => {
    expect(merchantKey('Transferencia')).toBe('');
    expect(merchantKey('TRANSFERENCIA ENVIADA')).toBe('');
    expect(merchantKey('Desconocido')).toBe('');
    expect(merchantKey('PAGO 12345')).toBe('');
    expect(merchantKey('COMPRA #99')).toBe('');
    expect(merchantKey('PAYPAL *1234567')).toBe('');
  });

  it('keeps a specific merchant behind a generic prefix', () => {
    expect(merchantKey('PAYPAL *SPOTIFY')).toBe('paypal spotify');
  });

  it('splits on # without a space', () => {
    expect(merchantKey('STORE#1234')).toBe('store');
  });
});
