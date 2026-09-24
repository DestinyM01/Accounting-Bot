import { ReportSendSchema } from './report-send.schema';

describe('ReportSendSchema', () => {
  // The database, not find-then-create code, guarantees one record per report:
  // two api pods during a rollout can both try to claim it; only one insert wins.
  it('declares a unique index on (kind, period)', () => {
    expect(ReportSendSchema.indexes()).toContainEqual([
      { kind: 1, period: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });
});
