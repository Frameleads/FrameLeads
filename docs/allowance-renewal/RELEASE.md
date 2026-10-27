# PR #18 implementation and release gates

**Draft implementation, not merged, deployed or activated.** The live Enterprise
cap release (PR #17) remains untouched. No production schema/data/settings writes
were made during this continuation. Checkout branches and billing are unchanged.

## Implemented

- Additive `ProspectAllowancePeriod`, `ProspectAllowanceCursor`, and
  `ProspectAllowanceOperation` models/migration, with tenant composite foreign
  keys, nonnegative usage checks, valid period checks and receipt state checks.
- Real transactional allocator shared by **enrolled Core and Enterprise**. A
  tenant User row lock serializes seed, rollover and allocation. Period usage and
  lifetime `leadsProcessed` increment together; lifetime totals never reset.
- One server request receipt per tenant/idempotency key. Identical completed
  requests replay the stored response, changed payloads return 409, and in-flight
  requests cannot repeat provider work. Failures/uncertain attempts retain their
  existing charges. Crashed PROCESSING receipts remain blocked for review rather
  than automatically repeating external work. Receipt lookup persists across
  period boundaries; explicit regeneration uses a new operation key.
- Provider adapter associates one current membership's tier, identity, UTC start
  and end. Enrolled requests can GET the exact reviewed plan when the expanded
  membership omits interval metadata. Missing, ambiguous, nonmonthly, malformed,
  expired, trial or changed-membership evidence fails closed. It never synthesizes
  a calendar reset or uses event delivery time as a billing boundary.
- Authenticated `/api/usage`, and Ingestion/Sandbox displays use the same backend
  period snapshot. UI refreshes on focus, consumption and the verified boundary.
  Actual over-limit usage remains visible; remaining allowance clamps at zero.
  During verification outages, browsing existing prospects remains available,
  last-recorded usage is explicitly labeled and remaining credit is hidden.
  The consuming endpoint continues to fail closed.
- Micro-Pilot continues using its existing one-time counters/reservations. All
  existing unenrolled users retain existing accounting. Future zero-usage accounts
  can enroll automatically only after a reviewed UTC cutover and explicit plan
  policy (`PROSPECT_ALLOWANCE_NEW_ACCOUNTS_AFTER`,
  `PROSPECT_ALLOWANCE_PLAN_REVIEWS`). Both are absent by default. Unknown or
  unverifiable plans for eligible new accounts fail closed, not into legacy use.
- `PROSPECT_ALLOWANCE_MODE` defaults to `disabled`. Explicit enrollment plus
  `active` is required. `freeze` retains ledger enforcement while refusing new
  periods. An enrolled account with mode `disabled` fails closed instead of
  falling back to lifetime accounting.
- Read-only evidence collector and dry-run enrollment tool. Apply requires the
  SHA256 of the exact owner-reviewed manifest and an impact review reference.
  Enrollment checks locked usage/principal/tier; it cannot overwrite a different
  enrollment. Neither tool has been applied to production.
  Future-account activation additionally requires review of the plan policy JSON
  (planId, companyId, billingDays, reviewReference) and explicit UTC cutover.

## Actual provider/account evidence

**Owner screenshot evidence, 2026-10-27:** Core USD 149/month and Enterprise
USD 499/month, recurring every one month, free trial OFF. This remains evidence
of the inspected pricing options only.

**Read-only live Whop audit, 2026-10-27:** the dedicated audit bindings were
ready, and restricted HTTP egress was enforced with `api.whop.com` allowed.
Membership pagination completed across two pages and 73 records. The live rows
were reconciled to all eight recurring production SaaS accounts using stored
Whop subject IDs; no email was used. The Neon account rows came from read-only
Neon SQL because this executor had no TCP route to the production database host.
See [WHOP-ACTIVATION-IMPACT.md](WHOP-ACTIVATION-IMPACT.md) for the redacted
account-level status, usage, plan IDs and periods. Full IDs/statuses remain in a
mode-0600 local private evidence file outside Git.

Seven mapped accounts have no currently entitled recurring Whop membership
matching their stored tier. Their matching tier memberships are canceled. One
Enterprise account has an active membership, but Whop returned no current period
start or end. Six accounts have exact boundaries only for historical canceled
periods; those cannot be used as anchors. No account qualifies for enrollment
(0/8), and the private executable enrollment manifest is empty.

The API returned the legacy membership shape `account.id`, `plan_id`, and
`current_period_start/end`. The provider adapter and read-only collector now
normalize these aliases alongside the nested company/plan/renewal-period shape.
The collector was rerun against live Whop after the update. It completed
read-only pagination and remained fail-closed for every account.

Exact plan GETs resolve the pricing mapping. Current visible Core plan
`plan_GQTDPXnvijugf` maps to `prod_1GtBYI46Z2HQS`, is a renewal plan with
`billing_period: 30`, costs USD 149/month, and has no configured trial. Current
visible Enterprise plan `plan_uGDGf5WKW7hlE` maps to `prod_7CoRolH7SDjmQ`, is a
renewal plan with `billing_period: 30`, costs USD 499/month, and has no
configured trial. The earlier $147 Core plan and $697 Enterprise plan are
archived renewal plans on the same products. The earlier pricing mismatch is
closed. A separate Enterprise one-time plan has no recurring interval.

The owner confirms all six Enterprise SaaS accounts are internal test accounts;
exclude them from enrollment and preserve their usage. The two Core accounts
remain canceled and their classification/disposition is unknown; do not assume
they are tests or reenroll them. No account qualifies for enrollment (0/8).
The only active provider membership is one of the Enterprise test accounts on
the archived $697 plan. It reports a promo code and zero initial/renewal amounts,
but no exact current-period boundaries. This is consistent with a promotional
free checkout but does not prove why the boundaries are missing. The individual
membership detail endpoint could not be reached in this follow-up because the
restricted executor failed DNS resolution for `api.whop.com`. No receipt or
successful payment evidence was returned. Both the follow-up membership-detail
GET and associated payment-list GET also failed with DNS `EAI_AGAIN`.

No membership was observed on the new $149/$499 plans. The API catalog confirms
their numeric 30-day interval but not that a genuine paying membership supplies
the exact current-period timestamps required by the allocator. Future allocation
stays fail-closed until genuine paid memberships return both boundaries.

### Period source contract review

The authenticated membership detail endpoint is the period source:
`GET /api/v1/memberships/{id}` (`member:basic:read`; Whop docs:
<https://docs.whop.com/api-reference/memberships/retrieve-membership>). The
installed `@whop/sdk` 2.6.0 Membership type describes nullable
`current_period_start` and `current_period_end`; its legacy membership types
also expose nullable `renewal_period_start/end`. Null means no period is
recorded. The adapter accepts both pairs and fails closed if either endpoint is
absent, invalid, stale, or ambiguous. These fields, when present on the
authenticated membership record, are the authoritative period source.

The Payments API (`GET /api/v1/payments`, filterable by `membership_id`; docs:
<https://docs.whop.com/api-reference/payments/list-payments>) can corroborate
payment status, `paid_at`, and membership association. The SDK Payment type has
no subscription period start/end fields. Payment time, checkout time, plan
`billing_period: 30`, or adding 30 days to any date cannot substitute for
membership boundaries. The direct detail and payment reads failed DNS; this
review does not claim a successful charge or explain the missing periods.

No genuine paid membership on either approved current plan exists in the
available provider snapshot. Do not initiate a test purchase or use a sandbox
charge as proof. The smallest evidence needed is a redacted authenticated
membership detail response from genuine paid customers on both current plans,
showing exact plan, paid/current status, numeric cadence, and both provider
period timestamps. If either response still omits boundaries, obtain written
Whop contract/support confirmation of the authenticated source and fields before
changing the allocator.

The canceled-membership check rejects canceled/expired/unknown records, stores
`INACTIVE` after authoritative no-membership results, and paid-feature routes
recheck the Whop entitlement. Review also found an explicit hard-coded OAuth
fallback that allows one configured email to complete login with a persisted
Enterprise tier when there is no membership. Protected feature routes still
perform live entitlement refresh, so this does not demonstrate canceled-account
paid-feature access. The login exception and the configured administrator
bypass require owner disposition; no access code or account was modified.
No Whop billing or production data was changed.

**Production impact remains:** Core 2 accounts, lifetime usage 0; Enterprise 6
accounts, lifetime usage 289 (individual range 0–162); Micro-Pilot 7 accounts,
usage 52, excluded from renewal. None is over the lifetime cap. Period
attribution for the 289 Enterprise attempts is unresolved; full-history
conservative seeding still requires explicit per-account review.

### Current release gates

- Keep the six Enterprise internal test accounts and both canceled Core
  accounts excluded from enrollment. The Core classification remains unresolved
  and is not inferred or changed.
- Keep the hard-coded OAuth login exception unchanged until an administrator
  replacement is verified. Current production Vercel configuration has no
  `NEXT_PUBLIC_ADMIN_EMAIL`, so replacing the exception with that setting could
  remove administrator login. The fallback can mint a persisted Enterprise-tier
  session without a current membership; protected feature paths refresh Whop and
  deny canceled or missing memberships. Before a separate auth correction,
  establish an administrator identity/role from a stable verified Whop subject or
  another server-side trusted source. `NEXT_PUBLIC_ADMIN_EMAIL` is not a secret.
- Verify exact period start/end on genuine paid memberships for both current
  plans through authenticated membership detail. Do not infer from promotion,
  payment `paid_at`, account creation, canceled periods, or 30-day arithmetic.
- Keep existing-account enrollment and future-account auto-enrollment disabled
  until provider evidence is verified and the exact new-customer policy and UTC
  cutover receive separate approval.
- Keep the private manifest empty and all historical accounts excluded; preserve
  lifetime usage and Micro-Pilot entitlements.
- Production migration history was rechecked read-only on 2026-10-27 against
  Neon project `delicate-glitter-86466488`, branch
  `br-calm-meadow-atgqqrhf`, database `neondb`: 29 complete, 3 rolled back, 0
  unresolved, and the PR #18 migration absent. The SQL checksum matches this
  packet. Recheck immediately before any execution.
- Neon history retention is six hours; there is no automatic snapshot schedule.
  Snapshot listing returned no Neon snapshot objects. The Oct 25 recovery branch
  is a historical point only; create and verify a fresh pre-release snapshot
  after explicit owner authorization. See
  [PRODUCTION-RELEASE-APPROVAL.md](PRODUCTION-RELEASE-APPROVAL.md).
- Complete authenticated desktop/mobile verification after the app is deployed
  with renewal mode disabled.

### Reconciliation validation — 2026-10-27

- Whop membership tests: 12 passed, including current/canceled lifecycle,
  recognized legacy and current plan IDs, OAuth identity checks, live-shape
  normalization, entitlement refresh, and bounded outage behavior.
- Whop OAuth tests: passed. Entitlement tests: 15 passed. Protected route tests:
  12 passed. Renewal design tests: 15 passed.
- TypeScript `npx tsc --noEmit`: passed. The optimized production build passed
  with `NODE_OPTIONS=--max-old-space-size=4096`; the default 2 GB Node heap was
  insufficient for Next.js lint/type validation in this executor.
- Disposable PostgreSQL 17.11 integration run on 2026-10-27: all 21/21 checks
  passed after building the pre-allowance baseline schema locally and applying
  the exact additive migration SQL. SQL-only CHECK constraints were exercised.
  The database was loopback-only and disposable; no production migration was run.
- `prisma validate` passed. Migration review was read-only: the migration file
  and checksum are pinned in this packet; no migration SQL was applied during
  this reconciliation.

The migration SHA-256 is
`55e9dc1e76c33e8d5208db9cff9a8060a8c467915c63e0da4489a690cf9f5b9b`.
The authorized read-only Neon SQL check on 2026-10-27 confirmed 29 completed
rows, 3 rolled-back attempts, 0 unresolved attempts, and no PR #18 migration row
on production database `neondb`, branch `br-calm-meadow-atgqqrhf`. Reconfirm
immediately before release. The fresh pre-release snapshot is not yet created;
explicit owner authorization is required first.

## Isolated PostgreSQL and migration validation

A fresh local PostgreSQL **17.11** instance was unpacked from official Debian
packages and started on loopback port 55439, with no production copy or credentials.
The test guard accepts only loopback databases named `frameleads_allowance_test*`
and ignores the inherited production DATABASE_URL.

The existing historical migration chain does not recreate an empty database:
`20260827090000_add_native_inbox_sync` references a missing GeneratedLead table.
No old migration was changed or marked resolved. Instead, a separate fixture DB
was created from the **released Prisma schema baseline**, then the exact new
transactional migration was applied. Schema diff against the new schema is empty.
Raw check constraints were additionally exercised because Prisma's diff does not
represent CHECK constraints.

Read-only production migration history confirms all **29 prior migrations
finished**, three earlier failed attempts rolled back with successful
reapplications, zero unresolved rows, and no PR #18 migration. Thus no old
migrations should run in the intended production release; reconfirm history and
checksums immediately before release. Empty-database history remains a
pre-existing repository issue.

Validation evidence:

- 37 existing test scripts pass; new offline design checks also pass.
- 21 real PostgreSQL/provider/handler checks pass, including 20 competing final
  slots per tier, simultaneous rollover, 15,000 historical consumption, receipt
  replay across periods, transaction rollback, composite tenant isolation,
  constraints, freeze protection, same-period tier changes, and enrollment gates.
- The actual generation handler was exercised with real local allocation tables
  and mocked authentication/model output: replay returned the same response with
  only one provider invocation; changed payload returned 409; no session returned
  401. No real model, Whop request, purchase or send occurred.
- Retryable conflict handling was fault-injected around a real transaction;
  simultaneous row-lock contention was real PostgreSQL. An actual deadlock was
  not deliberately induced.
- TypeScript, Prisma validation/client generation, and optimized production build
  pass. Browser-authenticated responsive verification is still outstanding.

Reproduce after installing dependencies and provisioning the dedicated local DB:

```sh
ALLOWANCE_TEST_DATABASE_URL=postgresql://local-user@127.0.0.1:55439/frameleads_allowance_test npm run test:allowance-postgres
npm run test:allowance-renewal
npx tsc --noEmit --incremental false
npm run build
```

## Staged production release proposal — not executed

1. **Schema first:** after separate production approval, confirm the target,
   migration checksum/history, and a current restorable Neon point. Apply only
   `20261027130000_prospect_allowance_periods`. It creates empty tables and
   constraints; it does not modify account usage. Abort if history/checksum
   differs or restore readiness is not established.
2. **Application second:** after separate deployment approval, deploy the exact
   reviewed commit with `PROSPECT_ALLOWANCE_MODE=disabled`, no enrollment
   manifest, no cursor rows, and no future-account cutover or plan policy. No
   existing account is enrolled. Verify authenticated usage and desktop/mobile UI
   on an authorized account. Existing usage and Micro-Pilot paths remain intact.
3. **Provider proof:** leave all enrollment off. Obtain authenticated, redacted
   period evidence for genuine paid memberships on both current plans through
   ordinary customer activity. No test purchase, new charge, or fabricated time
   is part of this plan.
4. **Controlled activation:** only after period evidence, release target,
   restore/recovery, UI, migration history/checksum, and policy are reviewed,
   obtain separate explicit owner approval. All eight historical accounts remain
   excluded. Future-account auto-enrollment requires its own exact current-plan
   allowlist and UTC cutover approval.
5. For any later approved enrollment, create and dry-run a fresh private
   manifest, review unchanged lifetime usage, retain its digest and approval, and
   use the guarded apply tool only after separate explicit approval.

## Rollback protection

Before first enrollment, app rollback leaves empty additive tables harmless.
After enrollment, **do not roll back to pre-ledger code** or set mode disabled as
a convenience: cumulative counters would lock out renewed customers. Use `freeze`
with the ledger-aware release: current valid-period consumption continues, new
periods block with a retryable verification error. Preserve cursor/period/operation
rows and all lifetime totals. In-flight requests can finalize their receipts.
Do not clear a PROCESSING receipt merely to retry an uncertain model operation;
review persisted lead/provider evidence first. Database restore requires a reviewed
recovery plan preserving post-restore-point usage; it is not routine rollback.

## Owner decisions required before activation

- Explicitly authorize creation of the named pre-release snapshot on the
  production branch. No snapshot has been created.
- Provide/approve redacted authenticated period evidence from genuine paid
  memberships on both current plans, or keep renewal disabled if Whop does not
  provide both boundaries.
- Approve the exact release commit, production target, current restore point,
  migration history/checksum, and schema-first/app-disabled sequence.
- Complete authenticated desktop/mobile verification after the disabled-mode
  app deployment.
- Separately approve controlled renewal activation and any future-account policy
  and UTC cutover. No existing account is in scope for enrollment.
- For the separate auth issue, establish a verified administrator identity and
  approve its replacement before changing the hard-coded fallback. PR #18 leaves
  that existing path unchanged.
