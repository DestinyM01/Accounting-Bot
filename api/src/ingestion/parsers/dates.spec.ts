import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';
import { parseDdMmYyyy12h, parseDdMmYyyyDash12h, parseDMyHmsNoMeridiem } from './dates';

describe('parseDdMmYyyyDash12h', () => {
  it('parses "28/08/2026 - 8:33 AM"', () => {
    const d = parseDdMmYyyyDash12h('28/08/2026 - 8:33 AM');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(7);
    expect(d!.getDate()).toBe(28);
    expect(d!.getHours()).toBe(8);
    expect(d!.getMinutes()).toBe(33);
  });

  it('converts PM correctly', () => {
    expect(parseDdMmYyyyDash12h('24/08/2026 - 2:51 PM')!.getHours()).toBe(14);
  });

  it('treats 12:xx AM as midnight', () => {
    expect(parseDdMmYyyyDash12h('02/09/2026 - 12:15 AM')!.getHours()).toBe(0);
  });

  it('falls back to the date-only parse when no time is present', () => {
    expect(parseDdMmYyyyDash12h('28/08/2026')!.getDate()).toBe(28);
  });

  it('returns null for unparseable input', () => {
    expect(parseDdMmYyyyDash12h('not a date')).toBeNull();
  });
});

describe('bank times are read in the user zone', () => {
  it('stores a BHD "09:53 pm" as the true instant', () => {
    expect(parseDdMmYyyy12h('24/09/2026 09:53 pm')!.toISOString()).toBe('2026-09-25T01:53:00.000Z');
  });
});

// Santa Cruz transfers print a 12-hour time with no AM or PM. The mail's
// arrival decides: the reading closest to it, and not after it.
describe('parseDMyHmsNoMeridiem', () => {
  const at = (iso: string) => new Date(iso);

  it('picks PM for "03:51:40" when the mail arrived at 3:52 PM', () => {
    expect(parseDMyHmsNoMeridiem('2/10/2026 03:51:40', at('2026-10-02T19:52:56Z'))!.toISOString()).toBe('2026-10-02T19:51:40.000Z');
  });

  it('keeps AM when the mail arrived at 3:52 AM', () => {
    expect(parseDMyHmsNoMeridiem('2/10/2026 03:51:40', at('2026-10-02T07:52:56Z'))!.toISOString()).toBe('2026-10-02T07:51:40.000Z');
  });

  it('allows a few minutes of clock skew between the bank and Gmail', () => {
    // Arrived 2 minutes before the PM reading: still that PM transfer.
    expect(parseDMyHmsNoMeridiem('2/10/2026 03:51:40', at('2026-10-02T19:49:40Z'))!.toISOString()).toBe('2026-10-02T19:51:40.000Z');
  });

  it('tells noon from midnight', () => {
    expect(parseDMyHmsNoMeridiem('2/10/2026 12:10:00', at('2026-10-02T16:11:00Z'))!.toISOString()).toBe('2026-10-02T16:10:00.000Z');
    expect(parseDMyHmsNoMeridiem('2/10/2026 12:10:00', at('2026-10-02T04:11:00Z'))!.toISOString()).toBe('2026-10-02T04:10:00.000Z');
  });

  it('keeps a late-evening transfer whose mail arrived after midnight on its own day', () => {
    expect(parseDMyHmsNoMeridiem('2/10/2026 11:50:00', at('2026-10-03T04:05:00Z'))!.toISOString()).toBe('2026-10-03T03:50:00.000Z');
  });

  it('takes an hour above 12 as already 24-hour', () => {
    expect(parseDMyHmsNoMeridiem('2/10/2026 15:51:40', at('2026-10-02T19:52:56Z'))!.toISOString()).toBe('2026-10-02T19:51:40.000Z');
  });

  it('reads the time as written without an arrival time', () => {
    expect(parseDMyHmsNoMeridiem('2/10/2026 03:51:40')!.toISOString()).toBe('2026-10-02T07:51:40.000Z');
  });

  it('returns null for unparseable input', () => {
    expect(parseDMyHmsNoMeridiem('not a date', at('2026-10-02T19:52:56Z'))).toBeNull();
  });
});

// Bank mail states Santo Domingo wall-clock times. They must become the same
// instants however the server's zone is set: a lost TZ line in the Dockerfile
// must not shift every mail by hours.
//
// Jest gives each test file a sandboxed copy of process.env, so writing
// process.env.TZ inside a test never reaches V8's clock — the process was
// already initialised with the real TZ before the test ran. A test built that
// way would pass even against code that used the server's local time zone.
// Only a genuine child process picks up a TZ change, so this transpiles the
// parsers (and the shared helper they depend on) to plain CommonJS, writes
// them to a temp dir, and runs them under `node -e` with TZ set explicitly.
describe('mail times in any server time zone', () => {
  let dir: string | undefined;
  let datesPath: string;

  const compile = (srcPath: string, outRelative: string) => {
    const source = fs.readFileSync(srcPath, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    });
    const outPath = path.join(dir, outRelative);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, outputText);
  };

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-'));
    // Same relative layout as the source tree, so dates.js's own
    // require('../../shared/santo-domingo') resolves unmodified.
    compile(path.join(__dirname, 'dates.ts'), path.join('ingestion', 'parsers', 'dates.js'));
    compile(path.join(__dirname, '..', '..', 'shared', 'santo-domingo.ts'), path.join('shared', 'santo-domingo.js'));
    datesPath = path.join(dir, 'ingestion', 'parsers', 'dates.js');
  });

  afterAll(() => {
    // beforeAll may not have run (e.g. it was skipped), so dir may be unset.
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it.each(['UTC', 'Asia/Tokyo'])('reads Santo Domingo wall-clock times with TZ=%s', (tz) => {
    const script = `
      const dates = require(${JSON.stringify(datesPath)});
      process.stdout.write(JSON.stringify([
        dates.parseDdMmYyyy('11/09/2026').toISOString(),
        dates.parseDdMmYyyy12h('18/09/2026 03:11 pm').toISOString(),
        dates.parseDdMmYyyyDash12h('28/08/2026 - 8:33 AM').toISOString(),
        dates.parseDMyHms('21/9/2026 12:32:21').toISOString(),
        dates.parseSpanishLongDate('18 de Septiembre 2026 - 11:52 AM').toISOString(),
      ]));
    `;
    const stdout = execFileSync(process.execPath, ['-e', script], {
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(JSON.parse(stdout)).toEqual([
      '2026-09-11T04:00:00.000Z',
      '2026-09-18T19:11:00.000Z',
      '2026-08-28T12:33:00.000Z',
      '2026-09-21T16:32:21.000Z',
      '2026-09-18T15:52:00.000Z',
    ]);
  });
});
