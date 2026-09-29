import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMPAIGN_SESSION_KEY, clearCampaignContext, readCampaignContext, writeCampaignContext } from '../src/lib/campaign-session';

function installStorage() {
  const makeStorage = () => {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, String(value)),
      removeItem: (key: string) => values.delete(key), values };
  };
  const sessionStorage = makeStorage(); const localStorage = makeStorage();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { sessionStorage, localStorage } });
  return { sessionStorage, localStorage };
}

test('legacy localStorage campaign context is discarded and never hydrated', () => {
  const { localStorage, sessionStorage } = installStorage();
  localStorage.setItem('campaign_context', JSON.stringify({ company_name: 'Old User' }));
  assert.equal(readCampaignContext(), null);
  assert.equal(sessionStorage.getItem(CAMPAIGN_SESSION_KEY), null);
  assert.equal(localStorage.getItem('campaign_context'), null);
});

test('current tab campaign context can be written and read', () => {
  const { sessionStorage } = installStorage();
  const context = { company_name: 'Current Session', target_audience: 'Operators' };
  writeCampaignContext(context);
  assert.deepEqual(readCampaignContext(), context);
  assert.ok(sessionStorage.getItem(CAMPAIGN_SESSION_KEY));
});

test('sign-out cleanup removes campaign context keys only', () => {
  const { sessionStorage, localStorage } = installStorage();
  sessionStorage.setItem(CAMPAIGN_SESSION_KEY, '{"company_name":"Current"}');
  sessionStorage.setItem('frameleads_batch', 'preserve unrelated flow state');
  localStorage.setItem('frameleads_admin_demo', 'true');
  clearCampaignContext();
  assert.equal(sessionStorage.getItem(CAMPAIGN_SESSION_KEY), null);
  assert.equal(sessionStorage.getItem('frameleads_batch'), 'preserve unrelated flow state');
  assert.equal(localStorage.getItem('frameleads_admin_demo'), 'true');
});
