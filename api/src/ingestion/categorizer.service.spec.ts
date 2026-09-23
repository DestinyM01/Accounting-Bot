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
