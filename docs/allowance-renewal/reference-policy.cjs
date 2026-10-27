// Offline review model only. No runtime imports, database access, migrations,
// timers, credentials, or production integration. See DESIGN.md before use.
'use strict';

function checkPeriod(period, now) {
  if (!period || !period.membershipId || !period.companyId || !period.subjectId ||
      !period.verified || !period.monthlyCadenceConfirmed ||
      !Number.isSafeInteger(period.start) || !Number.isSafeInteger(period.end) ||
      period.start >= period.end || period.start > now || now >= period.end) {
    throw new Error('CURRENT_VERIFIED_MONTHLY_PERIOD_REQUIRED');
  }
}

// Must execute while holding the tenant User row lock; outputs are committed
// with the unique period and operation rows in ONE transaction by a future adapter.
function transition({ current, period, tier, now, legacyUsage, operation, cap, receipt }) {
  if (!['CORE', 'ENTERPRISE'].includes(tier)) throw new Error('RECURRING_TIER_REQUIRED');
  checkPeriod(period, now);
  if (!Number.isSafeInteger(cap) || cap < 0 || !Number.isSafeInteger(legacyUsage) || legacyUsage < 0 ||
      !operation?.id || !operation.hash || !Number.isSafeInteger(operation.count) || operation.count < 0)
    throw new Error('INVALID_ALLOCATION');

  // A receipt is tenant scoped by the future adapter, and includes its original
  // period. Retrying an old operation must not spend a new period's allowance.
  if (receipt) {
    if (receipt.id !== operation.id || receipt.hash !== operation.hash) throw new Error('IDEMPOTENCY_CONFLICT');
    return { replay: true, allocated: receipt.allocated, state: current, receipt, lifetimeIncrement: 0 };
  }

  let state;
  let archive;
  if (!current) {
    // Conservative cutover: no automatic forgiveness of unattributable legacy use.
    state = { ...period, used: legacyUsage };
  } else {
    if (current.companyId !== period.companyId || current.subjectId !== period.subjectId)
      throw new Error('PERIOD_PRINCIPAL_CHANGED');
    if (current.membershipId !== period.membershipId)
      throw new Error('MEMBERSHIP_TRANSFER_REVIEW_REQUIRED');
    if (period.start === current.start && period.end === current.end) {
      state = { ...current };
    } else if (period.start >= current.end) {
      // Future adapter must atomically compare the locked cursor and append a row.
      archive = { ...current };
      state = { ...period, used: 0 };
    } else {
      // Reject old, overlapping, extended or shortened periods rather than award
      // a second allowance for plan edits, replayed events, or provider corrections.
      throw new Error('PERIOD_CHANGE_REVIEW_REQUIRED');
    }
  }
  const allocated = Math.min(operation.count, Math.max(0, cap - state.used));
  state.used += allocated;
  return { replay: false, state, archive, allocated, lifetimeIncrement: allocated,
    receipt: { id: operation.id, hash: operation.hash, allocated, start: state.start, end: state.end } };
}
module.exports = { transition };
