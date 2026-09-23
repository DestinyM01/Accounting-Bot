import { FxService } from './fx.service';

describe('FxService', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('converts using the live rate when available', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ rates: { DOP: 62.5 } }),
    }) as unknown as typeof fetch;

    const svc = new FxService();
    expect(await svc.usdToDop(20)).toBe(1250);
  });

  it('falls back to USD_DOP_RATE when the fetch fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    const prev = process.env.USD_DOP_RATE;
    process.env.USD_DOP_RATE = '61';

    const svc = new FxService();
    expect(await svc.usdToDop(10)).toBe(610);

    if (prev === undefined) delete process.env.USD_DOP_RATE;
    else process.env.USD_DOP_RATE = prev;
  });

  it('never throws when the network is down and no env rate is set', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    const prev = process.env.USD_DOP_RATE;
    delete process.env.USD_DOP_RATE;

    const svc = new FxService();
    await expect(svc.usdToDop(1)).resolves.toBeGreaterThan(0);

    if (prev !== undefined) process.env.USD_DOP_RATE = prev;
  });

  it('caches the rate so a second call does not refetch', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      json: async () => ({ rates: { DOP: 60 } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new FxService();
    await svc.usdToDop(1);
    await svc.usdToDop(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
