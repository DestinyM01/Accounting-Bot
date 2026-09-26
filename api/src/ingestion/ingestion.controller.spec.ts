import 'reflect-metadata';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { BadGatewayException, ConflictException, ServiceUnavailableException } from '@nestjs/common';

// IngestionService carries a @Cron; @nestjs/schedule is ESM-only under this Jest setup.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

import { IngestionController } from './ingestion.controller';

describe('IngestionController', () => {
  const make = (ingestion: any, status: any) => new IngestionController(ingestion, status);

  it('shows the status, saying whether a run is in flight', async () => {
    const status = { view: jest.fn().mockResolvedValue({ running: true }) };
    await expect(make({ isRunning: true }, status).status()).resolves.toEqual({ running: true });
    expect(status.view).toHaveBeenCalledWith(true);
  });

  it("runs a check now and answers with its counts", async () => {
    const counts = { created: 1, alreadyBooked: 2, notTransactions: 0, unreadable: 0, bookingFailed: 0 };
    const ingestion = { runGuarded: jest.fn().mockResolvedValue(counts) };
    await expect(make(ingestion, {}).run()).resolves.toEqual(counts);
  });

  it('answers 409 while a run is in flight', async () => {
    await expect(make({ runGuarded: jest.fn().mockResolvedValue(null) }, {}).run()).rejects.toThrow(ConflictException);
  });

  it('answers 503 instead of 409 when the null comes from the server shutting down', async () => {
    const ingestion = { runGuarded: jest.fn().mockResolvedValue(null), isStopping: true };
    await expect(make(ingestion, {}).run()).rejects.toThrow(
      new ServiceUnavailableException('The server is restarting — try again in a minute.'),
    );
  });

  it('answers 502 with the reason when the check fails', async () => {
    const ingestion = { runGuarded: jest.fn().mockRejectedValue(new Error('Invalid credentials')) };
    await expect(make(ingestion, {}).run()).rejects.toThrow(new BadGatewayException('The check failed: Invalid credentials'));
  });

  it('dismisses an unreadable mail', async () => {
    const status = { dismiss: jest.fn().mockResolvedValue(undefined) };
    await make({}, status).dismiss('m1');
    expect(status.dismiss).toHaveBeenCalledWith('m1');
  });

  it('answers 200 for a run and 204 for a dismiss', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, IngestionController.prototype.run)).toBe(200);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, IngestionController.prototype.dismiss)).toBe(204);
  });
});
