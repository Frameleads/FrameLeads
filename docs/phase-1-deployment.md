# Phase 1 deployment checklist (not executed)

Run this only in an approved deployment window with the intended database selected. The repository's `npm run build` runs `prisma migrate deploy`, so treat it as a migration command.

1. Confirm the target `DATABASE_URL` and deployment environment. Do not rely on an inherited or unknown URL.
2. Take a database backup or confirm a tested restore point.
3. Inspect the accumulated additive Phase 1 migrations in `prisma/migrations/` in order, including Prospect identity, intelligence, qualification, factual metadata, trust guardrails, AI usage, and Company cache. Confirm none have already been applied inconsistently.
4. Against that confirmed target only, run `npx prisma migrate deploy`.
5. Run the idempotent Prospect backfill with `npm run backfill:prospects -- --apply` against that same target. Review summary and identity-conflict logs; do not force ambiguous merges. See `docs/prospect-identity.md`.
6. Verify existing Prospects acquire tenant-owned Company links lazily when researched; no Company backfill is required.
7. Open the authenticated Scout page and confirm real tenant Prospects appear.
8. Open Scout ICP Settings and confirm the intended active profile and qualification policy.
9. Qualify a known Prospect; check matched, missing, and exclusion behavior.
10. Run one fresh qualified Scout research and inspect its persisted READY intelligence and evidence.
11. Confirm corresponding `AIUsageEvent` rows for actual provider calls and no usage row for a cache hit or rejected gate.
12. Send that READY, qualified Prospect to Sandbox.
13. Verify the Sandbox `GeneratedLead.prospectId` equals the Scout `Prospect.id`; repeat handoff and confirm the lead is reused.
14. Smoke-test the existing Sandbox view and, if needed, its explicit copy-generation action. Check the Scout summary is sourced from persisted intelligence.
15. Monitor application logs, migration status, identity conflicts, failed research, handoff errors, and AI usage recording errors.
