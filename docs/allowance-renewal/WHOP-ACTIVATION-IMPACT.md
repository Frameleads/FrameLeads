# Whop activation impact report (redacted)

Collected 2026-10-27T14:06:40.910Z from read-only GET requests to api.whop.com. Production Neon data was read through the connected Neon SQL tool. The Whop credential and business identifier were ready in the managed runtime; restricted HTTP egress was enforced and allowed api.whop.com. No billing, database, or production changes were made.

Pagination completed across 2 pages and 73 membership records for the supplied FrameLeads business. Provider-wide status counts were completed: 3, active: 1, canceled: 69. The records were matched to eight recurring SaaS accounts by the stored Whop subject ID, with no email or name used in this report.

The account references below are the first 12 characters of SHA-256 over the SaaS user ID. They are pseudonymous and have no customer contact details.

| Account ref | SaaS tier | Lifetime usage | Matched target-tier status counts | Target-tier plan IDs | Numeric cadence days observed | Provider period evidence | Enrollment finding |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| 8e52a7428303 | CORE | 0 | canceled 1 | plan_sAEhr77rTrhX4 | 30 | 2026-08-18T21:39:26.459Z → 2026-09-17T21:39:26.459Z (canceled) | No current entitled recurring membership |
| 8499d930a570 | CORE | 0 | canceled 1 | plan_sAEhr77rTrhX4 | 30 | 2026-08-18T22:02:54.572Z → 2026-09-17T22:02:54.572Z (canceled) | No current entitled recurring membership |
| 3457e4043e55 | ENTERPRISE | 0 | canceled 1 | plan_jdy5Z44fMKMAz | 30 | 2026-08-18T20:24:52.252Z → 2026-09-17T20:24:52.252Z (canceled) | No current entitled recurring membership |
| a57cd57556a6 | ENTERPRISE | 0 | canceled 1 | plan_jdy5Z44fMKMAz | 30 | 2026-08-18T20:40:35.980Z → 2026-09-17T20:40:35.980Z (canceled) | No current entitled recurring membership |
| ad04c321cf39 | ENTERPRISE | 0 | canceled 1 | plan_jdy5Z44fMKMAz | 30 | 2026-08-18T21:01:43.678Z → 2026-09-17T21:01:43.678Z (canceled) | No current entitled recurring membership |
| 225be10f468a | ENTERPRISE | 117 | canceled 1 | plan_jdy5Z44fMKMAz | 30 | 2026-08-20T06:46:24.023Z → 2026-09-19T06:46:24.023Z (canceled) | No current entitled recurring membership |
| 738694d6b03f | ENTERPRISE | 162 | canceled 2 | plan_PZqjKqvMr0KBI<br>plan_jdy5Z44fMKMAz | 30 | Not returned | No current entitled recurring membership |
| 1f4744c7af0b | ENTERPRISE | 10 | active 1, canceled 2 | plan_PZqjKqvMr0KBI<br>plan_jdy5Z44fMKMAz | 30 | Not returned | Active membership lacks exact current period boundaries |

## Findings

- The production impact remains 2 Core accounts with 0 lifetime usage and 6 Enterprise accounts with 289 combined lifetime usage (individual range 0–162). The eight counters were read only and remain unchanged.
- Seven mapped SaaS accounts have no currently entitled recurring Whop membership matching their stored tier. Their matching current-tier records are canceled. Six of those accounts have an exact historical billing period on a canceled membership; those dates are not current renewal anchors.
- One Enterprise account has an active membership on plan_jdy5Z44fMKMAz. Whop returned a 30-day cadence for that membership, and GET on the plan returned billing_period: 30. Whop returned neither current_period_start nor current_period_end, so it is not eligible for seeding.
- Core historical memberships on plan_sAEhr77rTrhX4 returned a 30-day cadence; the matching GET plan record also returned billing_period: 30. Enterprise historical memberships on plan_jdy5Z44fMKMAz returned exact 30-day periods. Two accounts also have canceled Enterprise memberships on plan_PZqjKqvMr0KBI, for which the plan endpoint returned no numeric billing period.
- The current recurring plan records do not match the owner-reported screenshot prices: plan_jdy5Z44fMKMAz is Enterprise, 30-day renewal, USD 697/month; plan_sAEhr77rTrhX4 is Core, 30-day renewal, USD 147/month. The owner-reported current options were USD 499/month and USD 149/month. Two mapped Enterprise accounts also have canceled one-time memberships on plan_PZqjKqvMr0KBI (USD 697, no recurring period). The price/plan mapping requires owner resolution.
- The API read did not include a payment receipt, so active status alone does not prove a successful paid renewal. Payment state must be reconciled privately before release.
- For the other seven mapped accounts, the evidence does not establish an active paid subscription. Their current tier membership state must be resolved before release. No enrollment accounts qualify (0/8).

## Evidence handling and limits

The live API payload used account.id, plan_id, current_period_start, and current_period_end. A temporary in-memory adapter first mapped those provider fields to the collector's expected aliases while preserving their values. The checked-in collector was then updated to accept both Whop response shapes and rerun directly against the live API; it produced the same redacted eight-account report and an empty enrollment manifest. The matching provider adapter in whop-memberships.ts now uses the same alias normalization. No tests were added or run as part of this evidence continuation.

The complete private crosswalk, membership IDs/statuses, exact historical periods, and account IDs are held outside Git in a mode-0600 private activation review file. It is marked DO_NOT_APPLY_BLOCKED, contains an empty executable enrollment manifest, and has SHA-256 420f1779925464d7f5081e9f84a57b11c394d211b9585fd91e3682a0488facc2. It must not be committed or passed to the enrollment tool as an approved manifest.

## Release blockers

1. Resolve the discrepancy between the owner-reported Core USD 149/Enterprise USD 499 pricing options and the matched provider plan records Core USD 147/Enterprise USD 697; obtain an owner-reviewed disposition for each affected account.
2. Resolve why seven active SaaS tiers have no currently entitled matching Whop membership and obtain an owner-reviewed disposition for each account.
3. Obtain the active Enterprise membership's exact period boundaries from a provider read that returns them; do not infer them from creation time, a prior canceled period, or 30-day arithmetic. Reconcile its payment state privately.
4. Confirm whether the canceled plan_PZqjKqvMr0KBI memberships are legacy/nonrecurring and map each historical plan to the reviewed pricing options.
5. Review the per-account lifetime seed impact, exact migration and release commit, and current restore readiness.
6. Complete normally authenticated desktop and mobile verification after the reviewed release.

Status: **blocked; keep PR #18 draft; no migration, merge, enrollment, activation, or billing write is approved.**
