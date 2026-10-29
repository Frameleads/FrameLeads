import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const dashboard = readFileSync(
  new URL("../src/app/dashboard/governance/GovernanceDashboard.tsx", import.meta.url),
  "utf8",
);

test("both governance charts fit their cards without internal scrollbars", () => {
  const charts = dashboard.split("Data Visualizations (Live-Bound)")[1].split("Queue Status Bar")[0];
  assert.equal((charts.match(/h-\[240px\] w-full min-w-0 overflow-hidden/g) ?? []).length, 2);
  assert.equal((charts.match(/<ResponsiveContainer width="100%" height="100%" minWidth=\{0\}>/g) ?? []).length, 2);
  assert.equal((charts.match(/relative min-w-0 overflow-hidden rounded-2xl/g) ?? []).length, 2);
  assert.doesNotMatch(charts, /overflow-x-auto|overflow-y-auto|min-w-\[400px\]|hide-scrollbar/);
});

test("zero ARR uses an honest zero baseline and readable currency axis", () => {
  assert.match(dashboard, /hasNonzeroProtectedARR = metrics\.timeSeriesData\.some/);
  assert.match(dashboard, /ticks=\{hasNonzeroProtectedARR \? undefined : \[0\]\}/);
  assert.match(dashboard, /tickFormatter=\{\(value: number\) => formatCurrency\(value\)\}/);
  assert.doesNotMatch(dashboard, /\(value \/ 1000\) \+ "k"/);
});

test("live metrics and review-latency empty state remain intact", () => {
  assert.match(dashboard, /data=\{metrics\.timeSeriesData\}/);
  assert.match(dashboard, /metrics\.queue\.protectionSignalCount > 0/);
  assert.match(dashboard, /No completed reviews yet/);
  assert.match(dashboard, /<EnterprisePaywall userTier=\{userTier\}/);
});
