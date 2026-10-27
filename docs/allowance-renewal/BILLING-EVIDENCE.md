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

## Read-only provider evidence collected — 2026-10-27

The dedicated `WHOP_AUDIT_TOKEN` and `WHOP_AUDIT_COMPANY_ID` bindings were
reported ready by the managed runtime. Its current HTTP policy was restricted
and enforced, with `api.whop.com` explicitly allowed. The audit used GET only
for the membership list, selected membership records, and exact plan records.
Pagination completed across two pages with 73 provider memberships.

The production Neon rows were queried read-only through the connected Neon SQL
tool because this executor had no TCP route to the database host. Eight recurring
SaaS accounts matched Whop subjects by exact stored Whop subject ID (no email).
Seven have no currently entitled recurring membership matching their stored
tier; the remaining Enterprise account has one active membership, but its
current period start and end are absent. Six accounts have exact historical
periods on canceled memberships. Those dates are not current renewal anchors.

The API returned `account.id`, `plan_id`, `current_period_start`, and
`current_period_end`. The collector and entitlement adapter now normalize these
fields as well as the nested `company`/`plan`/`renewal_period_*` form. The
read-only collector completed with an empty enrollment manifest. Its report is
[WHOP-ACTIVATION-IMPACT.md](WHOP-ACTIVATION-IMPACT.md).

Exact plan reads add a material configuration discrepancy. The observed
recurring Enterprise plan `plan_jdy5Z44fMKMAz` is USD 697/month with a 30-day
period; the observed recurring Core plan `plan_sAEhr77rTrhX4` is USD 147/month
with a 30-day period. The owner-reported screenshot options are USD 499/month
and USD 149/month. Two mapped Enterprise accounts also have canceled one-time
memberships on `plan_PZqjKqvMr0KBI`; its plan record has no recurring period.
The active Enterprise membership's current period boundaries are missing.
Resolve the price/plan mapping, status, payment state, and current period before
any activation. The exact membership IDs, user IDs, and subject crosswalk remain
in a mode-0600 private review file outside Git.

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
