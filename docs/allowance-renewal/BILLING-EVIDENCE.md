# Whop billing configuration evidence — PR #18

Recorded 2026-10-27 from the owner's direct inspection of actual Whop pricing-option screenshots and read-only Whop API GETs. Screenshot-derived configuration was owner reported; exact current plan identities, product associations, visibility, pricing, and numeric billing periods were verified from the provider API. No billing settings were changed.

| Tier | Current plan | Product | Type | API `billing_period` | Amount | Visibility | Trial |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| Enterprise | `plan_uGDGf5WKW7hlE` | `prod_7CoRolH7SDjmQ` — FrameLeads Enterprise: Revenue Decision Intelligence | renewal | 30 days | USD 499/month | visible | none configured |
| Core | `plan_GQTDPXnvijugf` | `prod_1GtBYI46Z2HQS` — FrameLeads Core: Reply Decision Intelligence | renewal | 30 days | USD 149/month | visible | none configured |

The plan API has no populated `status` field for these records; `visibility: visible` is the catalog status. They were created on 2026-10-25 and match the owner's approved current options. Core allowance remains 500 prospects per month and Enterprise 10,000 per month. PR #17 and Micro-Pilot remain unchanged.

## Historical plan reconciliation

The earlier Core plan `plan_sAEhr77rTrhX4` costs USD 147/month and the earlier Enterprise plan `plan_jdy5Z44fMKMAz` costs USD 697/month. Both are renewal plans with `billing_period: 30`, reference the same respective products as the current plans, were created on 2026-08-18, and are now archived. Their update timestamps coincide with current plan creation on 2026-10-25. The $147/$697 values are historical pricing, not a current mismatch. `plan_PZqjKqvMr0KBI` is a separate one-time Enterprise plan with no recurring period.

## Membership reconciliation

The dedicated audit credential was available in the managed runtime; its value was never printed. Restricted HTTP egress was enforced with `api.whop.com` allowed. The completed read-only membership collection returned 73 records over two pages. The latest refresh completed at 2026-10-27T14:44:26.768Z. Production Neon account rows were read through the authorized read-only connection, and eight SaaS records matched by stored Whop subject ID.

The owner confirmed all six Enterprise accounts are internal test memberships. They are excluded from future enrollment; their historic usage remains intact. The two Core accounts remain canceled and their classification is unknown. They require individual owner disposition and must not be assumed to be test accounts. No account among the eight will be reenrolled.

Seven of eight accounts have no currently entitled recurring membership matching their SaaS tier. The eighth is a provider-active Enterprise membership in the confirmed internal test cohort, on the archived $697 plan. Its membership-list record has `promo_code_id`, USD 0.00 initial and renewal prices, a numeric 30-day cadence, and no current period start/end. Its archived plan has no configured trial. Those fields are consistent with a promotional/free checkout, but they do not prove that the promotion caused Whop to omit the boundaries. The individual detail GET could not be completed in this follow-up because the restricted executor route failed DNS resolution for `api.whop.com`; no membership fields were manufactured. The API evidence does not establish a successful paid charge.

No membership was observed on the current $149/$499 plans. The verified plan catalog alone does not prove that actual paid memberships on those plans return usable period boundaries. Require genuine current-plan membership evidence with exact start and end timestamps before period allocation; keep the allocator fail-closed until then.

The authenticated membership detail endpoint, `GET /api/v1/memberships/{id}` ([Whop docs](https://docs.whop.com/api-reference/memberships/retrieve-membership), `member:basic:read`), is the authoritative period source. The installed `@whop/sdk` 2.6.0 membership types describe nullable `current_period_start/end` and legacy nullable `renewal_period_start/end`. The Payments API can report paid state, `paid_at`, and the linked membership, but has no subscription boundary fields; payment time is not a period anchor ([payments docs](https://docs.whop.com/api-reference/payments/list-payments)). The latest direct membership and payment reads failed with executor DNS `EAI_AGAIN`. No genuine paid current-plan sample exists, so current-plan period behavior remains unverified and allocation stays fail-closed.

Canceled memberships are rejected by current paid entitlement verification and an authoritative no-membership result persists `INACTIVE`. Paid-feature routes require live entitlement checks. The OAuth callback contains a hard-coded email fallback that permits login with a persisted Enterprise tier when membership is missing. Read-only production Vercel metadata shows `NEXT_PUBLIC_ADMIN_EMAIL` is absent; it is not a verified replacement. Do not alter the callback path until a stable administrator identity/role is verified. The email-based admin bypass must not be treated as a secret. This isolated auth issue is documented and unchanged in PR #18.

## Activation review packet

[ACTIVATION-REVIEW.json](ACTIVATION-REVIEW.json) records current plan evidence and stays non-executable: all eight historical accounts are excluded, `activationManifest.accounts` is empty, approvals are null, future cutover remains unset, and target mode is disabled. The full crosswalk and exact membership evidence remain in a mode-0600 private file outside Git. Do not pass it to enrollment tooling.

[WHOP-ACTIVATION-IMPACT.md](WHOP-ACTIVATION-IMPACT.md) contains the redacted per-account classification and impact report. [RELEASE.md](RELEASE.md) retains migration order and rollback protections.

## Owner approvals still required

1. Keep all eight historical accounts excluded; no individual Core disposition is required to preserve that exclusion.
2. Verify exact current-period boundaries on genuine paid memberships for both current plans. If Whop does not provide them reliably, leave all enrollment disabled.
3. Approve the precise migration and release commit after confirming production target, history/checksum, recovery point, and schema-first/disabled-mode order.
4. Complete authenticated desktop and mobile verification after the disabled-mode app release.
5. Separately approve future-customer enrollment policy/cutover and controlled renewal activation. This evidence packet grants none of those approvals.
6. Before any OAuth admin-path correction, establish the verified admin identity/role; PR #18 preserves the current login path.
