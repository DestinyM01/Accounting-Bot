import 'reflect-metadata';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { MerchantsController } from './merchants.controller';
import { MerchantsModule } from './merchants.module';

describe('MerchantsController', () => {
  const memory = { list: jest.fn(), match: jest.fn(), add: jest.fn(), change: jest.fn(), forget: jest.fn() };
  const controller = new MerchantsController(memory as any);

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['add', 201],
    ['change', 200],
    ['forget', 204],
  ])('pins %s to %i', (method, code) => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, (MerchantsController.prototype as any)[method])).toBe(code);
  });

  it('lists the remembered merchants', async () => {
    const rows = [{ id: 'm1', key: 'prime video', category: 'entertainment', updatedAt: null, rows: 2, usable: true }];
    memory.list.mockResolvedValue(rows);
    await expect(controller.list()).resolves.toBe(rows);
  });

  it('passes the typed name to match', async () => {
    memory.match.mockResolvedValue({ key: 'uber trip', rows: 1, remembered: null });
    await expect(controller.match('UBER *TRIP')).resolves.toEqual({ key: 'uber trip', rows: 1, remembered: null });
    expect(memory.match).toHaveBeenCalledWith('UBER *TRIP');
  });

  it('passes the name and category to add', async () => {
    memory.add.mockResolvedValue({ id: 'm9', key: 'uber trip', alsoFiled: 0 });
    await expect(controller.add({ name: 'UBER *TRIP', category: 'transport' })).resolves.toEqual({ id: 'm9', key: 'uber trip', alsoFiled: 0 });
    expect(memory.add).toHaveBeenCalledWith('UBER *TRIP', 'transport');
  });

  it('passes nothing on from a missing body, so the service answers 400', async () => {
    await controller.add(undefined);
    expect(memory.add).toHaveBeenCalledWith(undefined, undefined);
  });

  it('passes the id and category to change', async () => {
    memory.change.mockResolvedValue({ moved: 3 });
    await expect(controller.change('m1', { category: 'food' })).resolves.toEqual({ moved: 3 });
    expect(memory.change).toHaveBeenCalledWith('m1', 'food');
  });

  it('forgets and answers nothing', async () => {
    memory.forget.mockResolvedValue(undefined);
    await expect(controller.forget('m1')).resolves.toBeUndefined();
    expect(memory.forget).toHaveBeenCalledWith('m1');
  });
});

// Nest resolves providers only when the app starts; a missing module import would crash the pod on deploy.
// This compiles the real module graph (models stubbed, no database) so the tests catch it instead.
describe('MerchantsModule', () => {
  it('builds its controller with every dependency it needs', async () => {
    let builder = Test.createTestingModule({ imports: [MerchantsModule] });
    for (const model of ['MerchantCategory', 'Transaction', 'CustomCategory', 'Recurring', 'Budget', 'CashAllocation']) {
      builder = builder.overrideProvider(getModelToken(model)).useValue({});
    }
    const mod = await builder.compile();
    expect(mod.get(MerchantsController)).toBeInstanceOf(MerchantsController);
  });
});
