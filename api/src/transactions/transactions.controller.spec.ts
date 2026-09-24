import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { TransactionsController } from './transactions.controller';
import { RecurringController } from '../recurring/recurring.controller';
import { JwtAuthGuard } from '../auth/jwt.guard';

// The write surface is the API's first way to move the user's money. The guard
// is inherited from the class decorator today; this pins it so a future
// method-level override or a controller split cannot drop it silently.
describe.each([
  ['TransactionsController', TransactionsController],
  ['RecurringController', RecurringController],
])('%s auth guard', (_name, Ctrl) => {
  it('is protected by JwtAuthGuard at class level', () => {
    const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, Ctrl) ?? [];
    expect(guards).toContain(JwtAuthGuard);
  });

  it('no handler opts out of the class guard', () => {
    const proto = Ctrl.prototype;
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      const methodGuards: unknown[] | undefined = Reflect.getMetadata(GUARDS_METADATA, proto[name]);
      if (methodGuards) expect(methodGuards).toContain(JwtAuthGuard);
    }
  });
});
