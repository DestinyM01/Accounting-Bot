import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoryReferencesService } from './category-references.service';
import { CustomCategory } from '../shared/schemas/custom-category.schema';
import { Category } from '../shared/schemas/category.enum';

const ID = '64b000000000000000000001';
const OLD_ID = '64b000000000000000000002';

/** A chainable stand-in for a Mongoose query that resolves to `result`. */
function query(result: unknown) {
  const q: any = { sort: jest.fn(() => q), lean: jest.fn(() => Promise.resolve(result)) };
  return q;
}

const gym = (overrides: Record<string, unknown> = {}) => ({
  _id: ID, userId: 1, name: 'gym', emoji: '💪', color: '#3b82f6', active: true, pending: null, ...overrides,
});

/** Answer findOne by filter: the category itself when looked up by id, `others(filter)` otherwise. */
const findOneBy = (self: unknown, others: (filter: any) => unknown = () => null) =>
  (filter: any) => query(filter._id ? self : others(filter));

describe('CategoriesService', () => {
  let service: CategoriesService;
  let model: { find: jest.Mock; findOne: jest.Mock; findOneAndUpdate: jest.Mock; create: jest.Mock; updateOne: jest.Mock };
  let refs: { usage: jest.Mock; migrate: jest.Mock };

  beforeEach(async () => {
    process.env.BOSS_USER_ID = '1';
    model = {
      // list(): the active custom categories. 'Gym' keeps the case-sensitivity test meaningful.
      find: jest.fn(() => query([{ _id: 'c1', name: 'Gym', color: '#000', emoji: 'x' }])),
      findOne: jest.fn(() => query(null)),
      findOneAndUpdate: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ _id: 'new1' }),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    refs = { usage: jest.fn().mockResolvedValue(new Map()), migrate: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: getModelToken(CustomCategory.name), useValue: model },
        { provide: CategoryReferencesService, useValue: refs },
      ],
    }).compile();
    service = module.get(CategoriesService);
  });

  describe('list', () => {
    it('offers every built-in category, cash included, before the custom ones', async () => {
      const names = (await service.list()).map((c) => c.name);
      expect(names).toEqual([...Object.values(Category), 'Gym']);
    });
  });

  describe('assertValid', () => {
    it('passes for a built-in category', async () => {
      await expect(service.assertValid('food')).resolves.toBeUndefined();
    });

    it('passes for an active custom category', async () => {
      await expect(service.assertValid('Gym')).resolves.toBeUndefined();
    });

    it('rejects an unknown category', async () => {
      await expect(service.assertValid('nope')).rejects.toThrow(BadRequestException);
      await expect(service.assertValid('nope')).rejects.toThrow(/unknown category: nope/);
    });

    it('rejects the wrong case: names are stored verbatim', async () => {
      await expect(service.assertValid('gym')).rejects.toThrow(BadRequestException);
    });
  });

  describe('create', () => {
    it('normalizes the name and creates a new category', async () => {
      await expect(service.create({ name: '  Gym ', emoji: '💪', color: '#3b82f6' })).resolves.toEqual({ id: 'new1' });
      expect(model.create).toHaveBeenCalledWith({
        userId: 1, name: 'gym', emoji: '💪', color: '#3b82f6', active: true, pending: null,
      });
    });

    it('rejects a bad name, emoji or colour', async () => {
      await expect(service.create({ name: 'a b', emoji: '💪', color: '#3b82f6' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.create({ name: 'gym', emoji: '🦄', color: '#3b82f6' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.create({ name: 'gym', emoji: '💪', color: '#123456' })).rejects.toBeInstanceOf(BadRequestException);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('rejects a name you already have', async () => {
      model.findOne.mockReturnValueOnce(query(gym()));
      await expect(service.create({ name: 'gym', emoji: '💪', color: '#3b82f6' })).rejects.toThrow(
        /already have a category called gym/,
      );
    });

    it('rejects a name an unfinished move is still moving away from', async () => {
      model.findOne.mockReturnValueOnce(query(gym({ active: false, pending: { from: 'gym', to: 'health' } })));
      await expect(service.create({ name: 'gym', emoji: '💪', color: '#3b82f6' })).rejects.toThrow(/still being moved/);
      expect(model.findOne).toHaveBeenCalledWith({ userId: 1, $or: [{ name: 'gym', active: true }, { 'pending.from': 'gym' }] });
    });

    it('revives a deleted category instead of duplicating it', async () => {
      model.findOneAndUpdate.mockResolvedValueOnce({ _id: OLD_ID });
      await expect(service.create({ name: 'gym', emoji: '🎯', color: '#ef4444' })).resolves.toEqual({ id: OLD_ID });
      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { userId: 1, name: 'gym', active: false, pending: null },
        { $set: { active: true, emoji: '🎯', color: '#ef4444' } },
        { sort: { _id: -1 }, new: true },
      );
      expect(model.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('changes emoji and colour in place, validating only what was sent', async () => {
      model.findOne.mockReturnValueOnce(query(gym({ color: '#abcdef' }))); // a legacy colour, not sent
      await service.update(ID, { emoji: '🎯' });
      expect(model.updateOne).toHaveBeenCalledWith({ _id: ID, userId: 1 }, { $set: { emoji: '🎯' } });
      expect(refs.migrate).not.toHaveBeenCalled();
    });

    it('answers 404 for a built-in or unknown id', async () => {
      await expect(service.update('food', { emoji: '🎯' })).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.update(ID, { emoji: '🎯' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to edit a category mid-move', async () => {
      model.findOne.mockReturnValueOnce(query(gym({ pending: { from: 'gym', to: 'fitness' } })));
      await expect(service.update(ID, { emoji: '🎯' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects an invalid emoji, colour or name', async () => {
      model.findOne.mockImplementation(findOneBy(gym()));
      await expect(service.update(ID, { emoji: '🦄' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.update(ID, { color: '#123456' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.update(ID, { name: 'a b' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('renames through one guarded write, then moves every reference and clears pending', async () => {
      model.findOne.mockReturnValueOnce(query(gym()));
      model.findOneAndUpdate.mockResolvedValueOnce({ _id: ID });
      await service.update(ID, { name: ' Fitness ' });
      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: ID, userId: 1, name: 'gym', active: true, pending: null },
        { $set: { name: 'fitness', pending: { from: 'gym', to: 'fitness' } } },
      );
      expect(refs.migrate).toHaveBeenCalledWith('gym', 'fitness');
      expect(model.updateOne).toHaveBeenCalledWith(
        { _id: ID, 'pending.from': 'gym', 'pending.to': 'fitness' },
        { $set: { pending: null } },
      );
      expect(refs.migrate.mock.invocationCallOrder[0]).toBeLessThan(model.updateOne.mock.invocationCallOrder[0]);
    });

    it('refuses to rename onto a category that already exists', async () => {
      model.findOne.mockImplementation(findOneBy(gym(), (f) => (f.$or ? gym({ _id: OLD_ID, name: 'fitness' }) : null)));
      await expect(service.update(ID, { name: 'fitness' })).rejects.toThrow(/delete gym and move it there/);
      expect(refs.migrate).not.toHaveBeenCalled();
    });

    it('refuses to edit a deleted category', async () => {
      model.findOne.mockImplementation(findOneBy(gym({ active: false })));
      await expect(service.update(ID, { emoji: '🎯' })).rejects.toThrow(/was deleted/);
    });

    it('locks a category that an unfinished move is moving into', async () => {
      const travel = gym({ name: 'travel' });
      model.findOne.mockImplementation(
        findOneBy(travel, (f) => (f['pending.to'] === 'travel' ? gym({ _id: OLD_ID, active: false, pending: { from: 'gym', to: 'travel' } }) : null)),
      );
      await expect(service.update(ID, { emoji: '🎯' })).rejects.toThrow(/still being moved into travel/);
      await expect(service.remove(ID, 'health')).rejects.toThrow(/still being moved into travel/);
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
      expect(model.findOne).toHaveBeenCalledWith({ userId: 1, 'pending.to': 'travel' });
    });

    it('refuses to rename a legacy custom category that carries a built-in name', async () => {
      model.findOne.mockImplementation(findOneBy(gym({ name: 'food' })));
      await expect(service.update(ID, { name: 'groceries' })).rejects.toThrow(/built-in/);
    });
  });

  describe('remove', () => {
    it('requires a category to move to while it is in use', async () => {
      model.findOne.mockReturnValueOnce(query(gym()));
      refs.usage.mockResolvedValue(new Map([['gym', { transactions: 3, recurring: 0, budgets: 0, cashItems: 0 }]]));
      await expect(service.remove(ID)).rejects.toThrow(/in use/);
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects moving to itself or to a category that is not active', async () => {
      model.findOne.mockImplementation(findOneBy(gym()));
      // The active list contains gym itself, so only the "move to itself" check can reject 'gym'.
      model.find.mockReturnValue(query([{ _id: ID, name: 'gym', color: '#3b82f6', emoji: '💪' }]));
      await expect(service.remove(ID, 'gym')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.remove(ID, 'nope')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('deactivates an unused category without moving anything', async () => {
      model.findOne.mockReturnValueOnce(query(gym()));
      model.findOneAndUpdate.mockResolvedValueOnce({ _id: ID });
      await service.remove(ID);
      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: ID, userId: 1, name: 'gym', active: true, pending: null },
        { $set: { active: false, pending: null } },
      );
      expect(refs.migrate).not.toHaveBeenCalled();
    });

    it('hides it first, then moves everything and clears pending', async () => {
      model.findOne.mockReturnValueOnce(query(gym()));
      refs.usage.mockResolvedValue(new Map([['gym', { transactions: 3, recurring: 1, budgets: 2, cashItems: 0 }]]));
      model.findOneAndUpdate.mockResolvedValueOnce({ _id: ID });
      await service.remove(ID, 'health');
      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: ID, userId: 1, name: 'gym', active: true, pending: null },
        { $set: { active: false, pending: { from: 'gym', to: 'health' } } },
      );
      expect(refs.migrate).toHaveBeenCalledWith('gym', 'health');
      expect(model.updateOne).toHaveBeenCalledWith(
        { _id: ID, 'pending.from': 'gym', 'pending.to': 'health' },
        { $set: { pending: null } },
      );
      expect(model.findOneAndUpdate.mock.invocationCallOrder[0]).toBeLessThan(refs.migrate.mock.invocationCallOrder[0]);
    });

    it('answers 409 when another change got there first', async () => {
      model.findOne.mockReturnValueOnce(query(gym()));
      await expect(service.remove(ID, 'health')).rejects.toBeInstanceOf(ConflictException);
      expect(refs.migrate).not.toHaveBeenCalled();
    });

    it('refuses to delete a category that was already deleted', async () => {
      model.findOne.mockImplementation(findOneBy(gym({ active: false })));
      await expect(service.remove(ID)).rejects.toThrow(/was deleted/);
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('counts a category as in use through recurring rules or budgets alone', async () => {
      model.findOne.mockImplementation(findOneBy(gym()));
      refs.usage.mockResolvedValueOnce(new Map([['gym', { transactions: 0, recurring: 1, budgets: 0, cashItems: 0 }]]));
      await expect(service.remove(ID)).rejects.toThrow(/in use/);
      refs.usage.mockResolvedValueOnce(new Map([['gym', { transactions: 0, recurring: 0, budgets: 1, cashItems: 0 }]]));
      await expect(service.remove(ID)).rejects.toThrow(/in use/);
    });

    it('counts a category as in use through cash items alone', async () => {
      model.findOne.mockImplementation(findOneBy(gym()));
      refs.usage.mockResolvedValueOnce(new Map([['gym', { transactions: 0, recurring: 0, budgets: 0, cashItems: 2 }]]));
      await expect(service.remove(ID)).rejects.toThrow(/in use/);
    });

    it('hides a legacy custom category that carries a built-in name without moving the built-in data', async () => {
      model.findOne.mockImplementation(findOneBy(gym({ name: 'food' })));
      refs.usage.mockResolvedValue(new Map([['food', { transactions: 42, recurring: 0, budgets: 1, cashItems: 0 }]]));
      await expect(service.remove(ID, 'other')).rejects.toThrow(/built-in/);
      model.findOneAndUpdate.mockResolvedValueOnce({ _id: ID });
      await service.remove(ID);
      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: ID, userId: 1, name: 'food', active: true, pending: null },
        { $set: { active: false, pending: null } },
      );
      expect(refs.migrate).not.toHaveBeenCalled();
    });
  });

  describe('finish', () => {
    it('re-runs an unfinished move', async () => {
      model.findOne.mockReturnValueOnce(query(gym({ active: false, pending: { from: 'gym', to: 'health' } })));
      await expect(service.finish(ID)).resolves.toEqual({ id: ID });
      expect(refs.migrate).toHaveBeenCalledWith('gym', 'health');
      expect(model.updateOne).toHaveBeenCalledWith(
        { _id: ID, 'pending.from': 'gym', 'pending.to': 'health' },
        { $set: { pending: null } },
      );
    });

    it('answers 404 when there is no unfinished move', async () => {
      model.findOne.mockReturnValueOnce(query(gym()));
      await expect(service.finish(ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('overview', () => {
    it('lists built-ins first, then custom by name, with usage, palette and emoji', async () => {
      const custom = query([
        gym(),
        { _id: OLD_ID, name: 'old', emoji: '🎯', color: '#ef4444', active: false, pending: { from: 'old', to: 'food' } },
      ]);
      model.find.mockReturnValueOnce(custom);
      refs.usage.mockResolvedValue(
        new Map([
          ['food', { transactions: 5, recurring: 0, budgets: 1, cashItems: 0 }],
          ['gym', { transactions: 3, recurring: 1, budgets: 0, cashItems: 0 }],
        ]),
      );
      const o = await service.overview();
      expect(model.find).toHaveBeenCalledWith({ userId: 1, $or: [{ active: true }, { pending: { $ne: null } }] });
      expect(custom.sort).toHaveBeenCalledWith({ name: 1 });
      expect(o.categories[0]).toEqual({
        id: null, name: 'food', emoji: '🍔', color: '#10e5a0', isBuiltIn: true, active: true,
        usage: { transactions: 5, recurring: 0, budgets: 1, cashItems: 0 }, pending: null,
      });
      expect(o.categories.slice(9)).toEqual([
        { id: ID, name: 'gym', emoji: '💪', color: '#3b82f6', isBuiltIn: false, active: true,
          usage: { transactions: 3, recurring: 1, budgets: 0, cashItems: 0 }, pending: null },
        { id: OLD_ID, name: 'old', emoji: '🎯', color: '#ef4444', isBuiltIn: false, active: false,
          usage: { transactions: 0, recurring: 0, budgets: 0, cashItems: 0 }, pending: { from: 'old', to: 'food' } },
      ]);
      expect(o.palette).toHaveLength(10);
      expect(o.emojis).toHaveLength(20);
    });

    it("gives a legacy custom category sharing a built-in's name no usage of its own", async () => {
      model.find.mockReturnValueOnce(query([gym({ name: 'food' })]));
      refs.usage.mockResolvedValue(new Map([['food', { transactions: 42, recurring: 0, budgets: 1, cashItems: 0 }]]));
      const o = await service.overview();
      const builtInFood = o.categories.find((c) => c.isBuiltIn && c.name === 'food');
      const customFood = o.categories.find((c) => !c.isBuiltIn && c.name === 'food');
      expect(builtInFood!.usage).toEqual({ transactions: 42, recurring: 0, budgets: 1, cashItems: 0 });
      expect(customFood!.usage).toEqual({ transactions: 0, recurring: 0, budgets: 0, cashItems: 0 });
    });
  });
});
