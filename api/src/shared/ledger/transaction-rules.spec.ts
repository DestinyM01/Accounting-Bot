import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Encodes TransactionRunner's rules for fn: no try/catch (a swallowed server
 * error makes the driver retry the transaction for up to 120 s), no
 * Promise.all, no logging. Checks the body of every run(async () => { … })
 * in the files that start transactions.
 */
const FILES: Record<string, number> = {
  'transactions/transactions.service.ts': 4,
  'ingestion/ingestion.service.ts': 1,
  'recurring/recurring-scheduler.service.ts': 1,
  'shared/ledger/transaction-runner.ts': 1,
  'balance/balance.service.ts': 1,
};

/**
 * The text of every `run(...)` call's fn: either the block between the `{`
 * after `run(async () =>` (or `run(() =>`) and its matching `}`, or, for an
 * expression-bodied arrow (no braces, e.g. `run(() => this.ledger.setTo(…))`),
 * the expression up to the matching `)` that closes the run( call itself.
 */
function runBodies(source: string): string[] {
  const bodies: string[] = [];
  const opener = /\.run\(\s*(async\s*)?\(\)\s*=>\s*/g;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(source))) {
    let i = m.index + m[0].length;
    if (source[i] === '{') {
      let depth = 1;
      i++;
      const start = i;
      for (; i < source.length && depth > 0; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') depth--;
      }
      bodies.push(source.slice(start, i - 1));
    } else {
      // Expression body: the opener already consumed run('s own opening
      // paren (balanced by the arrow's own empty `()` params), so depth
      // starts at 1 and the loop stops at the ')' that closes run(.
      let depth = 1;
      const start = i;
      for (; i < source.length && depth > 0; i++) {
        if (source[i] === '(') depth++;
        else if (source[i] === ')') depth--;
      }
      bodies.push(source.slice(start, i - 1));
    }
  }
  return bodies;
}

describe('code inside TransactionRunner.run', () => {
  for (const [file, expected] of Object.entries(FILES)) {
    const bodies = runBodies(readFileSync(join(__dirname, '..', '..', file), 'utf8'));

    it(`${file} has ${expected} transaction bod${expected === 1 ? 'y' : 'ies'}`, () => {
      expect(bodies).toHaveLength(expected);
    });

    it(`${file}: no try/catch, Promise.all, .catch() or logging inside a transaction`, () => {
      for (const body of bodies) {
        expect(body).not.toMatch(/\btry\s*\{/);
        expect(body).not.toMatch(/Promise\.all/);
        expect(body).not.toMatch(/this\.logger\./);
        expect(body).not.toMatch(/\.catch\(/);
      }
    });
  }
});
