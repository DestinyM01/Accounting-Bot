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
});
