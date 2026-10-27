# Whop billing configuration evidence — PR #18

Recorded 2026-10-27 (Asia/Dubai), from the product owner's direct inspection of
real Whop dashboard pricing-option screenshots. The owner supplied the findings
in this session; this is owner-verified configuration evidence, not an API read
or an independent inspection of attached screenshot files by the agent.

| Pricing option | Type | Amount | Currency | Interval | Free trial | Business |
| --- | --- | ---: | --- | --- | --- | --- |
| Enterprise | Recurring | 499 | USD | Every 1 month | OFF | Actual FrameLeads Whop business, owner-confirmed |
| Core | Recurring | 149 | USD | Every 1 month | OFF | Actual FrameLeads Whop business, owner-confirmed |

## What this closes

The current owner-inspected Core and Enterprise pricing options are monthly,
not annual, quarterly or one-time. Their current configured prices and trial
settings are established. No pricing, trial or billing setting needs changing.
The allowance remains Core 500/month and Enterprise 10,000/month. PR #17 and
Micro-Pilot remain unchanged.

## What it does not establish

- Exact pricing-option plan/product IDs or the business API ID: these were not
  included in the supplied findings. Existing IDs in code are candidates, not
  evidence that an inspected option or membership uses that ID.
- Membership IDs, buyer-to-SaaS tenant mappings, or current subscription status.
  A pricing option labeled Recurring is not proof that a buyer is active/paid.
- Membership-specific renewal_period_start/end, cancellation-at-end state,
  expiration, payment success, or prior periods.
- Whether every existing account subscribes to these exact current options,
  rather than a legacy option, manual/internal grant, or another membership.
- Existing membership trial history or status. Current free-trial OFF does not
  prove that no historical membership is trialing. Preserve fail-closed handling.
- The API's numeric billing-period representation. **Every 1 month does not
  authorize assigning billingDays=30**, constructing fixed 30-day periods,
  using account creation dates, or using promotional-checkout timing as an anchor.
- Attribution of historical consumed usage to a current subscription period.

The pricing configuration gate is OWNER_VERIFIED. Membership identity, current
status, exact period boundaries and API-contract gates remain OPEN.

## Required authorized read-only evidence

For each of the two Core and six Enterprise SaaS records in the current database
snapshot, privately reconcile:

1. SaaS user ID and canonical Whop subject ID (no email is needed).
2. Whop membership ID, business/company ID, product ID and exact plan ID.
3. Current lifecycle status, valid/access indicators, cancel_at_period_end and
   expiry where present. Retain the raw status in the private evidence record.
4. Exact renewal_period_start and renewal_period_end from the same membership,
   with the original timestamp representation and normalized UTC values.
5. Plan interval fields returned by the API, and their correspondence to the
   owner-inspected monthly pricing option. Do not replace missing fields with 30.
6. Collection time, source origin, and completeness of membership pagination.
   Resolve multiple current memberships deterministically or exclude for review.

Use the existing read-only collector when a least-privilege Whop membership/plan
credential is securely bound as WHOP_AUDIT_TOKEN with WHOP_AUDIT_COMPANY_ID and
approved live API network access. Keep original status/identity evidence private;
its plan/period proof output alone is not a substitute for inspecting raw status.
Alternatively use a private owner-provided membership export containing these
fields. Never paste passwords, OAuth tokens, cookies or full HAR files.

Current access recheck: no connected Whop read tool; no Whop credential or buyer
session in the managed runtime; both audit bindings absent. The collector exited
before database/network access. No membership evidence was invented or inferred.

## Activation review packet

[ACTIVATION-REVIEW.json](ACTIVATION-REVIEW.json) pins the tested implementation
and exact migration checksum. It is deliberately non-executable and blocked:
verifiedMemberships and activationManifest.accounts are empty, approval fields
are null, no future-account cutover or plan policy is populated, and mode remains
disabled. Do not submit it to the enrollment tool as if it were an approved
manifest. Fill a separate private manifest only after reconciling real memberships.

[RELEASE.md](RELEASE.md) retains the migration order and rollback protections.
There is no merge, migration, enrollment, billing write or activation authorized
by the pricing screenshots alone.
