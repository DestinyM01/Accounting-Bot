import { BudgetController } from './budget.controller';

// Express 5 hands @Body() undefined, not {}, when a request carries no body
// (Express 4 handed {}). set() must still reach the service with undefined
// fields, not throw a raw TypeError reading them off the body.
describe('BudgetController#set', () => {
  it('passes undefined fields through when no body is sent', async () => {
    const service = { set: jest.fn().mockResolvedValue(undefined) };
    const controller = new BudgetController(service as any);
    await controller.set(undefined as any);
    expect(service.set).toHaveBeenCalledWith(undefined, undefined, undefined, undefined);
  });
});
