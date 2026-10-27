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
successful payment evidence was returned.

No membership was observed on the new $149/$499 plans. The API catalog confirms
their numeric 30-day interval but not that a genuine paying membership supplies
the exact current-period timestamps required by the allocator. Future allocation
stays fail-closed until genuine paid memberships return both boundaries.

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

- Owner disposition of the two Core accounts individually; neither is labeled a
  test account. The six Enterprise test accounts remain excluded from enrollment.
- Owner disposition of the hard-coded OAuth Enterprise login fallback and
  configured administrator bypass. Paid routes continue to fail closed on a
  canceled membership after live refresh.
- Genuine paid membership evidence for each current plan with exact period start
  and end. Do not infer from checkout promotion, account creation, canceled
  periods, or 30-day arithmetic.
- Approve the future-customer policy for only new genuine paying customers on
  the exact current plan IDs. Exclude all eight historical accounts.
- Review per-account lifetime seed impact and the private manifest. It remains
  empty; preserve all lifetime usage and Micro-Pilot entitlements.
- Approval of the exact migration and release commit, current Neon restore point,
  migration history/checksums and release target.
- Normal authenticated desktop/mobile verification after the reviewed release.
- If future-account auto-enrollment is included, separate approval of the UTC cutover and exact plan policy; otherwise leave both settings absent.

### Reconciliation validation — 2026-10-27

- Whop membership tests: 12 passed, including current/canceled lifecycle,
  recognized legacy and current plan IDs, OAuth identity checks, live-shape
  normalization, entitlement refresh, and bounded outage behavior.
- Whop OAuth tests: passed. Entitlement tests: 15 passed. Protected route tests:
  12 passed. Renewal design tests: 15 passed.
- TypeScript `npx tsc --noEmit`: passed. The optimized production build passed
  with `NODE_OPTIONS=--max-old-space-size=4096`; the default 2 GB Node heap was
  insufficient for Next.js lint/type validation in this executor.
- Disposable PostgreSQL 17 integration run: 20 of 21 checks passed. The sole
  failure was the raw CHECK-constraint test because a Prisma `db push` fixture
  does not include SQL-only CHECK constraints. The fixture and database were
  isolated to loopback and are not production. No migration file was executed;
  full SQL-constraint integration must be re-run only after a permitted local
  fixture setup. Production migration was not run.
- `prisma validate` passed. Migration review was read-only: the migration file
  and checksum are pinned in this packet; no migration SQL was applied during
  this reconciliation.

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

Read-only production migration history shows all **29 prior migrations finished**;
three earlier failed attempts were already marked rolled back and have successful
reapplications. The new migration is absent. Thus no old migrations should run
in the intended production release; verify history/checksums again immediately
before release. Empty-database history remains a pre-existing repository issue.

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

## Concrete production plan — approval required, not executed

1. Collect actual read-only Whop evidence and account impact. Review all eight
   recurring accounts individually; verify exact response fields and plan interval
   scope. Review webhook destinations/deliveries separately; no event can reset
   usage. The collector writes private identity evidence only with explicit
   `--private-manifest /tmp/...`; keep that file out of Git and public reports.
2. Resolve ambiguous/missing/nonmonthly accounts. Approve the conservative seed
   for each account or provide auditable current-period attribution. This version
   intentionally supports only the conservative full-history seed; do not edit
   production lifetime counters to implement a different attribution policy.
3. Review the additive migration and exact release commit. Confirm a current
   Neon restore point, existing migration checksums/history, and production target.
   Apply only `20261027130000_prospect_allowance_periods` through the existing
   `prisma migrate deploy` workflow after confirming the preceding 29 are applied.
   It creates empty tables/constraints only; no seed or usage UPDATE is included.
   Schema must precede the app: the new client looks up enrollment even when off.
4. Merge/deploy **only after explicit release approval and all gates pass**.
   Initially keep `PROSPECT_ALLOWANCE_MODE=disabled` and no cursor rows. Verify
   default behavior and authenticated usage on an authorized testing account.
5. From collected evidence create a private manifest with top-level
   `reviewReference` and `accounts` as emitted by the collector. Run
   `node scripts/enroll-prospect-allowances.cjs /tmp/reviewed-manifest.json`
   for a dry-run. Recollect/review if usage changed. Store the manifest SHA256 and
   exact reviewer decision in the release record.
6. Set mode `active` using the normal reviewed environment release process, then
   apply the exact reviewed manifest with `--apply` and
   `ALLOWANCE_APPROVED_MANIFEST_SHA256` equal to its printed digest. No cursor
   should be inserted while serving mode disabled. The first authenticated read
   seeds under lock from the unchanged lifetime counter. If usage moved since
   enrollment, the seed fails closed; re-review before proceeding.
7. To support future subscriptions, separately approve a UTC ISO cutover in
   `PROSPECT_ALLOWANCE_NEW_ACCOUNTS_AFTER` and a JSON array in
   `PROSPECT_ALLOWANCE_PLAN_REVIEWS` containing the exact reviewed planId,
   companyId, billingDays and reviewReference. Only new zero-usage accounts created
   at/after that instant can auto-enroll; older accounts still require the
   individual manifest. No unknown/nonmonthly plan is automatically admitted.
8. Verify the actual logged-in UI matches `/api/usage`, account tier/access and
   historical totals remain unchanged, and then observe a real verified renewal
   boundary non-destructively. Exercise forced boundaries only in nonproduction.
   Review recent logs and stalled operation receipts before expanding enrollment.

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

## Remaining owner actions

- Supply authorized read-only provider access or private period evidence. The
  current monthly pricing configuration is owner-verified, but exact membership
  identity/status/periods and API cadence representation remain unverified.
- Review per-account seed impact, concrete migration, release commit and activation
  manifest. No migration/merge/activation approval is assumed from implementation.
- Sign in normally to the Enterprise testing account and inspect Ingestion and
  Sandbox at desktop/mobile width, comparing usage headers with authenticated
  `/api/usage` after the reviewed release. No tokens, cookies, HAR or purchases.
