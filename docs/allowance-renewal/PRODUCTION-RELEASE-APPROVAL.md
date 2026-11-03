# PR #18 production release approval packet

**Status: blocked on a fresh recovery point.** Snapshot creation was authorized
only if the existing plan allowed it without upgrade or unexpected charges.
That condition is not met, so no new snapshot was created. No production
migration, deployment, enrollment, or activation has been performed. PR #18
remains draft and monthly renewal remains disabled.

## No-cost recovery alternatives reviewed — 2026-10-27

Neither candidate is currently a verified fresh, restorable recovery point.
No database dump, storage upload, branch creation, or restore was performed.

### External PostgreSQL custom-format dump

Neon reports PostgreSQL 18. Its official backup guide recommends matching
client version, a direct (unpooled) connection, `pg_dump -Fc`, and a restore
with `pg_restore` into a separate destination. The current task runtime has
neither PostgreSQL client binary. Its DNS lookup for the production endpoint
failed (`Temporary failure in name resolution`), so secure authenticated
database connectivity from this environment was not established. No
connection string or credential was requested or printed.

The production branch role inventory exposes only `neondb_owner`; no dedicated
read-only role is present. The permissions required for a complete dump
therefore have not been verified using an appropriate non-owner production
credential. The application database reports 36,593,664 logical bytes in Neon
metadata, but that is not a measured compressed dump size or a storage quota.

An owner-only Drive folder named `FrameLeads-Private-Backups` exists. Metadata
shows it is not shared and identifies the owner; this proves folder access
visibility only. No approved encryption key, client-side encryption policy,
Drive quota/headroom, incremental cost, retention/restore policy, or isolated
restore database was evidenced. GPG is installed in this task runtime, but
there is no verified owner-controlled recipient key. Consequently Drive is
not yet an approved encrypted destination and no production data may be
uploaded there. No database contents or credentials were downloaded here.

**Candidate procedure for separate owner approval:** on an owner-controlled,
trusted machine with PostgreSQL 18 `pg_dump`/`pg_restore` and verified direct
TLS connectivity, use a least-privilege role with SELECT on all required
tables/sequences and schema metadata. Stream a custom-format dump directly
through client-side authenticated encryption to the approved private storage
destination (do not leave the plaintext archive on disk). Keep the encryption
key separate from the archive. Record the archive SHA-256 and byte size, verify
the checksum after upload/download, run `pg_restore --list`, and restore to an
isolated nonproduction PostgreSQL 18 database. Compare schemas, row counts,
sequences, constraints, indexes, and application smoke checks. A dump without
this isolated restore is untested, not verified.

A dump is a point-in-time logical snapshot; production writes can occur while
it is made. For recovery, restore only to a separate candidate database,
capture and reconcile every write after the dump's start point from the
live production database (including webhook receipts, account/usage data,
and background work), and stop new writers only as part of a separately
approved cutover procedure. Do not replace production from the dump without
separate recovery authorization and a verified write-reconciliation plan.

### Neon no-compute branch

The read-only Neon inventory currently reports 10 branches against the Free
plan limit of 10. This includes production, one recovery branch, and eight
archived branches. Official Neon documentation says archived branches count
toward the limit and archived storage still has a cost; Free does not offer
paid-plan extra-branch overage. The only available branch slot would require
deleting an existing branch, which is prohibited. No branch was created or
deleted. A no-compute branch is therefore not available without changing the
plan or existing branch set.

### Approval gate and smallest next action

No-cost recovery remains blocked. The smallest owner action is to designate an
existing owner-controlled machine and storage destination for this one-time
export, and verify/approve its client-side encryption key, free available
capacity, retention, and isolated PostgreSQL 18 restore target. The operator
must first establish DNS/TLS access and an appropriately scoped read-only
database role; if that role is absent, the owner must provision it through the
approved DBA process. Then a dump/restore can be executed and evidenced under
separate approval. Preserve the existing snapshot and all branches. Until an
archive has passed checksum and nonproduction restore validation, it is not a
recovery point and the schema release remains blocked.

## Exact reviewed target

- Neon project: `delicate-glitter-86466488` (FrameLeads)
- Production branch: `br-calm-meadow-atgqqrhf` (`production`, primary/default)
- Production database: `neondb`
- PR branch: `codex/allowance-renewal-audit-20261027`
- Reviewed PR/application-source revision before this packet update:
  `44b873a7dacb1271dcd5fa9215c3c4079d4e935b` (draft PR; exact production
  deployment SHA must be pinned again after final owner review)
- Implementation baseline: `547266a82b862011503f441e657f01dd06abcf8f`
- Migration: `20261027130000_prospect_allowance_periods`
- Migration SHA-256: `55e9dc1e76c33e8d5208db9cff9a8060a8c467915c63e0da4489a690cf9f5b9b`

## Read-only production verification

On 2026-10-27, Neon reported 29 completed migration rows, 3 rolled-back
attempts, 0 unresolved attempts, and no row for the PR #18 migration. The
database identity returned by the same query was `neondb` on the specified
production branch.

The project is on Neon Free (`free_v3`). Neon documentation says Free includes
one manual snapshot and snapshot storage is billed at **$0.09/GB-month**. One
manual snapshot already exists and occupies that allowance:

- Snapshot: `snap-soft-queen-atszi746`
- Name: `pre-micro-pilot-whop-release-2026-10-25`
- Source branch: `br-calm-meadow-atgqqrhf`
- Created: `2026-10-25T11:19:55Z`
- Expires: `2026-11-08T00:00:00Z`
- Provider-reported full size: 36,347,904 bytes
- Provider marks it manual: `true`

The authoritative snapshot list now returns this one object. Creating another
while preserving it exceeds the Free manual-snapshot limit; any stored snapshot
also incurs the documented storage charge. This fails the no-upgrade/no-
unexpected-charge condition. Do not delete, modify, or extend the existing
snapshot. Neon reports 21,600 seconds (6 hours) of project history retention
and no automatic snapshot schedule. A separate historical recovery branch
`br-ancient-rice-at9d6eqj` exists at parent timestamp `2026-10-25T13:01:04Z`
(LSN `0/6380AD8`); it is not a fresh pre-release point.

Neon documentation references: [plans and snapshot limits](https://neon.com/docs/introduction/plans), [backup and restore pricing](https://neon.com/docs/guides/backup-restore), [snapshot storage FAQ](https://neon.com/faqs/managed-postgres-platforms-test-migration-snapshots).

Read-only Vercel environment metadata contained no `PROSPECT_ALLOWANCE_*`
variables. The application defaults `PROSPECT_ALLOWANCE_MODE` to `disabled`;
future enrollment cutover and plan-review settings remain absent.

## Compatibility and ordering

The migration creates only three new allowance tables, indexes, foreign keys,
and SQL checks. It does not alter existing tables or usage. The disposable
PostgreSQL 17.11 test already passed 21/21 after applying this exact SQL to the
released schema baseline. Do not rerun production migration history with
`prisma migrate resolve` or use `db push` in production.

**Schema must precede application deployment.** The application client includes
the new models and code can look up enrollment state. Deploy only with renewal
mode disabled, no cursor rows, no manifest, and no future-account settings.
Keep all eight historical accounts excluded and their usage unchanged. Preserve
Micro-Pilot’s existing one-time allowance.

## Recovery procedure when an approved recovery point is available

No fresh pre-release point can be created under the current plan without
exceeding the one-manual-snapshot limit or incurring snapshot storage charges.
Do not alter the existing snapshot or the Neon plan. If the owner later provides
an approved no-cost recovery path, record and verify its ID, branch, creation
point, and availability before any schema release.

For recovery, restore to a new candidate branch with finalization disabled.
Validate schema, data, lifetime counters, and any allowance ledger there;
reconcile writes made after the recovery point. Do not restore over or rename
the production branch without separate explicit recovery approval. A restore
can discard later writes.

For this additive migration while enrollment is empty, the first rollback choice
is to roll back the application while leaving the empty additive tables in
place. Do not restore the database merely to remove the schema. After any
enrollment, never roll back to pre-ledger application code; use the ledger-aware
freeze procedure and preserve all usage/receipt records.

## Approval sequence

1. **Recovery point:** blocked until a fresh pre-release recovery point can be
   made available without deleting/modifying the existing snapshot, changing
   the plan, or incurring unapproved storage charges. Snapshot-only authorization
   was given, but the preconditions were not met and no snapshot was created.
2. **Schema:** after a suitable recovery point is available and verified,
   approve applying only the exact
   migration above to `neondb` on `br-calm-meadow-atgqqrhf`; reconfirm migration
   history, checksum, target, and snapshot immediately before execution.
3. **Application:** separately approve deployment of the exact reviewed PR
   commit with renewal disabled and no enrollment settings. Complete
   authenticated desktop/mobile verification before activation.
4. **Activation:** separately approve after genuine paying customers on both
   current plans provide authenticated exact Whop period start/end evidence.
   Until then, keep recurring allowance disabled. Future-customer policy and
   UTC cutover require their own explicit approval. No historical account
   enrollment is proposed.

The OAuth hard-coded login exception remains unchanged for this release and is
tracked as a separate security review. No administrator access change is part
of this approval packet.
