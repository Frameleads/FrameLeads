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

**Owner evidence update, 2026-10-27:** the real FrameLeads Whop dashboard shows
Enterprise recurring at USD 499 every 1 month and Core recurring at USD 149 every
1 month; both current options have free trial OFF. This closes current pricing
configuration uncertainty. See [BILLING-EVIDENCE.md](BILLING-EVIDENCE.md) for
provenance and limits, and [ACTIVATION-REVIEW.json](ACTIVATION-REVIEW.json) for the
pinned, blocked review packet. No plan/business API IDs or member periods were
supplied. Do not infer a numeric 30-day API interval from the screenshots.

Membership-specific verification remains an **unsatisfied release gate**. Tool discovery found no connected
Whop account-reading tool. The cloud runtime has only DATABASE_URL, with no Whop
credential or buyer session. Vercel **metadata only** confirms OAuth credentials
and webhook secret exist; no production Whop API read key is configured there.
No secret was decrypted or extracted. The collector exits before any database or
network access when the dedicated read-only credential is unavailable.

Required access: bind a least-privilege Whop membership/plan read credential as
`WHOP_AUDIT_TOKEN`, expected company as `WHOP_AUDIT_COMPANY_ID`, and permit the
live Whop API in the execution environment. Alternatively provide a private,
sanitized provider export retaining subject/membership/plan IDs, status, billing
interval, renewal start/end and company mapping; no passwords/cookies are needed.
A fixture is not evidence of a real subscription.

Read-only production SQL reconfirmed:

| Tier | Accounts | Quota | Lifetime usage | Individual range |
| --- | ---: | ---: | ---: | ---: |
| Core | 2 | 500 | 0 | 0–0 |
| Enterprise | 6 | 10,000 | 289 | 0–162 |
| Micro-Pilot | 7 | 25 total | 52 | 0–25 |

There are no over-cap recurring accounts in this snapshot. Attribution of the
289 Enterprise attempts to real periods is unknown. A conservative seed would
retain all of it until the next verified boundary; that impact needs explicit
review. Internal/admin accounts without real membership periods must not receive
fabricated anchors. Nonmonthly plans require a separate approved monthly anchor
policy; they are not silently enabled.

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
