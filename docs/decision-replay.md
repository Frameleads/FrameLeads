# Decision Replay V1

Decision Replay is a tenant-scoped, read-only reconstruction of a persisted Decision. It uses the triggering ConversationMessage, immutable DecisionTrace, recorded automation resolutions and human actions, the execution attempt, a uniquely correlated OutboundLog, the current persisted risk assessment, and the durable SLA instance. It does not re-run any evaluator or model.

Decision-time Brain, Playbook, and Constitution content may not have a full snapshot. Replay displays only stored revisions, rule IDs, and recorded policy results; missing evidence appears as **Not recorded**. The single replaceable Revenue-at-Risk row is labeled **latest persisted assessment**, never the original decision-time score. The assignment row is labeled as its current recorded state because edits to its queue and reason are not historical snapshots.

Replay exposes structured evidence and concise recorded explanations, never hidden chain-of-thought. It makes zero AI calls and writes no AI usage or operational records. Decision Sandbox answers what *would* happen; Replay answers what *did* happen. Outcome Learning is outside this feature.
