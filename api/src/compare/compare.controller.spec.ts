import { CompareController } from './compare.controller';

// Express 5 hands @Body() undefined, not {}, when a request carries no body
// (Express 4 handed {}). compare() must still reach the service with two
// undefined months, not throw a raw TypeError destructuring the body.
describe('CompareController#compare', () => {
  it('passes undefined months through when no body is sent', async () => {
    const service = { compare: jest.fn().mockResolvedValue({ ok: true }) };
    const controller = new CompareController(service as any);
    await controller.compare(undefined as any);
    expect(service.compare).toHaveBeenCalledWith(undefined, undefined);
  });
});
