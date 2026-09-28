export function installMemoryFixture(tx: any) {
  const events: any[] = [];
  const states = new Map<string, any>();
  const key = (row: any) => `${row.userId}:${row.prospectId}`;
  tx.prospectMemoryState = {
    upsert: async ({ where, create }: any) => { const k = key(where.userId_prospectId); if (!states.has(k)) states.set(k, { ...create, eventCount: 0, rollingSummary: '', lastEventAt: null }); return states.get(k); },
    update: async ({ where, data }: any) => { const row = states.get(key(where.userId_prospectId)); row.eventCount += data.eventCount.increment; Object.assign(row, { rollingSummary: data.rollingSummary, lastEventAt: data.lastEventAt }); return row; },
    findUnique: async ({ where }: any) => states.get(key(where.userId_prospectId)) || null,
  };
  tx.prospectMemoryEvent = {
    createMany: async ({ data }: any) => { const row = data[0]; if (events.some(e => e.userId === row.userId && e.prospectId === row.prospectId && e.sourceType === row.sourceType && e.sourceId === row.sourceId && e.eventType === row.eventType)) return { count: 0 }; events.push({ id: `m${events.length + 1}`, occurredAt: new Date(), ...row }); return { count: 1 }; },
    findMany: async ({ where, take }: any) => events.filter(e => e.userId === where.userId && e.prospectId === where.prospectId && (!where.eventType || where.eventType.in.includes(e.eventType)) && (!where.importance || e.importance >= where.importance.gte)).sort((a,b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0,take),
    findFirst: async ({ where }: any) => events.filter(e => e.userId === where.userId && e.prospectId === where.prospectId &&
      (!where.eventType || e.eventType === where.eventType) && (!where.sourceType || e.sourceType === where.sourceType) &&
      (!where.sourceId || e.sourceId === where.sourceId)).sort((a,b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0] || null,
  };
  return { events, states };
}
