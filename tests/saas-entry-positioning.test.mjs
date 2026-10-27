import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const login = readFileSync(new URL("../src/app/login/page.tsx", import.meta.url), "utf8");
const welcome = readFileSync(new URL("../src/app/welcome/page.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");

test("Login keeps Whop authentication unchanged and uses approved charcoal surfaces", () => {
  assert.match(login, /window\.location\.href = "\/api\/auth\/login"/);
  assert.match(login, /id="whop-login-button"/);
  assert.match(login, /Log in with Whop/);
  assert.match(login, /bg-\[#1A1A1A\]/);
  assert.match(login, /bg-\[#242424\]/);
  assert.match(login, /The governed decision layer for outbound replies/);
  assert.match(login, /Review prospect replies, next actions, and decisions that need you/);
  assert.match(login, /Terms of Service and Privacy/);
  assert.doesNotMatch(login, /AI-powered outreach for high-ticket B2B|access your outreach engine|bg-card\/50/);
});

test("Welcome message sells post-reply decisions without claiming active setup", () => {
  assert.match(welcome, /Keep outbound moving/);
  assert.match(welcome, /after the reply/);
  assert.match(welcome, /reply intent, prospect context, and your sales rules/);
  assert.match(welcome, /consequential replies stay under your control/);
  assert.match(welcome, /Enter Decision Workspace/);
  assert.match(welcome, /router\.push\('\/dashboard\/campaign'\)/);
  assert.match(welcome, /GOVERNED REPLY DECISIONS/);
  assert.match(welcome, /PROSPECT CONTEXT • SALES RULES • HUMAN CONTROL/);
  assert.doesNotMatch(welcome, /architecture is live|whale replies|endless follow-ups|ZERO-CODE DEPLOYMENT|ALL LOGIC ENGINES OPERATIONAL/);
});

test("SaaS metadata reflects governed reply decisions", () => {
  assert.match(layout, /FrameLeads — Governed Decisions After the Reply/);
  assert.match(layout, /what happens after a prospect replies/);
  assert.doesNotMatch(layout, /AI-Powered B2B Outreach Engine|Powered by LangGraph/);
});
