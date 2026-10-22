# Whop Sandbox Core purchase → SaaS access: source-only acceptance contract

**2026-10-23 | Review-only | Not deployed, not wired into SaaS auth, not proof of payment or access**

## Purpose

A genuine Whop Sandbox Core purchase must produce a durable, verified Whop payment and a separately valid Core membership **for the same authenticated Whop user**. Product names and browser checkout success are not proof of subscription ownership. The existing SaaS production OAuth membership flow and name-fallback tier resolver have deliberately **not** been changed.

The independent Brand Brain source-only checkout pipeline is reviewed in [Brand Brain PR #12](https://github.com/Frameleads/Brand-Brain/pull/12). It verifies a signed payment, authenticated payment readback, primary durable purchase receipt and separately linked direct checkout attempt before any SaaS access test.

## Added review-only evidence gate

`src/lib/whop-sandbox-core-access-review.ts` exports `reviewSandboxCoreMembershipEvidence`, a pure, default-off helper with **no network calls or side effects**.

Inputs MUST be independently sourced from:
1. The already authenticated Whop OAuth **user ID**, not user-submitted email or a redirect.
2. The **durable** direct-purchase payment receipt showing `PROCESSED` and `LINKED` for the Sandbox Core attempt.
3. A new authenticated Whop Membership API readback for the exact `mem_...` ID.

The helper rejects unless Sandbox preview configuration, company `biz_6YudF3G7nc8Wdw`, product `prod_2RDEl6d8jhM9W`, Core plan `plan_kgrX8LpuAH2Ba`, `ch_...` session, membership ID, **authenticated `user.id`**, active paid membership status, USD currency, and inherited no-affiliate direct-attempt metadata all match. A differing Whop user ID, a product name containing `Core` or `Enterprise`, canceled/past-due/trialing membership, or missing database linkage requires review.

The helper is intentionally **not** imported by `src/lib/whop-memberships.ts`, `src/lib/whop-subscription.ts`, the OAuth callback, or the production Whop webhook route. `EVIDENCE_MATCHED` is a test readiness verdict, **not** subscription activation or an authorization token.

The default-off `FRAMELEADS_SANDBOX_CORE_MEMBERSHIP_REVIEW_ENABLED` is not meant to be set until the separate protected Sandbox preview is authorized; even setting it cannot alter access because the helper is unused by the runtime.

## Verified regression checks

[GitHub Actions CI 39849443163](https://github.com/Frameleads/FrameLeads/actions/runs/39849443163): **8/8 entitlement tests**, OAuth callback test and TypeScript pass; all provider/receipt values are fixture data.

## Real E2E release gates

- Clear the separately refused database migration through authorized review; install the correct **isolated Sandbox** Whop purchase-event and direct-attempt ledger only through an approved procedure. Never repurpose production database or fake Audit continuations.
- Obtain valid Vercel team-scoped access and verify exact isolated Landing/Brand Brain/SaaS preview deployments.
- Confirm pinned Whop Sandbox webhook payload and actual `payment.succeeded` delivery. Match authenticated GET Payment's `checkout_configuration_id` and one committed primary receipt to exactly one linked direct attempt.
- Retrieve the actual membership with provider credentials and check its owner `user.id` matches the test buyer's authenticated Whop OAuth user ID; verify actual SaaS session/tier, a returning login and no production entitlement pollution.
- Do not enable production checkout flags, merge draft PRs, change production pricing, credit affiliates, or claim buyer access until independently verified and approved.

Whop Membership API reference: https://docs.whop.com/api-reference/memberships/membership
