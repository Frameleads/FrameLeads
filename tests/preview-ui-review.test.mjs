import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('preview review route is Preview-only and reuses the actual guide and dashboard shell', () => {
  const route = read('src/app/preview-ui-review/page.tsx');
  assert.match(route, /dynamic = 'force-dynamic'/);
  assert.match(route, /process\.env\.VERCEL_ENV !== 'preview'\) notFound\(\)/);
  assert.match(route, /import DashboardLayout from '\.\.\/dashboard\/layout'/);
  assert.match(route, /import HowItWorksPage from '\.\.\/dashboard\/how-it-works\/page'/);
  assert.match(route, /<DashboardLayout previewReviewOnly>/);
  assert.match(route, /robots: \{ index: false, follow: false \}/);
});

test('review shell shows the real guide navigation state without fetching account lists', () => {
  const layout = read('src/app/dashboard/layout.tsx');
  assert.match(layout, /previewReviewOnly \? "\/dashboard\/how-it-works" : pathname/);
  assert.match(layout, /if \(previewReviewOnly\) return;\s*loadLists\(\)/);
  assert.match(layout, /DashboardLayoutContent previewReviewOnly=\{previewReviewOnly\}/);
  const middleware = read('src/middleware.ts');
  assert.match(middleware, /matcher: \["\/dashboard\/:path\*", "\/welcome"\]/);
  assert.match(middleware, /if \(!sessionCookie\?\.value\)/);
});
