# PR #18 production release approval packet

**Status: proposed only.** No snapshot, production migration, deployment,
enrollment, or activation has been performed. PR #18 remains draft and monthly
renewal remains disabled.

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

Neon reports 21,600 seconds (6 hours) of project history retention. The
production branch has no automatic snapshot schedule, and the snapshot-list API
returned no snapshot objects. The existing October 25 manual recovery point is
represented by branch `br-ancient-rice-at9d6eqj`, created from production at
`2026-10-25T13:01:04Z` (parent LSN `0/6380AD8`). It is not a fresh pre-release
restore point and does not cover later production writes.

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

## Snapshot and restoration procedure

Snapshot creation is **not authorized yet**. After explicit authorization:

1. Create a named snapshot from production branch `br-calm-meadow-atgqqrhf` at
   the current pre-migration point, for example
   `pr18-pre-migration-20261027`.
2. Verify its snapshot ID, source branch, creation point, and availability by
   listing snapshots. Record these with the migration/release record.
3. Before any recovery, freeze renewal allocation using a separately approved
   application/environment action. Restore the snapshot to a new candidate
   branch with finalization disabled. Validate schema, data, lifetime counters,
   and any allowance ledger there; reconcile writes made after the snapshot.
4. Do not restore over or rename the production branch without a separate
   explicit recovery approval. A snapshot restore can discard all later writes.

For this additive migration while enrollment is empty, the first rollback choice
is to roll back the application while leaving the empty additive tables in
place. Do not restore the database merely to remove the schema. After any
enrollment, never roll back to pre-ledger application code; use the ledger-aware
freeze procedure and preserve all usage/receipt records.

## Approval sequence

1. **Snapshot only:** authorize creation of the named pre-release snapshot on
   the production branch. This authorization does not approve migration,
   deployment, or activation.
2. **Schema:** after the snapshot is verified, approve applying only the exact
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
