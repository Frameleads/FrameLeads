// Read-only production impact/evidence collection. No schema, billing or usage writes.
// WHOP_AUDIT_TOKEN must be supplied through an authorized secret binding, never CLI arguments.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const ts = require('typescript');
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file,
}).outputText, file);
const { PrismaClient } = require('@prisma/client');
const { selectAllowancePeriod, membershipCurrentlyEntitled } = require('../src/lib/whop-memberships.ts');
const { resolveWhopSubscription } = require('../src/lib/whop-subscription.ts');
function normalizeMembership(m) {
  const relationId = value => typeof value === 'string' ? value : value?.id;
  const companyId = m.company_id || relationId(m.company) || relationId(m.account);
  const planId = m.plan?.id || m.plan_id;
  return { ...m, ...(companyId ? { company_id: companyId } : {}),
    ...(planId && !m.plan?.id ? { plan: { id: planId, billing_period: m.billing_period_days } } : {}),
    renewal_period_start: m.renewal_period_start ?? m.current_period_start ?? null,
    renewal_period_end: m.renewal_period_end ?? m.current_period_end ?? null };
}
async function main() {
  const token = process.env.WHOP_AUDIT_TOKEN;
  const company = process.env.WHOP_AUDIT_COMPANY_ID;
  if (!token || !company) throw new Error('Bind read-only WHOP_AUDIT_TOKEN and WHOP_AUDIT_COMPANY_ID before collection');
  if (process.env.WHOP_SANDBOX === 'true') throw new Error('Production audit must not use Sandbox configuration');
  const db = new PrismaClient();
  try {
    const users = await db.user.findMany({ where: { tier: { in: ['CORE', 'ENTERPRISE'] } },
      select: { id: true, whopId: true, tier: true, monthlyQuota: true, leadsProcessed: true } });
    async function get(url) {
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000), cache: 'no-store' });
      if (!r.ok) throw new Error('Whop read failed: HTTP ' + r.status);
      const raw = await r.text(); if (raw.length > 2000000) throw new Error('Oversized Whop response'); return JSON.parse(raw);
    }
    let memberships = [], cursor, complete = false; const seen = new Set();
    for (let page = 0; page < 10; page++) {
      const url = new URL('https://api.whop.com/api/v1/memberships');
      url.search = new URLSearchParams({ account_id: company, first: '50', expand: 'plan' }).toString();
      if (cursor) url.searchParams.set('after', cursor);
      const result = await get(url);
      if (!Array.isArray(result.data)) throw new Error('Unknown Whop membership response contract');
      memberships.push(...result.data.map(normalizeMembership));
      if (result.page_info?.has_next_page !== true) { complete = true; break; }
      cursor = result.page_info?.end_cursor;
      if (!cursor || seen.has(cursor)) throw new Error('Incomplete Whop pagination'); seen.add(cursor);
    }
    if (!complete) throw new Error('Whop history exceeds audit limit; do not activate from partial results');
    // Retrieve plan intervals only when missing from expanded memberships; GET only.
    const plans = new Map();
    for (const m of memberships) if (m.plan?.id && m.plan.billing_period == null && m.billing_period_days == null) {
      const id = m.plan.id; if (!/^plan_[a-zA-Z0-9]+$/.test(id)) continue;
      if (!plans.has(id)) { const p = await get('https://api.whop.com/api/v1/plans/' + id); plans.set(id, p.data || p); }
      const plan = plans.get(id); if (plan.id === id) m.plan = { ...m.plan, billing_period: plan.billing_period };
    }
    const privateManifest = [], report = [];
    for (const u of users) {
      const own = memberships.filter(m => (m.user_id || m.user?.id || m.user) === u.whopId && (m.company_id || m.company?.id || m.company) === company);
      const proof = selectAllowancePeriod(own, u.tier, u.whopId, company);
      let providerTier = null; try { providerTier = resolveWhopSubscription(own.filter(m => membershipCurrentlyEntitled(m))).tier; } catch {}
      report.push({ account: createHash('sha256').update(u.id).digest('hex').slice(0,12), tier: u.tier, storedQuota: u.monthlyQuota,
        preservedLifetimeUsage: u.leadsProcessed, providerTier, memberships: own.length, readyForReview: Boolean(proof),
        period: proof ? { start: new Date(proof.start).toISOString(), end: new Date(proof.end).toISOString(), billingDays: proof.billingDays } : null,
        reason: proof ? 'Conservative seed requires owner impact review' : 'Missing/ambiguous/unrecognized/nonmonthly provider period; do not enroll' });
      if (proof) privateManifest.push({ userId: u.id, proof, expectedLegacyUsage: u.leadsProcessed });
    }
    const flag = process.argv.indexOf('--private-manifest');
    if (flag >= 0) {
      const file = process.argv[flag + 1]; if (!file) throw new Error('Missing private manifest path');
      fs.writeFileSync(file, JSON.stringify({ collectedAt: new Date().toISOString(), accounts: privateManifest }, null, 2), { mode: 0o600, flag: 'wx' });
    }
    console.log(JSON.stringify({ readOnly: true, accounts: report }, null, 2));
  } finally { await db.$disconnect(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
