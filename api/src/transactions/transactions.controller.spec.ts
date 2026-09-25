import 'reflect-metadata';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';

// IngestionController pulls in IngestionService, which carries a @Cron;
// @nestjs/schedule is ESM-only under this Jest setup (same shim as
// ingestion.service.spec.ts and ingestion.controller.spec.ts).
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

import { TransactionsController } from './transactions.controller';
import { RecurringController } from '../recurring/recurring.controller';
import { BalanceController } from '../balance/balance.controller';
import { CategoriesController } from '../categories/categories.controller';
import { CashController } from '../cash/cash.controller';
import { SettingsController } from '../settings/settings.controller';
import { IngestionController } from '../ingestion/ingestion.controller';
import { CalculatorController } from '../calculator/calculator.controller';
import { MerchantsController } from '../merchants/merchants.controller';
import { JwtAuthGuard } from '../auth/jwt.guard';

// The write surface is the API's first way to move the user's money. The guard
// is inherited from the class decorator today; this pins it so a future
// method-level override or a controller split cannot drop it silently.
describe.each([
  ['TransactionsController', TransactionsController],
  ['RecurringController', RecurringController],
  ['BalanceController', BalanceController],
  ['CategoriesController', CategoriesController],
  ['CashController', CashController],
  ['SettingsController', SettingsController],
  ['IngestionController', IngestionController],
  ['CalculatorController', CalculatorController],
  ['MerchantsController', MerchantsController],
])('%s auth guard', (_name, Ctrl) => {
  it('is protected by JwtAuthGuard at class level', () => {
    const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, Ctrl) ?? [];
    expect(guards).toContain(JwtAuthGuard);
  });

  // No "no handler opts out" test: Nest merges method-level @UseGuards guards
  // ADDITIVELY onto the class-level ones — a method decorator can only add
  // guards, never remove the class guard. There is no opt-out for a test to
  // detect, so a test asserting one can never fail and proves nothing.
});

// PATCH .../category's @HttpCode(200) is deliberate: Nest defaults PATCH to
// 200 already, but this pins it so the response body ({ alsoFiled }) the web
// page reads is never silently dropped by a future 204 accident.
describe('TransactionsController#setCategory', () => {
  it('is pinned to 200', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, TransactionsController.prototype.setCategory)).toBe(200);
  });

  it("returns the service's { alsoFiled }", async () => {
    const service = { setCategory: jest.fn().mockResolvedValue({ alsoFiled: 2 }) };
    const controller = new TransactionsController(service as any);
    await expect(controller.setCategory('t1', { category: 'food' })).resolves.toEqual({ alsoFiled: 2 });
    expect(service.setCategory).toHaveBeenCalledWith('t1', 'food');
  });
});
