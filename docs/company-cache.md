# Shared company intelligence cache

Company records are private to one tenant. Domain is the preferred identity; a name-only match is used only when exactly one compatible company exists. Conflicting nonempty facts are retained and logged, never silently replaced. Existing Prospects gain a nullable company link lazily when they are researched, so no production backfill is required.

Only explicit stored company industry, company-size range, name, and domain enter shared company analysis. Personal title, location, lead notes, objections, and ProspectEvidence stay with the Prospect. CompanyEvidence stores the explicit industry/size facts once per Company; Scout reads those rows alongside the person's evidence.

The cache key is the tenant-owned Company plus deterministic hashes of shared company facts and ICP criteria. Material changes require a new company analysis. A normal prospect `forceRefresh` reuses valid company intelligence; the internal `refreshCompany` option forces a new shared analysis. A database RESEARCHING lease prevents concurrent requests from starting duplicate company calls. A waiter times out after five seconds and can retry without triggering an extra shared call.

When the shared assessment is grounded and a known title exactly matches the ICP title, Scout can compose a Prospect result without another model call. Person-specific context takes a delta call with compact company facts and only that person's evidence. If shared company facts are insufficient, the original full Prospect analysis remains available. Prospect-attached user evidence is never promoted into the shared cache automatically; that may leave some repeated company context until an explicit company-level evidence input exists.
