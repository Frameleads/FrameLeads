# Revenue-at-Risk V1

Revenue-at-Risk is a deterministic Inbox **priority index**, not a prediction of lost dollars. It helps order active conversations using facts already stored in FrameLeads. It makes no AI, enrichment, or network calls and never changes Constitution or governed-execution permissions.

The current scoring version is `revenue-risk-v1`. One tenant-owned `DecisionRevenueRisk` row stores the latest assessment for each Decision: nullable 0–100 score, LOW/MEDIUM/HIGH/CRITICAL band, LOW/MEDIUM/HIGH assessment confidence, component snapshot, reasons, source references, fingerprint, and evaluation time. The original Decision and DecisionTrace are unchanged.

| Component | Weight | Stored input |
| --- | ---: | --- |
| Opportunity tier | 20 | READY or user-edited ProspectIntelligence value band |
| ICP fit | 20 | Qualification and READY or user-edited stored fit score/tier |
| Intent | 20 | Persisted Decision primary intent |
| Delay | 15 | Decision inbound time and later outbound message, in broad waiting buckets |
| Momentum | 10 | Recent reciprocal ConversationMessages |
| Decision uncertainty | 8 | Decision confidence and review state |
| Governance attention | 7 | Latest persisted Automation resolution |

The score is the weighted mean of **known** components; unknowns leave the denominator rather than scoring zero. Coverage and Decision reliability determine assessment confidence. Scores below 35 are LOW, 35–59 MEDIUM, 60–79 HIGH, and 80–100 CRITICAL. Reasons come from the recorded component values. The assessment exposes its input IDs so later Replay can identify the supporting Decision, qualification, intelligence, automation resolution, and messages.

Confirmed, sufficiently confident spam, out-of-office, unsubscribe, wrong-person, and not-interested Decisions are `NOT_APPLICABLE`, with no score. Uncertain classification or no usable signals yields `INSUFFICIENT_DATA`, also without a score. Completed or rejected governed actions are not pending revenue actions. A Constitution-required human action can raise the operational-attention component, but a high score never authorizes sending.

`InboundSignal.pipelineValue` defaults to 5,000, so this version deliberately does **not** treat it as a known deal amount. Its free-text `dealStage` is not a canonical sales-stage source. A value band is displayed only as an **estimated tier**; no tier is converted to currency or a synthetic opportunity amount. There is currently no trusted canonical CRM deal-value field to display as an exact amount.

Inbox load assesses the latest Decision per visible signal in batches. The selected Decision can be reassessed through the tenant-scoped read endpoint; reassessment performs no model call. The service reads conversation history in a bounded batch and withholds delay/momentum when a cap makes history incomplete. It writes only when the material result fingerprint changes. Broad delay buckets prevent hourly write churn. The Inbox shows score, band, confidence, and reasons, and offers an optional highest-risk-first order; non-applicable and unscored items follow in their prior order. No background worker, due date, SLA breach, alert, or escalation timer exists. Roadmap #10 may consume the score, band, confidence, reasons, and evaluation time without changing this authority boundary.
