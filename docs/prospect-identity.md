# Phase 1A: persistent Prospect identity

GeneratedLead remains campaign/execution data; InboundSignal remains inbound-event data.
Both retain all previous fields and gain nullable Prospect relationships. Outbound activity
continues to reach identity through OutboundLog -> GeneratedLead -> Prospect.

## Schema and migration

`prisma/migrations/20260927090000_add_prospect_identity/migration.sql` was generated
by Prisma diff between local schemas, without database access. It creates Prospect,
adds nullable links and indexes, and adds tenant-scoped email/LinkedIn unique constraints.
Composite foreign keys enforce that linked records share a Prospect's userId.
Prospect requires an existing User. User and Prospect deletion is restricted while related
Prospect data exists; no identity data is cascaded away. No tables/columns are removed.

Deploy this migration through the normal reviewed deployment process before running the
new application code. This coding task does not apply it. Do not run `npm run build`
for validation: that script includes `prisma migrate deploy`.

## Identity policy

`src/lib/prospects/normalization.ts` provides shared deterministic normalization:

- Email: trim/lowercase, basic address validation; preserve dots and +aliases.
- LinkedIn: HTTP(S) www/non-www personal `/in/` URLs become `https://linkedin.com/in/...`;
  drop query, fragment and trailing slash. Preserve path case. Reject company pages,
  credentials, ports, unsupported hosts and generated missing-url placeholders.
- Names/company: NFC, lowercase, trim, collapse whitespace, normalize curly apostrophes
  and typographic hyphens. Preserve initials, accents, punctuation and legal suffixes.
- Website: lowercase hostname, strip www and terminal dot; ignore scheme/path/query.
  Preserve other subdomains; no public-suffix guessing.
- Fallback: versioned SHA-256 of JSON `[full name, domain/company discriminator, value]`.
  Require first and last names plus domain or company; reject known placeholders.
  Domains take precedence over company names. Fallback keys are intentionally non-unique.

`resolveOrCreateProspect(db, input)` requires a server-resolved User id. It returns
`created`, `resolved`, `insufficient_identity`, or `conflict`. It checks tenant-scoped
email, then LinkedIn, then fallback. Cross-identifier disagreements or mismatches with
an existing strong identifier return a conflict before enrichment. Multiple fallback
candidates are ambiguous. One incompatible fallback candidate with a different strong
identifier allows a separate Prospect; it never overwrites the original.

Only missing fields are enriched. Strong identifiers are never silently replaced.
Missing website data becoming available may produce a different fallback key and a
temporary duplicate if there is no matching strong identifier. This is intentional:
there is no fuzzy matching or automatic merge.

All production callers wrap resolution and event writes in serializable transactions.
P2002/P2034 retries restart the entire transaction (four attempts maximum). Tenant-scoped
uniqueness protects strong identifiers; serializable predicate reads protect fallback
creation from concurrent read-then-create races. Unexpected errors propagate.

Conflicts preserve both identities. New events/leads are saved with null prospectId and
emit a structured warning containing user/candidate ids and reason, without raw PII.
Regeneration cannot move an already-linked lead to a different identity: it fails and
rolls back. No conflict UI or automatic conflict reconciliation is included.

Inbound linked leads take priority after checking ownership. Existing Prospect links
are reused without duplicate resolution; legacy unlinked leads are resolved and attached.
Unlinked inbound events use explicit identity hints/email, never parse free-form context
as a company. Reply ingestion only links lead ids owned by the API-key user; unknown or
external ids remain event labels. Synthetic VSL analytics companion rows stay unlinked.
The application retains its existing cookie/API-key user-resolution patterns. Generation
now rejects a missing User instead of storing an email address as a userId.

## Backfill (not automatically executed)

After reviewing the target database and deploying the migration, explicitly set
`DATABASE_URL` in the shell. The runner does not load `.env` files or print credentials.
Optionally set `PROSPECT_BACKFILL_USER_ID` to an actual User.id for a tenant-scoped run.

```powershell
npm run backfill:prospects -- --apply
```

Without `--apply`, the script refuses to write. There is no implicit dry-run mode.
It keyset-pages 100 leads at a time, checks owners against User ids, resolves each lead
inside a retryable transaction, attaches its null Prospect link, and attaches related
same-tenant inbound signals. A second pass handles remaining unlinked inbound signals
through owned leads or email. It never overwrites non-null links, guesses legacy owners,
or merges ambiguous records. Insufficient identities remain visible in their original
tables. Ownership and identity conflicts are logged; batch/final JSON counts report
scanned, attached, created, resolved, conflicts, insufficient and invalid-owner totals.
An unexpected DB error stops the run with a nonzero exit code; committed batches remain
safe to rerun. Repeated runs reuse identities and only fill null relationships.

## Safe validation

```text
npx prisma format
npx prisma validate
npx prisma generate
npx tsc --noEmit --incremental false
npm run test:prospects
npm run lint
```

The test runner uses the installed TypeScript compiler and Node test module; it neither
downloads tools nor accesses a database. Tests cover A-H, invalid/insufficient identity,
safe enrichment, ambiguous fallback, tenant checks, legacy lead attachment, regeneration
protection and retry/error behavior. Real PostgreSQL concurrency and migration deployment
must be verified separately against an explicitly designated development database.
The existing lint command requires interactive ESLint configuration and is not currently
a functional unattended check; no lint configuration is changed in this phase.

No Scout, Prospect Memory, Brain, UI redesign or Phase 1B work is included.
