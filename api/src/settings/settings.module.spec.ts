// IngestionModule and ReportsModule each pull in a service that reaches a
// @Cron (IngestionService, ReportSchedulerService); @nestjs/schedule is
// ESM-only under this Jest setup, so it must be shimmed before either module
// is imported.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined, ScheduleModule: { forRoot: () => ({ module: class {} }) } }));

import 'reflect-metadata';
import { SettingsModule } from './settings.module';
import { SettingsService } from './settings.service';
import { ReportsModule } from '../reports/reports.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { IngestionController } from '../ingestion/ingestion.controller';

describe('SettingsModule wiring', () => {
  it('exports SettingsService, so other modules can read/save Settings', () => {
    expect(Reflect.getMetadata('exports', SettingsModule)).toContain(SettingsService);
  });

  it('is imported by ReportsModule and IngestionModule, the two consumers of Settings', () => {
    expect(Reflect.getMetadata('imports', ReportsModule)).toContain(SettingsModule);
    expect(Reflect.getMetadata('imports', IngestionModule)).toContain(SettingsModule);
  });

  it('IngestionModule wires up IngestionController', () => {
    expect(Reflect.getMetadata('controllers', IngestionModule)).toContain(IngestionController);
  });
});
