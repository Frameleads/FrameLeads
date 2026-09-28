# Reply-workflow diagnostic V1

Public route: `/diagnostic` in the FrameLeads SaaS app. The marketing site may link to this route; it is not edited here.

The twelve bounded questions include one context-only volume question. Eleven questions score six equally weighted dimensions: Reply Operations, Decision Speed, Governance, Revenue Prioritization, Prospect Context, and Automation Risk. Each dimension averages its question scores; the maturity index averages the six dimensions and rounds to 0-100. Unknown answers score a neutral 50 and lower answer confidence. Volume and team size alone do not reduce maturity.

Bands are FRAGMENTED (0-39), DEVELOPING (40-64), CONTROLLED (65-84), and DECISION-READY (85-100). This is a self-reported workflow index, not a benchmark, forecast, or probability. Gap rules fire only for specific weak answers, use fixed safety-first priority, and show at most five gaps. A mature workflow may have no gaps. Every prescription maps to an existing FrameLeads capability named in `src/lib/diagnostic/scoring.ts`.

Each band has one deterministic CTA. All CTAs currently link to the existing `/login` route, with band-specific labels. This SaaS repo has no verified public demo or pilot booking route, so the diagnostic does not invent one. The questionnaire uses client component state only: no database write, AI call, external request, account requirement, or stored response. Restart clears answers and results.

Run `npm run test:diagnostic` and `npx tsc --noEmit --incremental false`. Do not use `npm run build` for this check: its script deploys Prisma migrations.
