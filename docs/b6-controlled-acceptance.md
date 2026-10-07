# B6 controlled activation acceptance (operator only)

The customer Onboarding page has no B6 acceptance controls. The canonical lifecycle,
purchase enrollment, tenant-owned Decision/DecisionTrace, one-decision mutex and
product milestone projection remain unchanged.

Run `node --experimental-strip-types scripts/b6-controlled-activation-acceptance.ts`
only after the operator preflight passes. The CLI reads temporary environment variables:

- `B6_ACCEPTANCE_RUN=true` (exact match)
- `B6_ACCEPTANCE_CUSTOMER_EMAIL=akramwalid628@gmail.com`
- `B6_CONTROLLED_PROSPECT_EMAIL=akram@frameleads.io`
- `B6_REPLY_MESSAGE_ID` (the actual reply Message-ID, including angle brackets)
- `B6_GMAIL_APP_PASSWORD` (628 mailbox, supplied locally without terminal echo)

Existing operator credentials `OUTBOUND_DISPATCH_SECRET` and
`BRANDBRAIN_VERCEL_BYPASS` must be loaded in memory from the approved credential
store by the operator. Never put them, or the Gmail password, in chat, files,
command arguments, logs or commits. This does not rotate any credentials.

The CLI sends exactly one request to the existing Brand Brain production project.
Its guarded operator relay verifies the authentic existing B5 purchase, CUSTOMER,
PURCHASE_CONFIRMED and enrollment, checks the nudge gate is false, then calls the
product production harness with a shared server Bearer and signed Brand Brain
production OIDC identity. The product browser session cannot authorize this path.
The four acceptance values are never production environment variables. The Gmail
password is removed from the CLI environment, cleared from request objects and
never persisted. Clear all temporary variables from the launching terminal afterward.

Operator read-only preflight: authenticated GET
`https://brandbrain-pi.vercel.app/api/internal/customer-onboarding/acceptance`.
It reports actual tenant identity, configured policy revision readiness, existing
Decision count, manual analysis gate, purchase/enrollment and disabled nudge gate.
No import, Gmail read, model call or send occurs during GET. Policy must already be
configured; the harness never fabricates a policy or bypasses configuration review.

The provider read reuses the existing fixed Gmail TLS verification: read-only Inbox,
exact Message-ID and sender, bounded human reply, exact recipient, In-Reply-To,
matching provider Sent message, both sides after purchase. No message body can be
supplied by the operator. Canonical identity/import and receipt persistence are reused.

The only decision call is canonical `triageInboundSignal` with the server-owned
activation preview flag. The tenant database mutex reserves at most one normal
Decision before analysis; its immutable trace must pass existing activation checks.
No provider send, execution dispatcher, automation or scheduler is invoked.
Repeated milestone projection must retain the same activation. Brand Brain reads
exactly one FIRST_GOVERNED_DECISION and compares immutable B5/B4/Audit history.

There is no automatic retry. Any timeout, unknown outcome or failed/invalid saved
Decision requires operator read-back before further action. The durable allowance
stays reserved; the harness does not clear evidence or create another Decision.

The CLI uses the repository's CommonJS package mode, avoiding the Node ESM-reparse
warning that strict Windows PowerShell can promote to NativeCommandError. Failure
output is bounded JSON: status, allowlisted stage/code, HTTP status when known and
the no-retry outcome. Relay/product diagnostics distinguish transport, Bearer,
OIDC, preflight, provider, persistence, decision and read-back stages. They never
include raw exception messages, upstream bodies, tokens or credentials. An operator
wrapper must capture stdout and the native exit code without treating harmless
native stderr warnings as proof of an acceptance outcome.

Customer action is only a real email from 628 to akram@frameleads.io and a direct
reply back. Obtain the reply Message-ID via Gmail **More → Show original**. Enter a
Gmail app password only in the local operator terminal, never FrameLeads or chat.
