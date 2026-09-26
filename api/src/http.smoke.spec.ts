// @nestjs/schedule ships as an ES module and isn't exercised here (no cron
// runs in a unit test): stub the decorator, as ingestion.service.spec does.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { JwtAuthGuard } from './auth/jwt.guard';
import { TransactionsController } from './transactions/transactions.controller';
import { TransactionsService } from './transactions/transactions.service';
import { IngestionController } from './ingestion/ingestion.controller';
import { IngestionService } from './ingestion/ingestion.service';
import { IngestionStatusService } from './ingestion/ingestion-status.service';

/**
 * The HTTP layer itself: routing, parameter and query parsing, headers and
 * status codes, through the real Express adapter. The services are mocked and
 * the login check is switched off. Guards against framework upgrades
 * (Express 5 in NestJS 11) changing what reaches the services.
 */
describe('HTTP smoke', () => {
  let app: INestApplication;
  const tx = { findAll: jest.fn(), exportCsv: jest.fn(), setCategory: jest.fn() };
  const ingestion = { runGuarded: jest.fn(), isRunning: false, isStopping: false };
  const status = { view: jest.fn(), dismiss: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TransactionsController, IngestionController],
      providers: [
        { provide: TransactionsService, useValue: tx },
        { provide: IngestionService, useValue: ingestion },
        { provide: IngestionStatusService, useValue: status },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    ingestion.isStopping = false;
  });

  it('passes list filters through with the right types', async () => {
    tx.findAll.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0, nextCursor: null });
    const res = await request(app.getHttpServer())
      .get('/transactions')
      .query({ search: 'coffee', needsReview: 'true', limit: '20', before: 'cursor-1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], total: 0, limit: 20, offset: 0, nextCursor: null });
    expect(tx.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'coffee', needsReview: true, limit: 20, before: 'cursor-1' }),
    );
  });

  it('exports CSV with its headers, passing the search through', async () => {
    tx.exportCsv.mockResolvedValue('Date,Name\n"2026-09-01","shop"');
    const res = await request(app.getHttpServer()).get('/transactions/export').query({ search: 'shop' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="transactions-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.text).toBe('Date,Name\n"2026-09-01","shop"');
    expect(tx.exportCsv).toHaveBeenCalledWith(expect.objectContaining({ search: 'shop' }));
  });

  it('routes an :id path and reads the JSON body', async () => {
    tx.setCategory.mockResolvedValue({ alsoFiled: 0 });
    const res = await request(app.getHttpServer())
      .patch('/transactions/64b0000000000000000000a1/category')
      .send({ category: 'food' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ alsoFiled: 0 });
    expect(tx.setCategory).toHaveBeenCalledWith('64b0000000000000000000a1', 'food');
  });

  it('answers Check mail now with the counts', async () => {
    const counts = { created: 1, alreadyBooked: 0, notTransactions: 0, unreadable: 0, bookingFailed: 0, unverified: 0 };
    ingestion.runGuarded.mockResolvedValue(counts);
    const res = await request(app.getHttpServer()).post('/ingestion/run');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(counts);
  });

  it('answers 409 while a check is running and 503 while the server stops', async () => {
    ingestion.runGuarded.mockResolvedValue(null);
    expect((await request(app.getHttpServer()).post('/ingestion/run')).status).toBe(409);
    ingestion.isStopping = true;
    expect((await request(app.getHttpServer()).post('/ingestion/run')).status).toBe(503);
  });

  it('answers 404 for an unknown path', async () => {
    expect((await request(app.getHttpServer()).get('/nope')).status).toBe(404);
  });
});
