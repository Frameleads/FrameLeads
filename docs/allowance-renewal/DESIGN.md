# Prospect allowance renewal: audit and proposed correction

Status: **implemented on draft PR #18, disabled and unmerged pending evidence/release gates**.
Based on released PR #17 / production commit `4ae766517ddb6a376749ae691a292f163418b98c`.
The original design and audit below remain the basis. See [RELEASE.md](RELEASE.md)
for the implemented adapter, local PostgreSQL validation, migration review, and
remaining activation gates. No production migration, enrollment, or activation
has been performed. The completed Enterprise cap release is left intact.

Owner evidence update (2026-10-27): the current Core/Enterprise monthly pricing
and free-trial OFF configuration is confirmed. This does not establish member
identities, statuses or renewal periods. See
[BILLING-EVIDENCE.md](BILLING-EVIDENCE.md); no implementation or test is changed.

## Confirmed behavior

| Layer | Evidence | Result |
| --- | --- | --- |
| Canonical entitlement | `src/lib/entitlements.ts:54` | Core 500; Enterprise 10,000; Micro-Pilot 25. |
| Account storage | `prisma/schema.prisma`, `User` | `leadsProcessed` and `monthlyQuota`, no period identity/start/end or period usage. |
| Enterprise consumption | `src/lib/enterprise-quota.ts` | Locked tenant row, limit minus cumulative `leadsProcessed`; never renews. |
| Core consumption | `src/app/api/generate/route.ts` | Reads counter, slices candidates, increments later; never renews. Existing Core concurrency gap must be closed when wiring the shared period allocator. |
| Whop membership verification | `src/lib/whop-memberships.ts` | Reads `renewal_period_end`/expiry for access/cache lifetime, discards start and membership identity from entitlement result. |
| Entitlement refresh | `src/lib/whop-entitlement-refresh.ts` | At boundary, rechecks access. Persists tier/quota only when changed. Same-tier renewal does not change usage. |
| Login/admin sync | `src/lib/whop-user.ts`, OAuth callback, admin sync | Existing accounts keep usage; only new accounts start at zero. Logging in is not renewal. |
| Signed Whop events | `src/lib/whop-webhook-processing.ts` | Deduplicates delivery, invalidates process-local cache; no period state or usage renewal. Even successful payment does not replenish quota. |
| Vercel schedule | released `vercel.json`, `/api/cron/digest` | Weekly digest at Friday 14:00 UTC (18:00 Dubai); no quota mutation. |
| Neon production SQL | read-only catalog query | Only `plpgsql` extension; no User triggers, public functions referencing quota/counter, or allowance-period columns. No pg_cron. |
| Neon hosted functions | `list_functions`, production branch | Empty list. |
| Whop event receipts | production `WhopWebhookReceipt` | Empty; no persisted successful delivery evidence. Does not prove Whop has not billed. |
| GitHub | current main tree | No `.github` workflows. Workflow-list API read was not available through connector. |

**Conclusion:** In the inspected SaaS and database, Core and Enterprise usage
behaves cumulatively and does not replenish at subscription boundaries. The
entitlement cache's expiry protects access but does not renew allowances.
No reliable external renewal mechanism was found. This is a confirmed application
implementation gap, not proof that every possible external system is absent.

Inspection limits:

- Neon hosted trigger listing returned `404 branch not found`, although SQL,
  branch lookup and hosted-function listing succeed for that exact production
  branch. Do not treat that error as an empty schedule inventory.
- No authorized Whop account-reading tool or runtime Whop credential is exposed.
  Live subscription statuses, actual billing intervals, period anchors and
  configured webhook destinations/delivery history remain unverified. Do not
  decrypt deployed secrets, call admin sync, or make purchases to compensate.
- Vercel's connected project response omits a separate live cron inventory; the
  inspected deployed commit contains the weekly digest only. Unattached external
  schedulers cannot be exhaustively excluded.
- Firecrawl official-doc retrieval returned HTTP 402. Use installed
  `@whop/sdk` **2.6.0** as version-specific contract evidence, not as proof of the
  live account's payloads: `MembershipListItem`/`MembershipLegacy` expose nullable
  `renewal_period_start` and `renewal_period_end`; the SDK has multiple membership
  representations. Confirm the exact live endpoint response before implementation.

## Proposed minimal correction

Keep lifetime `User.leadsProcessed` monotonically increasing. Introduce an
append-only period ledger and one tenant cursor. Do not zero or rewrite historical
usage. Existing imported prospects, generated leads, Whop purchases, plans,
prices, billing settings and Micro-Pilot counters remain untouched.

Additive data structures from the initial design (now implemented in the draft migration):

1. `ProspectAllowancePeriod`: id, userId FK, membershipId, companyId,
   periodStart UTC, periodEnd UTC, usage, legacySeed, verifiedAt, closedAt.
   Unique `(userId, periodStart)`; check start < end and nonnegative usage.
   Store the source plan ID and applicable tier/cap as audit metadata; enforce
   against the canonical current tier function rather than a stale cached cap.
2. `ProspectAllowanceCursor`: userId PK/FK, currentPeriodId. Exactly one active
   tenant period; all rollover/allocation transactions lock the existing User
   row first, then cursor and period in a consistent order. A composite FK
   `(userId, currentPeriodId)` must prevent cross-tenant cursor references.
3. `ProspectAllowanceOperation`: unique `(userId, operationId)`, canonical payload
   hash, periodId, allocatedCount, state, createdAt. Composite tenant FK to period.
   This deduplicates retries across period boundaries. Closed periods and receipts
   are retained; no cascading deletion in the migration.

This is more auditable than resetting the existing counter and requires no new
cron: lazy, verified rollover on the first authenticated usage read/allocation
makes the logical allowance available exactly at its boundary. A UI that remains
open across the boundary should revalidate the same snapshot at expiry/on focus;
consuming APIs always verify independently. Optional webhook rechecks improve
freshness but are not required for correctness. Do not add an external reset job.

### Authoritative period and access rules

- Only a successful current Whop membership read, scoped to the authenticated
  buyer, expected company and correct live/sandbox origin, can propose a period.
  Preserve existing access checks. A payment event is a hint to refresh, not proof
  of a particular allowance period or new entitlement.
- Select one deterministic membership for the resolved tier and return its ID,
  start and end together. The existing highest-tier resolver and earliest end
  across *all* memberships are insufficient to assign a period. Do not combine
  one membership's tier with another membership's boundary.
- Use provider UTC instants and half-open `[start, end)` windows, with database
  transaction time for final validity. No calendar-month, account-createdAt,
  event-receivedAt, server timezone, or fixed 30-day inference.
- A confirmed monthly subscription uses its provider subscription boundaries.
  Do **not** assume every Core/Enterprise plan is monthly: inspect existing
  interval metadata first. Annual/quarterly/custom billing with a monthly
  allowance needs a reviewed monthly anniversary policy and authoritative anchor;
  it must not accidentally receive only one monthly quota per annual invoice.
  Such plans remain in legacy mode pending policy review, never silently reset.
- If periods are missing, malformed, expired, overlap, regress, or have an
  unconfirmed cadence, do not award a new allowance. Preserve counters and show
  a retryable renewal-verification state. Do not extend cached access across end.
  Trials must be explicitly mapped after observing actual provider transition
  data; no synthetic paid period. Canceled/past-due/invalid memberships receive
  no new consumption; cancel-at-end retains only existing-period access.
- Midperiod Core/Enterprise changes carry current consumption; only the cap
  changes (500/10,000). Never mint a bucket because the tier or plan changed.
  Membership replacement, overlapping equal-tier memberships, period corrections
  or a new purchase after cancellation require a reviewed mapping/transfer rule.
  The offline model deliberately blocks these ambiguities rather than granting
  a second bucket. No automatic grandfathering or allowance stacking.

### Atomic allocation and rollover

Future adapter transaction, `ReadCommitted` with tenant `SELECT ... FOR UPDATE`:

1. Authenticate/verify Whop before entering the short DB transaction; reject
   oversized/untrusted operation data and build the canonical payload hash.
2. Lock tenant User row. Recheck provider snapshot expiry against DB time and
   principal/company mapping. Look up operation receipt by tenant + operation ID.
   A matching retry returns its original allocation/result, including a prior
   period's operation; different payload with same key returns 409.
3. Lock/read cursor and current period. If absent, require a separately reviewed
   cutover seed (below). Same exact period reuses the row. A newer verified period
   with start >= locked current end closes the old row, inserts or reuses the
   unique new row and atomically advances the cursor. Never rewind the cursor.
   Skipped idle periods do not accumulate credit; only current period is opened.
4. Compute `allocated = min(requested, max(0, canonicalCap - currentPeriod.usage))`.
   Increment period usage and lifetime `leadsProcessed`, and insert the immutable
   operation allocation receipt, in this **same transaction**. Commit before
   model/provider calls. Concurrent reads/rollovers cannot give two allowances.
5. Provider retries reuse the allocation receipt; resumed operations persist and
   reuse per-prospect results. Never automatically rerun completed external work.
   Explicit regeneration is a new operation and remains chargeable under current
   semantics. Failed/uncertain generation attempts retain their existing charge;
   do not add refund behavior in this correction. Zero allocations are also
   receipted to give retries stable results.
6. On serialization/deadlock/unique contention, bounded transaction retries
   reread cursor/receipt. Never perform model calls inside a retried transaction.
   If a DB write fails, roll back allocation and perform no provider work.

Generation started before a boundary remains charged to its reservation's period
regardless of completion time. Both Core and Enterprise must use this one path,
including regeneration. Remove Core's later aggregate increment once the shared
allocator owns it. Preserve Micro-Pilot's independent one-time identity claims.
List copies, metadata updates, inbound reply processing and Scout handoff retain
their existing non-generation accounting; do not broaden what counts as usage.

### UI and cache integration

One authenticated backend snapshot should return tier, canonical limit,
current-period used, `max(0, limit-used)` remaining, period start/end and renewal
verification state. Both Ingestion and Sandbox read it. Preserve lifetime usage
in audit/admin history; do not present it as current-period usage after cutover.
Never clamp the actual used value down to the limit. At 15,000 historical current
period usage, display 15,000 used and zero remaining until verified rollover.
The frontend must not derive its own date window or restore a client-supplied
usage value. Provider outages must never cause a new bucket; short cached snapshots
can be used only while within their verified period and existing access rules.

### Existing-account cutover and impact review

Current observed production: Core 2 accounts, usage 0; Enterprise 6 accounts,
usage total 289, individual range 0–162; Micro-Pilot 7 accounts, usage total 52.
These are observations, not hardcoded migration inputs.

The cumulative counter has no historical period attribution. GeneratedLead
creation timestamps cannot reconstruct attempts reliably: regeneration updates
timestamps and failures may be charged. Do not infer a historical monthly reset.

Conservative initial seed: snapshot the full existing cumulative counter into the
verified current period as `legacySeed`/usage, atomically under the same lock.
This may overcount prior-month activity until the next verified boundary; impact
must be reviewed per affected tenant before activation. Prefer approved,
provider/audit-backed current-period attribution if available; retain the original
lifetime total and record the exact attribution decision. **Do not run a bulk
reset or automatically forgive 15,000 over-limit usage.** New accounts with zero
lifetime usage can seed zero after verified paid-period resolution. Accounts
without verifiable provider membership remain in legacy mode; admin overrides or
internal test records do not invent subscription periods.

## Verification, rollout and rollback gates

The offline `reference-policy.cjs` is deliberately not imported by the app. It
models state transitions only; it is not a provider adapter or a SQL implementation.
Run `node tests/allowance-renewal-design.test.mjs` for 15 focused checks, including
two characterizations of the actual cache behavior and 13 proposed-policy checks.
The serialization fixture tests the specified lock contract, **not live Postgres**.
Existing entitlement (15), membership/freshness (12), entitlement route (12), and
Micro-Pilot (8) regression checks also pass: **62 checks total**. No runtime or
schema changes were made, so production build/type validation was not repeated
for this documentation/offline-model PR. An initial worktree regression attempt
needed the existing installed Next dependencies; rerunning with that dependency
path passed without code changes.

Before activation:

1. Review actual read-only Whop metadata (membership ID, subject/company, status,
   plan interval and start/end) for existing recurring accounts; inspect webhook
   destination and delivery history without changing billing. Close scheduler
   inventory gaps or document their owners. No credentials in PRs/logs.
2. Review this period/cutover policy and affected-account impact. In particular,
   resolve nonmonthly billing and multiple/replaced memberships before enabling
   those accounts. Approve concrete migration and activation separately.
3. Implement the additive migration and shared adapter in a follow-up reviewed
   change. Test on disposable local Postgres/isolated nonproduction schema with
   fixtures: real concurrent final-slot allocation, concurrent rollover, duplicate
   keys, transaction rollback, deadlock retry, crash-before/after-provider,
   stale/out-of-order events, and tenant isolation. Do not use production usage.
4. Add adapter tests for correct selected membership, unrecognized/missing periods,
   month-end/leap-year provider timestamps, paid/trial/cancel/refund transitions,
   upgrades/downgrades, outage at boundary, and UI revalidation at expiry. Test
   both quotas and Micro-Pilot lifetime invariants. Run existing regressions,
   TypeScript, migration validation and production build.
5. Produce a non-mutating account impact report and recovery/restore point.
   Deploy dormant support only after migration review; then explicitly activate
   reviewed recurring accounts with atomic seed. No activation without satisfying the release gates.
6. Verify authenticated UI + backend snapshot and a fixture-driven renewal in
   nonproduction. In production use read-only observation at a real boundary.

Rollback must not revert to lifetime-counter enforcement after active ledger
usage: that would lock out customers based on historical totals. Disable **new
rollovers** while retaining period-based usage reads/allocation, freeze ambiguous
accounts for review, retain all period/operation history, and never drop ledger
rows. Prepare and test that rollback mode before enabling renewal. The cap from
PR #17 remains 10,000 through all stages.

## Safe production UI verification

Completed without any credential/cookie injection:

- `/login`: HTTP 200 with the normal Whop sign-in control.
- `/dashboard/ingestion` and `/dashboard/sandbox`: resolve to login without a
  session; protected `/api/scout/icp` and `/api/decisions` return 401.
- Production database: all six Enterprise accounts remain at 10,000 and total
  historical usage 289. Core/Micro-Pilot quotas remain unchanged.
- Available new-deployment error/fatal logs in the latest 10-minute window: no
  entries. Longer log queries exceeded retention. This is limited observation,
  not proof that all live integrations have been exercised.
- Shell HTTP requests are blocked by the environment proxy (403); used authorized
  read-only Vercel fetch tools instead. No live consuming request was executed.

Smallest owner-assisted step: sign in normally at `https://app.frameleads.io/login`
with one existing Enterprise testing account, open Ingestion and Sandbox, and
confirm each shows the **same actual used count**, **10,000 limit**, and
`max(0, 10000-used)` remaining. Capture the quota header at desktop and narrow
mobile width, hiding personal data. No generation or prospect import is required.
If a browser-sharing facility becomes available, leave that authenticated browser
open for read-only inspection; there is no browser-control tool in this session.
Never paste a password, OAuth token, cookie, or full HAR into chat.

The production aggregate cannot identify which owner's account will be used;
compare that signed-in account's own displayed usage, not the aggregate 289.
Read-only DB access does not establish a Whop-authenticated browser identity.
