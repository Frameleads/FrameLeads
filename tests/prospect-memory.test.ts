import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { getProspectMemoryContext, MEMORY_EVENT, recordProspectMemoryEvent } from '../src/lib/prospects/memory';
import { installMemoryFixture } from './memory-fixture';

function fixture() {
  const prospect = { id: 'p1', userId: 'a', firstName: 'Ada', lastName: 'Lovelace', companyName: 'Acme', createdAt: new Date('2026-01-01') };
  const tx: any = {
    prospect: { findUnique: async ({ where }: any) => where.userId_id.userId === 'a' && where.userId_id.id === 'p1' ? prospect : null },
    generatedLead: { findMany: async () => [{ id: 'l1', createdAt: new Date('2026-01-02') }] },
    inboundSignal: { findMany: async () => [{ id: 's1', createdAt: new Date('2026-01-04') }] },
    outboundLog: { findMany: async () => [{ id: 'o1', sentAt: new Date('2026-01-03') }] },
  };
  const memory = installMemoryFixture(tx);
  const db = { ...tx, $transaction: async (work: any) => work(tx) } as PrismaClient;
  return { db, memory };
}

test('tenant isolation and source idempotency preserve append-only history', async () => {
  const f = fixture();
  const event = { userId: 'a', prospectId: 'p1', eventType: MEMORY_EVENT.INBOUND_RECEIVED, sourceType: 'INBOUND_SIGNAL', sourceId: 's2', description: 'Reply received', importance: 3 };
  assert.equal(await recordProspectMemoryEvent(event, f.db), true);
  assert.equal(await recordProspectMemoryEvent(event, f.db), false);
  assert.equal(f.memory.events.length, 1);
  assert.equal(f.memory.events[0].description, 'Reply received');
  await assert.rejects(recordProspectMemoryEvent({ ...event, userId: 'b' }, f.db), /not found/);
  assert.equal(f.memory.events.length, 1);
});

test('lazy baseline is repeatable and retrieves bounded, purpose-selected events', async () => {
  const f = fixture(); const scope = { userId: 'a', prospectId: 'p1' };
  const first = await getProspectMemoryContext({ ...scope, purpose: 'INBOX', maxEvents: 2 }, f.db);
  const second = await getProspectMemoryContext({ ...scope, purpose: 'INBOX', maxEvents: 2 }, f.db);
  assert.equal(first.eventCount, 4);
  assert.equal(second.eventCount, 4);
  assert.equal(second.rollingSummary, first.rollingSummary);
  assert.equal(f.memory.events.length, 4);
  assert.equal(second.events.length, 2);
  assert.equal(second.events[0].eventType, MEMORY_EVENT.INBOUND_RECEIVED);
  assert.ok(second.rollingSummary.includes('Inbound reply received.'));
  assert.ok(second.contextText.length <= 3000);
});

test('reply context options never leak into Prisma baseline identity filters', async () => {
  const f = fixture();
  const original = f.db.prospectMemoryEvent.findFirst;
  let baselineChecks = 0;
  f.db.prospectMemoryEvent.findFirst = (async (args: any) => {
    const allowed = ['userId', 'prospectId', 'eventType', 'sourceType', 'sourceId'];
    assert.ok(Object.keys(args.where).every(key => allowed.includes(key)), 'Prisma rejects retrieval options in memory identity');
    baselineChecks++;
    return original(args);
  }) as any;
  const result = await getProspectMemoryContext({ userId: 'a', prospectId: 'p1', purpose: 'INBOX',
    maxEvents: 6, since: new Date('2026-01-01'), eventTypes: [MEMORY_EVENT.INBOUND_RECEIVED] }, f.db);
  assert.ok(baselineChecks > 0);
  assert.equal(result.eventCount, 4);
  assert.ok(result.events.every(event => event.eventType === MEMORY_EVENT.INBOUND_RECEIVED));
});

test('large event descriptions and retrieved context are bounded without model usage', async () => {
  const f = fixture(); const scope = { userId: 'a', prospectId: 'p1' };
  for (let i = 0; i < 30; i++) await recordProspectMemoryEvent({ ...scope, eventType: MEMORY_EVENT.RESEARCH_COMPLETED,
    sourceType: 'TEST', sourceId: String(i), description: 'x'.repeat(1000) }, f.db);
  const context = await getProspectMemoryContext({ ...scope, maxEvents: 100 }, f.db);
  assert.equal(context.events.length, 20);
  assert.ok(context.events.every(event => event.description.length <= 360));
  assert.ok(context.rollingSummary.length <= 1200);
  assert.ok(context.contextText.length <= 3000);
});
