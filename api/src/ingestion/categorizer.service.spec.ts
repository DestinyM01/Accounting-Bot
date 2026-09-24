const complete = jest.fn();
jest.mock('@mistralai/mistralai', () => ({
  Mistral: jest.fn().mockImplementation(() => ({ chat: { complete } })),
}));

import { CategorizerService } from './categorizer.service';

describe('CategorizerService rules', () => {
  const svc = new CategorizerService();
  const allowed = ['food', 'transport', 'housing', 'health', 'entertainment', 'salary', 'savings', 'other'];

  it.each([
    ['UBER*EATS SANTO DOMINGODO', 'food'],
    ['PedidosYa*Expreso Bonny', 'food'],
    ['UBER*RIDES', 'transport'],
    ['Cajero Automatico', 'other'],
    ['FARMACIA CAROL', 'health'],
    ['EDENORTE DOMINICANA', 'housing'],
  ])('classifies %s as %s without calling Mistral', async (merchant, expected) => {
    const r = await svc.categorize(merchant, allowed);
    expect(r.category).toBe(expected);
    expect(r.needsReview).toBe(false);
  });

  it('puts Uber Eats in food, not transport (rule order matters)', async () => {
    const r = await svc.categorize('UBER*EATS SANTO DOMINGODO', allowed);
    expect(r.category).toBe('food');
  });

  it('falls back to other+needsReview for an unknown merchant with no API key', async () => {
    const prev = process.env.MISTRAL_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    const r = await svc.categorize('ZZZ UNKNOWN MERCHANT', allowed);
    expect(r.category).toBe('other');
    expect(r.needsReview).toBe(true);
    if (prev) process.env.MISTRAL_API_KEY = prev;
  });
});

describe('CategorizerService — word boundaries and canonical names', () => {
  const allowed = ['food', 'transport', 'housing', 'health', 'entertainment', 'other', 'Gym'];
  let prevKey: string | undefined;
  beforeEach(() => { prevKey = process.env.MISTRAL_API_KEY; process.env.MISTRAL_API_KEY = 'test-key'; complete.mockReset(); });
  afterEach(() => { if (prevKey === undefined) delete process.env.MISTRAL_API_KEY; else process.env.MISTRAL_API_KEY = prevKey; });

  const reply = (name: string) => complete.mockResolvedValue({ choices: [{ message: { content: name } }] });

  it('returns the canonical custom-category name when Mistral answers in another case', async () => {
    reply('gym');
    const r = await new CategorizerService().categorize('BODY SHOP FITNESS', allowed);
    expect(r).toEqual({ category: 'Gym', needsReview: true });
  });

  it('does not match a rule keyword inside a longer word', async () => {
    reply('health');
    const r = await new CategorizerService().categorize('MEDICINE SHOPPE', allowed);
    expect(complete).toHaveBeenCalled();
    expect(r.category).toBe('health');
  });

  it('still matches a rule keyword as a whole word, without Mistral', async () => {
    const r = await new CategorizerService().categorize('CINE CARIBBEAN', allowed);
    expect(complete).not.toHaveBeenCalled();
    expect(r).toEqual({ category: 'entertainment', needsReview: false });
  });

  it.each([
    ['GASOLINERA SHELL', 'transport'],
    ['CLINICA ABREU', 'health'],
    ['CINEMARK BLUE MALL', 'entertainment'],
    ['SUPERMERCADOS NACIONAL', 'food'],
  ])('keeps matching %s as %s by rule', async (merchant, expected) => {
    const r = await new CategorizerService().categorize(merchant, allowed);
    expect(complete).not.toHaveBeenCalled();
    expect(r).toEqual({ category: expected, needsReview: false });
  });

  it.each([
    ['BANCO NACIONAL'],
    ['AGUACATE MARKET'],
    ['VIVANDA STORE'],
  ])('no longer misfiles %s by rule', async (merchant) => {
    reply('other');
    const r = await new CategorizerService().categorize(merchant, allowed);
    expect(complete).toHaveBeenCalled();
    expect(r.needsReview).toBe(true);
  });
});
