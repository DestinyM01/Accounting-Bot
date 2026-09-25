import { ItemRow, SpendRow, rollUpByCategory } from './category-rollup';

const withdrawal = (id: string, amount: number, category = 'cash'): SpendRow => ({ id, amount: -amount, category, isWithdrawal: true });
const expense = (id: string, amount: number, category?: string): SpendRow => ({ id, amount: -amount, category });
const item = (withdrawalId: string, category: string, amount: number): ItemRow => ({ withdrawalId, category, amount });

describe('rollUpByCategory', () => {
  it('splits a withdrawal into its items and leaves the rest in cash (the worked example)', () => {
    expect(rollUpByCategory([withdrawal('w1', 5000)], [item('w1', 'food', 3000), item('w1', 'transport', 1500)])).toEqual([
      { category: 'food', total: 3000 },
      { category: 'transport', total: 1500 },
      { category: 'cash', total: 500 },
    ]);
  });

  it('adds items to the same category as card spending', () => {
    expect(rollUpByCategory([expense('t1', 200, 'food'), withdrawal('w1', 1000)], [item('w1', 'food', 300)])).toEqual([
      { category: 'cash', total: 700 },
      { category: 'food', total: 500 },
    ]);
  });

  it('counts a withdrawal with no items in full under its own category', () => {
    expect(rollUpByCategory([withdrawal('w1', 800)], [])).toEqual([{ category: 'cash', total: 800 }]);
  });

  it('leaves no cash row for a fully itemized withdrawal', () => {
    expect(rollUpByCategory([withdrawal('w1', 800)], [item('w1', 'food', 800)])).toEqual([{ category: 'food', total: 800 }]);
  });

  it("keeps an older withdrawal's remainder in its own category", () => {
    expect(rollUpByCategory([withdrawal('w1', 1000, 'other')], [item('w1', 'health', 400)])).toEqual([
      { category: 'other', total: 600 },
      { category: 'health', total: 400 },
    ]);
  });

  it('ignores items whose withdrawal is not among the rows', () => {
    expect(rollUpByCategory([expense('t1', 100, 'food')], [item('gone', 'food', 999)])).toEqual([{ category: 'food', total: 100 }]);
  });

  it('never itemizes a row that is not a withdrawal', () => {
    expect(rollUpByCategory([expense('t1', 100, 'food')], [item('t1', 'health', 60)])).toEqual([{ category: 'food', total: 100 }]);
  });

  it('adds up to the total spending', () => {
    const rows = [expense('t1', 120.55, 'food'), withdrawal('w1', 3000), expense('t2', 99.45), withdrawal('w2', 500, 'other')];
    const items = [item('w1', 'food', 1000.1), item('w1', 'transport', 250.25), item('w2', 'health', 500)];
    const sum = rollUpByCategory(rows, items).reduce((s, c) => s + c.total, 0);
    expect(Math.round(sum * 100) / 100).toBe(3720);
  });

  it('ignores items of a withdrawal row that is not spending', () => {
    expect(
      rollUpByCategory([{ id: 'w1', amount: 500, isWithdrawal: true }, expense('t1', 20, 'food')], [item('w1', 'health', 200)]),
    ).toEqual([{ category: 'food', total: 20 }]);
  });

  it('ignores rows that are not spending', () => {
    expect(rollUpByCategory([{ id: 't1', amount: 500, category: 'salary' }, expense('t2', 20, 'food')], [])).toEqual([
      { category: 'food', total: 20 },
    ]);
  });

  it('files a row without a category under other, rounds to cents, and sorts by total then name', () => {
    expect(rollUpByCategory([expense('t1', 33.333), expense('t2', 5, 'b'), expense('t3', 5, 'a')], [])).toEqual([
      { category: 'other', total: 33.33 },
      { category: 'a', total: 5 },
      { category: 'b', total: 5 },
    ]);
  });
});
