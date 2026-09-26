import { Logger } from '@nestjs/common';
import { waitForIdle } from './wait-for-idle';

describe('waitForIdle', () => {
  const logger = new Logger('test');
  let warn: jest.SpyInstance;
  beforeEach(() => { warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined); });
  afterEach(() => jest.restoreAllMocks());

  it('returns at once when nothing is running', async () => {
    await waitForIdle(() => false, 'a run', logger, 1000);
    expect(warn).not.toHaveBeenCalled();
  });

  it('waits until the run finishes', async () => {
    let busy = true;
    setTimeout(() => (busy = false), 250);
    const started = Date.now();
    await waitForIdle(() => busy, 'a run', logger, 5000);
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
    expect(warn).not.toHaveBeenCalled();
  });

  it('gives up after the timeout with a warning', async () => {
    await waitForIdle(() => true, 'a run', logger, 300);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('a run still in flight'));
  });
});
