import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveIntentSignals } from '../src/lib/decision/intent-signals';

test('derives primary, secondary, and policy-supported commercial signals', () => {
  const result = deriveIntentSignals({
    decision: {
      primaryIntent: 'PRICING_INQUIRY',
      secondaryIntents: ['NEGOTIATION'],
      status: 'NEEDS_REVIEW',
      reviewReasons: ['APPROVAL_REQUIRED'],
      trace: { policyResult: [{ decision: 'REQUIRES_REVIEW', effectiveEffect: 'REQUIRE_APPROVAL',
        matchedRuleIds: ['discount-rule'] }] },
    },
    triageSignals: ['Pricing Inquiry'],
    reply: "Can you send pricing? We'd need a 20% discount if we sign this month.",
  });
  assert.deepEqual(result, ['Pricing Inquiry', 'Negotiation', '20% Discount Exception']);
});

test('returns only meaningful signals when fewer than three exist', () => {
  assert.deepEqual(deriveIntentSignals({ decision: {
    primaryIntent: 'MEETING_REQUEST', secondaryIntents: ['POSITIVE_INTEREST'],
  } }), ['Meeting Request', 'Positive Interest']);
});

test('deduplicates equivalent primary, secondary, and triage labels', () => {
  assert.deepEqual(deriveIntentSignals({ decision: {
    primaryIntent: 'PRICING_INQUIRY', secondaryIntents: ['ASKED_FOR_PRICING'],
  }, triageSignals: ['Pricing Inquiry'] }), ['Pricing Inquiry']);
});

test('handles missing data without inventing signals', () => {
  assert.deepEqual(deriveIntentSignals({}), []);
  assert.deepEqual(deriveIntentSignals({ triageSignals: ['Timing Objection'] }), ['Timing Objection']);
});

test('a scheduling decision does not acquire unrelated commercial signals', () => {
  const result = deriveIntentSignals({ decision: { primaryIntent: 'MEETING_REQUEST' },
    triageSignals: ['Meeting Requested'], reply: 'Thursday at 2 PM works. Send the invite.' });
  assert.deepEqual(result, ['Meeting Request']);
  assert.equal(result.some(signal => /pricing|negotiation|discount/i.test(signal)), false);
});

test('normal production decisions use the same derivation function', () => {
  assert.deepEqual(deriveIntentSignals({ decision: {
    primaryIntent: 'SECURITY', secondaryIntents: ['PROCUREMENT'],
    intentSignals: [{ intent: 'SECURITY', confidence: 90, evidence: 'security review' }],
  }, reply: 'Our procurement team needs a security review.' }), ['Security Review', 'Procurement Review']);
});

test('reads canonical intent output retained in the decision trace', () => {
  assert.deepEqual(deriveIntentSignals({ decision: { trace: { intentOutput: {
    primaryIntent: 'TIMING_OBJECTION',
    intents: [{ intent: 'TIMING_OBJECTION' }, { intent: 'MEETING_REQUEST' }],
  } } } }), ['Timing Objection', 'Meeting Request']);
});

test('derivation leaves the authoritative intent score unchanged', () => {
  const lead = { intentScore: 91, primaryIntent: 'PRICING_INQUIRY' };
  deriveIntentSignals({ decision: { primaryIntent: lead.primaryIntent } });
  assert.equal(lead.intentScore, 91);
});
