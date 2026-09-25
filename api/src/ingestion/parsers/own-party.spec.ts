import { matchesOwn } from './own-party';

describe('matchesOwn', () => {
  const own = ['2001', '2002', '2003', 'juan antonio rivera'];

  it('matches an account number on a digit boundary', () => {
    expect(matchesOwn('XXXXXXXXXX2003', own)).toBe(true);
  });

  // A plain substring test would report 32002 as our own account and silently
  // flip a transfer from expense to internal, erasing it from the ledger.
  it('does not match a longer account that merely ends with ours', () => {
    expect(matchesOwn('DO94BCBH0000000032002', own)).toBe(false);
  });

  it('does not match a near-miss differing only in the last digit', () => {
    expect(matchesOwn('XXXXXX2004', own)).toBe(false);
    expect(matchesOwn('XXXXXX2007', own)).toBe(false);
  });

  it('matches a name fragment case-insensitively', () => {
    expect(matchesOwn('JUAN ANTONIO RIVERA MARTE', own)).toBe(true);
  });

  it('returns false for null or empty input', () => {
    expect(matchesOwn(null, own)).toBe(false);
    expect(matchesOwn('', own)).toBe(false);
  });

  it('returns false when no identifiers are configured', () => {
    expect(matchesOwn('XXXXXX2003', [])).toBe(false);
  });

  // A fragment matching inside a longer name would turn a stranger's transfer
  // into one of the user's own, and take it out of spending.
  describe('name fragments match whole words only', () => {
    it('matches a whole word, or a run of words', () => {
      expect(matchesOwn('JUAN RIVERA MARTE', ['rivera'])).toBe(true);
      expect(matchesOwn('Transferencia de JUAN ANTONIO RIVERA', ['juan antonio'])).toBe(true);
      expect(matchesOwn('RIVERA, JUAN', ['rivera'])).toBe(true);
    });

    it('does not match inside a longer word', () => {
      expect(matchesOwn('RIVERAS', ['rivera'])).toBe(false);
      expect(matchesOwn('MARIANA GOMEZ', ['ana'])).toBe(false);
      expect(matchesOwn('SANTANA', ['ana'])).toBe(false);
    });

    it('treats accented letters as letters', () => {
      expect(matchesOwn('PEDRO NÚÑEZ', ['núñez'])).toBe(true);
      expect(matchesOwn('PEDRO NÚÑEZA', ['núñez'])).toBe(false);
    });

    it('tolerates extra spaces between the words of a fragment', () => {
      expect(matchesOwn('JUAN   ANTONIO RIVERA', ['juan antonio'])).toBe(true);
    });

    it('takes regex characters in a fragment literally', () => {
      expect(matchesOwn('A.B SERVICES', ['a.b'])).toBe(true);
      expect(matchesOwn('AXB SERVICES', ['a.b'])).toBe(false);
    });
  });
});
