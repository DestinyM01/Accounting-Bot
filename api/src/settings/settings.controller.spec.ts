import { SettingsController } from './settings.controller';

// "Use the server's config" (spec 1.10): DELETE reports/accounts forgets the
// saved section and hands back the refreshed view, so the page can re-render
// straight from the response.
describe('SettingsController', () => {
  const settings = {
    view: jest.fn(),
    saveReports: jest.fn(),
    saveAccounts: jest.fn(),
    resetReports: jest.fn(),
    resetAccounts: jest.fn(),
  };
  const controller = new SettingsController(settings as any);

  beforeEach(() => jest.clearAllMocks());

  it('DELETE reports resets the saved reports section and returns the refreshed view', async () => {
    const view = { reports: { weekly: { value: true, source: 'config' } } };
    settings.resetReports.mockResolvedValue(view);
    await expect(controller.resetReports()).resolves.toBe(view);
    expect(settings.resetReports).toHaveBeenCalledWith();
  });

  it('DELETE accounts resets the saved accounts section and returns the refreshed view', async () => {
    const view = { accounts: { cash: { value: [], source: 'config' } } };
    settings.resetAccounts.mockResolvedValue(view);
    await expect(controller.resetAccounts()).resolves.toBe(view);
    expect(settings.resetAccounts).toHaveBeenCalledWith();
  });
});
