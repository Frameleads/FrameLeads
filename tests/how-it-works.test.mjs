import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('How it works is first in the shared desktop and mobile sidebar', () => {
  const layout = read('src/app/dashboard/layout.tsx');
  const how = layout.indexOf('label: "How it works"');
  const onboarding = layout.indexOf('label: "Onboarding"');
  assert.ok(how >= 0 && onboarding > how);
  assert.match(layout, /const SidebarContent =/);
  assert.match(layout, /<aside[^>]*md:hidden[^>]*>\s*\{SidebarContent\}/s);
  assert.match(layout, /<aside[^>]*md:flex[^>]*>\s*\{SidebarContent\}/s);
});

test('workflow guide links only to existing dashboard page routes', () => {
  const page = read('src/app/dashboard/how-it-works/page.tsx');
  const links = [...page.matchAll(/href: '(\/dashboard\/[^']+)'/g)].map((match) => match[1]);
  assert.ok(links.length >= 15);
  for (const href of new Set(links)) {
    assert.ok(existsSync(`src/app${href}/page.tsx`), `Missing route for ${href}`);
  }
  assert.match(page, /name: 'Prepare'/);
  assert.match(page, /name: 'Send'/);
  assert.match(page, /name: 'Govern'/);
  assert.match(page, /grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3/);
  assert.match(page, /md:col-span-2 xl:col-span-3/);
  assert.match(page, /drop-shadow-\[0_0_6px/);
  assert.match(page, /step\.number === '05' \? 'whitespace-nowrap text-\[9px\]' : ''/);
  assert.match(page, /aria-label="Step label key"/);
  assert.match(page, /mb-2 flex items-center gap-3/);
  assert.match(page, /mb-3 inline-flex max-w-full self-start/);
  assert.match(page, /h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-\[#1A1A1A\] text-\[#FF5A1F\]/);
  assert.match(page, /recommended: 'border-\[#1A1A1A\] bg-\[#1A1A1A\] text-\[#FFFFFF\]'/);
  assert.match(page, /optional: 'border-\[#1A1A1A\] bg-\[#1A1A1A\] text-\[#888888\]'/);
  assert.match(page, /plan: 'border-\[#1A1A1A\] bg-\[#1A1A1A\] text-\[#888888\]'/);
  assert.match(page, /<span className="inline-flex items-center gap-2 rounded-full border border-\[#1A1A1A\] bg-\[#1A1A1A\] px-3 py-2"><span className="font-mono font-semibold text-\[#FFFFFF\]">Recommended<\/span>/);
  assert.match(page, /<span className="inline-flex items-center gap-2 rounded-full border border-\[#1A1A1A\] bg-\[#1A1A1A\] px-3 py-2"><span className="font-mono font-medium text-\[#888888\]">Optional<\/span>/);
  assert.match(page, /step\.statusTone === 'optional' \|\| step\.statusTone === 'plan' \? 'font-medium' : 'font-semibold'/);
  assert.match(page, /number: '13', title: 'Learning & Governance'/);
  assert.match(page, /step\.number === '13' \? 'xl:whitespace-nowrap' : ''/);
  assert.match(page, /font-heading text-3xl font-semibold tracking-tight/);
  assert.match(page, /font-heading text-xl font-semibold/);
  assert.match(page, /font-heading text-sm font-semibold leading-5/);
  assert.match(page, /font-mono text-\[11px\] font-semibold tracking-wider/);
  assert.match(page, /mb-3 inline-flex max-w-full self-start rounded-full border px-2 py-0\.5 font-sans text-\[10px\] leading-4 tracking-normal xl:whitespace-nowrap/);
  assert.match(page, /font-sans text-\[13px\] leading-5/);
  const setupNotice = read('src/components/SetupNotice.tsx');
  assert.match(setupNotice, /rounded-xl border px-4 py-3 font-sans/);
  assert.match(setupNotice, /font-mono text-\[10px\] font-semibold uppercase/);
  assert.match(setupNotice, /font-sans text-sm font-semibold/);
  assert.match(page, /xl:whitespace-nowrap/);
  assert.equal([...page.matchAll(/number: '\d{2}'/g)].length, 13);
  assert.match(page, /bg-\[#FF5A1F\] px-2\.5 py-2 font-sans text-\[10px\] font-semibold text-\[#000000\]/);
  assert.match(page, /border border-\[#242424\] bg-\[#1A1A1A\] p-4 sm:p-5/);
  assert.match(page, /border border-\[#1A1A1A\] bg-\[#242424\] p-4/);
  assert.match(page, /flex flex-wrap gap-2 border-t/);
  assert.doesNotMatch(page, /ArrowRight|ArrowLeft/);
  assert.match(page, /<ArrowDown/);
  assert.match(page, /REQUIRED|RECOMMENDED|OPTIONAL/);
  assert.doesNotMatch(page, /checked=|completion|localStorage|sessionStorage|fetch\(/i);
});

test('workflow prerequisite and plan claims match the existing product gates', () => {
  const page = read('src/app/dashboard/how-it-works/page.tsx');
  const ingestion = read('src/app/dashboard/ingestion/IngestionClient.tsx');
  const entitlements = read('src/lib/entitlements.ts');
  const send = read('src/app/api/email/send/route.ts');
  assert.match(ingestion, /if \(!campaignContext\)/);
  assert.match(page, /Campaign Context must be present before the current ingestion flow/);
  assert.match(send, /requireFeatureAccess\('BASE_OUTBOUND'\)/);
  assert.match(send, /if \(!user\.imapEmail \|\| !user\.imapPassword \|\| !user\.imapHost\)/);
  assert.match(send, /generatedLead\.findFirst\([\s\S]*?userId: user\.id[\s\S]*?email:/);
  assert.match(entitlements, /'SCOUT', 'ICP', 'PROSPECT_RESEARCH'/);
  assert.match(entitlements, /'BRAIN', 'PLAYBOOK', 'INBOX_TRIAGE'/);
  assert.match(entitlements, /'CUSTOM_MARKET_PROFILES'.*'AUTOMATION'/);
  assert.match(entitlements, /'DECISION_SANDBOX', 'OUTCOME_LEARNING'/);
});

test('Sandbox reads only mailbox connection status and shows the Inbox Triage setup link', () => {
  const sandbox = read('src/app/dashboard/sandbox/SandboxClient.tsx');
  const inbox = read('src/app/dashboard/inbox-triage/TriageCommandCenter.tsx');
  const credentials = read('src/app/api/inbox/credentials/route.ts');
  assert.match(sandbox, /fetch\('\/api\/inbox\/credentials', \{ cache: 'no-store' \}\)/);
  assert.match(sandbox, /result\?\.mailbox\?\.connected === true/);
  assert.match(sandbox, /Native Sandbox email requires a connected supported mailbox/);
  assert.match(sandbox, /href="\/dashboard\/inbox-triage"/);
  assert.match(inbox, /result\.mailbox\.connected \? 'connected' : 'disconnected'/);
  assert.match(inbox, /Connect a mailbox to sync native inbox replies/);
  assert.match(credentials, /connected: Boolean\(user\.imapEmail && user\.imapHost && user\.imapPort && user\.imapPassword\)/);
  assert.doesNotMatch(sandbox, /imapPassword|appPassword|imapHost/);
});

test('setup notices reflect real Scout, Brain, and external deployment state', () => {
  const scoutPage = read('src/app/dashboard/scout/page.tsx');
  const scout = read('src/app/dashboard/scout/ScoutWorkspace.tsx');
  const sandboxPage = read('src/app/dashboard/sandbox/page.tsx');
  const sandbox = read('src/app/dashboard/sandbox/SandboxClient.tsx');
  const deploy = read('src/app/dashboard/deploy/page.tsx');
  const automation = read('src/app/dashboard/automation/AutomationSettings.tsx');
  assert.match(scoutPage, /profileState = !profile \? 'missing' : !profile\.isActive \? 'inactive'/);
  assert.match(scout, /Qualification has not been run for these prospects/);
  assert.match(scout, /Run research on eligible prospects/);
  assert.match(sandboxPage, /verification: 'VERIFIED'/);
  assert.match(sandbox, /This does not block drafting/);
  assert.match(deploy, /only for the external provider you selected/);
  assert.match(automation, /Campaign and list controls, the server rollout setting, Sales Constitution boundaries, and human approval gates still apply/);
});

test('notice status, headline, guidance, and CTA remain in the intended order', () => {
  const source = read('src/components/SetupNotice.tsx');
  const status = source.indexOf('>{level}</span>');
  const headline = source.indexOf('<h2 className=', status);
  const guidance = source.indexOf('>{children}</div>', headline);
  const cta = source.indexOf('<Link href={href}', guidance);
  assert.ok(status > 0 && headline > status && guidance > headline && cta > guidance);
  assert.match(source, /<Icon[^>]*aria-hidden="true"\s*\/>\s*<span[^>]*>\{level\}<\/span>/);
});

test('Scout desktop table has aligned columns, breathing room and horizontal overflow', () => {
  const source = read('src/app/dashboard/scout/ScoutWorkspace.tsx');
  const columns = 'grid-cols-[minmax(170px,1.15fr)_minmax(195px,1.25fr)_minmax(118px,0.8fr)_minmax(132px,0.9fr)_minmax(190px,1.25fr)_minmax(152px,1fr)_minmax(182px,1fr)]';
  assert.equal(source.split(columns).length - 1, 2, 'Header and rows use identical columns');
  assert.match(source, /overflow-x-auto[\s\S]*?min-w-\[1320px\]/);
  assert.match(source, /min-h-\[112px\].*px-6 py-5/);
  assert.match(source, /line-clamp-2 break-words text-\[11px\] leading-4/);
  assert.match(source, /xl:hidden/);
});
