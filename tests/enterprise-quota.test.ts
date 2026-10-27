import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reserveEnterpriseProspects } from '../src/lib/enterprise-quota';
import { readFileSync } from 'node:fs';

// Transaction fixture models Postgres row-lock serialization, retaining the actual
// allocator and counter updates. A live Postgres integration check is separate.
function fixture(initial: number) {
  let used = initial;
  let tail = Promise.resolve();
  const db: any = { $transaction: (fn: any, options: any) => {
    assert.equal(options.isolationLevel, 'ReadCommitted');
    const run = tail.then(() => fn({
      $queryRaw: async (sql: TemplateStringsArray, id: string) => {
        assert.match(sql.join('?'), /WHERE "id" = \? FOR UPDATE/);
        assert.equal(id, 'tenant');
        return [{ leadsProcessed: used }];
      },
      user: { update: async ({ where, data }: any) => {
        assert.equal(where.id, 'tenant'); used += data.leadsProcessed.increment;
      } },
    }));
    tail = run.then(() => undefined, () => undefined);
    return run;
  } };
  return { db, usage: () => used };
}
for (const [usage, requested, allocated] of [[0, 10001, 10000], [9999, 1, 1], [9999, 2, 1], [10000, 1, 0], [15000, 1, 0]]) {
  test(`Enterprise usage ${usage}, request ${requested}: allocates ${allocated}`, async () => {
    const f = fixture(usage);
    assert.equal(await reserveEnterpriseProspects(f.db, 'tenant', requested), allocated);
    assert.equal(f.usage(), usage + allocated);
  });
}
test('concurrent requests and retries cannot overspend the final slot', async () => {
  const f = fixture(9999);
  const results = await Promise.all(Array.from({ length: 20 }, () => reserveEnterpriseProspects(f.db, 'tenant', 1)));
  assert.equal(results.reduce((a, b) => a + b, 0), 1);
  assert.equal(await reserveEnterpriseProspects(f.db, 'tenant', 1), 0);
  assert.equal(f.usage(), 10000);
});
test('invalid allocations never mutate consumption', async () => {
  const f = fixture(0);
  for (const n of [-1, 0.5, NaN, Infinity]) await assert.rejects(reserveEnterpriseProspects(f.db, 'tenant', n));
  assert.equal(f.usage(), 0);
});
test('generation reserves before model calls and avoids double charging Enterprise', () => {
  const source = readFileSync('src/app/api/generate/route.ts', 'utf8');
  assert.ok(source.indexOf('await reserveEnterpriseProspects') < source.indexOf('anthropic.messages.create'));
  assert.match(source, /allowedLeads.length > 0 && tier !== 'ENTERPRISE'/);
});
