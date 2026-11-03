# Whop activation impact report (redacted)

Provider evidence collected 2026-10-27 from read-only GET requests to `api.whop.com`; the latest complete membership snapshot is 2026-10-27T14:44:26.768Z. Production Neon records were read through the authorized read-only SQL connection. No customer contact data is included. No billing, database, or production changes were made.

The supplied FrameLeads business returned 73 membership records across two complete pages: 3 completed, 1 active, and 69 canceled. The eight recurring SaaS accounts were matched by their exact stored Whop subject ID. The report uses a 12-character SHA-256 pseudonym of each SaaS user ID.

| Account ref | SaaS tier | Lifetime usage | Matched target-tier statuses | Membership evidence | Owner disposition | Enrollment finding |
| --- | --- | ---: | --- | --- | --- | --- |
| 8e52a7428303 | CORE | 0 | canceled 1 | Archived plan `plan_sAEhr77rTrhX4`; historical exact period 2026-08-18T21:39:26.459Z → 2026-09-17T21:39:26.459Z; 30 days | Unknown; owner disposition required | No current entitled membership; do not reenroll |
| 8499d930a570 | CORE | 0 | canceled 1 | Archived plan `plan_sAEhr77rTrhX4`; historical exact period 2026-08-18T22:02:54.572Z → 2026-09-17T22:02:54.572Z; 30 days | Unknown; owner disposition required | No current entitled membership; do not reenroll |
| 3457e4043e55 | ENTERPRISE | 0 | canceled 1 | Archived plan `plan_jdy5Z44fMKMAz`; historical exact period 2026-08-18T20:24:52.252Z → 2026-09-17T20:24:52.252Z; 30 days | Owner-confirmed internal test | Excluded from enrollment |
| a57cd57556a6 | ENTERPRISE | 0 | canceled 1 | Archived plan `plan_jdy5Z44fMKMAz`; historical exact period 2026-08-18T20:40:35.980Z → 2026-09-17T20:40:35.980Z; 30 days | Owner-confirmed internal test | Excluded from enrollment |
| ad04c321cf39 | ENTERPRISE | 0 | canceled 1 | Archived plan `plan_jdy5Z44fMKMAz`; historical exact period 2026-08-18T21:01:43.678Z → 2026-09-17T21:01:43.678Z; 30 days | Owner-confirmed internal test | Excluded from enrollment |
| 225be10f468a | ENTERPRISE | 117 | canceled 1 | Archived plan `plan_jdy5Z44fMKMAz`; historical exact period 2026-08-20T06:46:24.023Z → 2026-09-19T06:46:24.023Z; 30 days | Owner-confirmed internal test | Excluded; preserve lifetime usage |
| 738694d6b03f | ENTERPRISE | 162 | canceled 2 | Archived recurring plan `plan_jdy5Z44fMKMAz` and legacy one-time plan `plan_PZqjKqvMr0KBI`; no current period | Owner-confirmed internal test | Excluded; preserve lifetime usage |
| 1f4744c7af0b | ENTERPRISE | 10 | active 1, canceled 2 | Active membership on archived plan `plan_jdy5Z44fMKMAz`, numeric 30-day cadence; current period start/end absent; promo code present and both initial/renewal prices are USD 0.00 | Owner-confirmed internal test | Excluded; no period anchor; preserve lifetime usage |

## Verified current and historical plans

Exact plan GETs confirm the current owner-approved pricing options and their product associations:

| Tier | Current plan ID | Product | Plan type | Numeric `billing_period` | Price | Visibility | Trial |
| --- | --- | --- | --- | ---: | --- | --- | --- |
| CORE | `plan_GQTDPXnvijugf` | `prod_1GtBYI46Z2HQS` — FrameLeads Core: Reply Decision Intelligence | renewal | 30 days | USD 149/month | visible | none configured |
| ENTERPRISE | `plan_uGDGf5WKW7hlE` | `prod_7CoRolH7SDjmQ` — FrameLeads Enterprise: Revenue Decision Intelligence | renewal | 30 days | USD 499/month | visible | none configured |

The earlier Core plan `plan_sAEhr77rTrhX4` (USD 147/month) and Enterprise plan `plan_jdy5Z44fMKMAz` (USD 697/month) reference those same respective products, are both renewal plans with `billing_period: 30`, and are now archived. Their provider records date to 2026-08-18 and were updated as the new plans were created on 2026-10-25. The old prices are historical pricing, not a mismatch in the current visible plan catalog. The separate Enterprise plan `plan_PZqjKqvMr0KBI` is one-time, USD 697, with no recurring billing period.

## Findings and release impact

- The owner-confirmed internal test cohort is six Enterprise accounts. They are not production enrollment candidates, regardless of historical usage. No subscription will be recreated and no usage will be reset.
- The two Core accounts are not confirmed as tests. Both have canceled Core memberships; their owner disposition remains open. No automatic re-enrollment or historical-period substitution is allowed.
- Seven of eight accounts have no current entitled recurring membership matching their SaaS tier. The remaining active membership belongs to the confirmed Enterprise test cohort and is on the archived $697 plan. None of the eight qualifies for renewal enrollment.
- The active membership has a promo code and zero initial and renewal prices in the list response. The archived plan has no configured trial. Individual membership detail could not be retrieved in this follow-up because the restricted executor route could not resolve `api.whop.com`; therefore the promotion is consistent with a free checkout, but the available evidence does not prove that it caused the missing period boundaries. No current-period timestamp was inferred.
- No membership was observed on either current $149/$499 plan. The plan catalog verifies future pricing and a numeric 30-day period, but a genuine paid membership on each current plan has not yet demonstrated that Whop returns exact current-period boundaries. The allocator must remain fail-closed until a real membership provides both boundaries and passes the existing cadence validation.
- The authenticated Whop membership detail endpoint is the period source: [`GET /api/v1/memberships/{id}`](https://docs.whop.com/api-reference/memberships/retrieve-membership), requiring `member:basic:read`. The installed `@whop/sdk` 2.6.0 Membership type exposes nullable `current_period_start` and `current_period_end`; its legacy membership types expose nullable `renewal_period_start/end`. The API contract identifies the fields, but the latest detail GET and associated payment-list GET failed in this executor with DNS `EAI_AGAIN`, and no genuine paid current-plan sample exists. The missing active test membership boundaries therefore remain unexplained.
- The Payments API [`GET /api/v1/payments`](https://docs.whop.com/api-reference/payments/list-payments) can corroborate payment state, `paid_at`, and the membership association. Its SDK type does not include subscription period boundaries. Payment time, 30-day arithmetic, and checkout timestamps are not valid substitutes. No purchase or test charge was initiated.
- Current entitlement code rejects canceled memberships during live verification and persists `INACTIVE` on an authoritative no-membership result. Reviewed paid-feature routes call a fresh entitlement check; the hard-coded OAuth callback fallback accepts login and sets an Enterprise tier when its exact configured email has no membership, but paid-feature routes refresh membership and deny canceled or missing membership. Read-only Vercel production environment metadata shows `NEXT_PUBLIC_ADMIN_EMAIL` is absent, so that variable is not a verified replacement for the hard-coded callback path. Do not change the fallback until a stable verified administrator identity/role is established. The email-based `NEXT_PUBLIC_ADMIN_EMAIL` bypass is not a secret and should not be treated as an authentication factor. Identity-only access to customer-owned data routes remains distinct from paid-feature access.
- The account counters remain unchanged: Core 2 accounts / 0 lifetime usage; Enterprise 6 accounts / 289 total lifetime usage (range 0–162); Micro-Pilot 7 accounts / 52 usage, excluded from recurring renewal. The six Enterprise test accounts remain excluded, and both Core account classifications remain unresolved.
- A private crosswalk and activation manifest remain outside Git with mode 0600. The executable enrollment manifest is empty. Existing Micro-Pilot entitlements, lifetime usage, PR #17, and checkout work are preserved.

## Owner approvals required

1. Keep all six Enterprise internal test accounts and both canceled Core accounts excluded. The Core customer/test classification remains unresolved but does not block release preparation because neither account can be enrolled.
2. Provide or approve redacted authenticated membership detail evidence from genuine paid customers on each current plan, showing exact status, plan, cadence, and both period boundaries. If Whop does not return these fields, keep allocation disabled and obtain written provider clarification. No additional audit key, test purchase, or fabricated date is required or authorized.
3. Approve the exact release commit, production target, current Neon restore point and recovery path, migration history/checksum, and schema-first then disabled-mode application sequence.
4. Complete authenticated desktop/mobile verification after the app deploys with renewal mode disabled.
5. Separately approve future-customer policy/cutover and controlled activation after provider evidence is verified. No historical account enrollment is proposed.
6. For the separate OAuth issue, establish a verified administrator identity/role before approving a correction. The existing login exception remains unchanged in PR #18.

**Status: implementation is prepared for staged release review, but renewal activation is blocked.** Current plan pricing and all eight membership-to-tenant mappings are resolved. The two Core classifications remain unknown, and both accounts remain excluded. The remaining activation blocker is genuine paid membership-period evidence on the approved current plans. Current restore readiness and post-deployment authenticated UI verification are also open. No migration, merge, deployment, enrollment, activation, or Whop billing change is authorized.
