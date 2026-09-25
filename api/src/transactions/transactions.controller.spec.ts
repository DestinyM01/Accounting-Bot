import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';

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
