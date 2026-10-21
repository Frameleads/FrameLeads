import Link from 'next/link';
import { Fragment } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowDown, BrainCircuit, CheckCircle2, FlaskConical, Layers3, LayoutTemplate,
  MessageSquareReply, Radar, Rocket, Settings2,
  Shield, Target, Upload, Workflow, Zap,
} from 'lucide-react';

type Step = {
  number: string;
  title: string;
  icon: LucideIcon;
  status: string;
  statusTone: 'required' | 'recommended' | 'optional' | 'plan';
  description: string;
  links: { label: string; href: string }[];
};

const sections: { name: string; description: string; steps: Step[] }[] = [
  {
    name: 'Prepare',
    description: 'Set the context and evidence your team wants to use. This is a guide, not a forced checklist.',
    steps: [
      { number: '01', title: 'Onboarding', icon: LayoutTemplate, status: 'OPTIONAL STARTING POINT', statusTone: 'optional', description: 'Choose a campaign template to prefill a starting setup, or skip this step and configure your campaign directly.', links: [{ label: 'Open Onboarding', href: '/dashboard/onboarding' }] },
      { number: '02', title: 'Campaign', icon: Settings2, status: 'REQUIRED BEFORE INGESTION', statusTone: 'required', description: 'Set your business positioning, audience, sender identity, value proposition, and CTA. Campaign Context must be present before the current ingestion flow will process leads.', links: [{ label: 'Open Campaign', href: '/dashboard/campaign' }] },
      { number: '03', title: 'ICP Profile', icon: Target, status: 'RECOMMENDED FOR SCOUT QUALIFICATION', statusTone: 'recommended', description: 'Define the titles, industries, locations, and other criteria that make a prospect a fit. Incomplete rules or prospect data leave qualification in review instead of inventing a fit. ICP and Scout access require Core or Enterprise.', links: [{ label: 'Open ICP Profile', href: '/dashboard/scout/settings' }] },
      { number: '04', title: 'Ingestion', icon: Upload, status: 'OPTIONAL: TO ADD PROSPECTS', statusTone: 'optional', description: 'Import a CSV or add a prospect manually. Processing requires Campaign Context; importing a prospect does not itself qualify or research them.', links: [{ label: 'Open Ingestion', href: '/dashboard/ingestion' }] },
      { number: '05', title: 'Scout', icon: Radar, status: 'RECOMMENDED FOR QUALIFICATION AND RESEARCH', statusTone: 'recommended', description: 'Run qualification first, then research prospects that qualify. Fit, value, and timing evidence can remain unavailable until research succeeds; imported prospects are not automatically researched. Scout access requires Core or Enterprise.', links: [{ label: 'Open Scout', href: '/dashboard/scout' }] },
      { number: '06', title: 'Brain and Market Profiles', icon: BrainCircuit, status: 'OPTIONAL', statusTone: 'optional', description: 'Add verified company facts to ground outreach context. Market Profiles adjust presentation, not factual evidence. Brain access is Core or Enterprise; custom Market Profiles are Enterprise, while built-in choices are available in generation.', links: [{ label: 'Open Brain', href: '/dashboard/brain' }, { label: 'Open Market Profiles', href: '/dashboard/market-profiles' }] },
      { number: '07', title: 'Playbook and Governance Setup', icon: Shield, status: 'SET BEFORE ADVANCED AUTOMATION', statusTone: 'plan', description: 'Define response rules, permitted actions, approval boundaries, and hard stops before enabling consequential automation. Revenue Playbook is Core or Enterprise; Sales Constitution and Automation are Enterprise features. These controls are optional for drafting.', links: [{ label: 'Open Revenue Playbook', href: '/dashboard/playbook' }, { label: 'Open Sales Constitution', href: '/dashboard/constitution' }, { label: 'Open Automation', href: '/dashboard/automation' }] },
    ],
  },
  {
    name: 'Send',
    description: 'Create and review drafts, then choose the sending path that fits your setup.',
    steps: [
      { number: '08', title: 'Connect a Native Inbox', icon: MessageSquareReply, status: 'REQUIRED FOR NATIVE EMAIL SEND', statusTone: 'required', description: 'Connect a mailbox before sending from Sandbox. The current SMTP mapping covers Gmail, Outlook, Microsoft 365, Hotmail, Yahoo, and matching imap.* to smtp.* hosts. Connecting is a Core or Enterprise feature. A separate inbox sync is not required before sending.', links: [{ label: 'Open Inbox Triage', href: '/dashboard/inbox-triage' }] },
      { number: '09', title: 'Sandbox', icon: FlaskConical, status: 'OPTIONAL DRAFT WORKSPACE', statusTone: 'optional', description: 'Generate, review, and edit outreach drafts. A native send also requires a valid recipient address belonging to a lead in your Sandbox and a connected mailbox.', links: [{ label: 'Open Sandbox', href: '/dashboard/sandbox' }] },
      { number: '10', title: 'Send or Deploy', icon: Rocket, status: 'CHOOSE A PATH', statusTone: 'optional', description: 'Send an individual email through Sandbox, or optionally push a prepared batch to Smartlead or Instantly from Deploy. External sending integrations are not mandatory. Review content and apply your approval rules before any consequential action.', links: [{ label: 'Open Sandbox', href: '/dashboard/sandbox' }, { label: 'Open Deploy', href: '/dashboard/deploy' }] },
    ],
  },
  {
    name: 'Govern',
    description: 'Review inbound replies and outcomes, then refine the controls available to your plan.',
    steps: [
      { number: '11', title: 'Inbox Triage', icon: MessageSquareReply, status: 'CORE OR ENTERPRISE', statusTone: 'plan', description: 'Review inbound prospect replies, their analysis status, and Decision Packets. Native mailbox synchronization requires a connected inbox; webhook ingestion is another supported path. Automatic analysis depends on the workspace rollout setting, so use Analyze when automatic analysis is not enabled.', links: [{ label: 'Open Inbox Triage', href: '/dashboard/inbox-triage' }] },
      { number: '12', title: 'Decision Sandbox', icon: FlaskConical, status: 'ENTERPRISE', statusTone: 'plan', description: 'Dry-run decision and governance behavior for review. This sandbox does not send messages or execute the actions being simulated.', links: [{ label: 'Open Decision Sandbox', href: '/dashboard/decision-sandbox' }] },
      { number: '13', title: 'Learning & Governance', icon: Zap, status: 'ENTERPRISE', statusTone: 'plan', description: 'Review outcomes, operational metrics, and available governance controls. Outcome Learning and the Governance Dashboard are Enterprise features; their availability depends on your subscription.', links: [{ label: 'Open Outcome Learning', href: '/dashboard/outcome-learning' }, { label: 'Open Governance', href: '/dashboard/governance' }] },
    ],
  },
];

const statusClasses = {
  required: 'border-[#FF5A1F]/40 bg-[#FF5A1F]/10 text-[#FF5A1F]',
  recommended: 'border-[#1A1A1A] bg-[#1A1A1A] text-[#FFFFFF]',
  optional: 'border-[#1A1A1A] bg-[#1A1A1A] text-[#888888]',
  plan: 'border-[#1A1A1A] bg-[#1A1A1A] text-[#888888]',
};

export default function HowItWorksPage() {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 pb-10">
      <header className="space-y-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#FF5A1F]/30 bg-[#242424] px-3 py-1 font-mono text-xs font-medium text-[#FF5A1F]">
          <Workflow className="h-4 w-4" aria-hidden="true" /> FrameLeads workflow
        </div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#FFFFFF] sm:text-4xl">How it works</h1>
        <p className="max-w-3xl font-sans text-sm leading-6 text-[#888888] sm:text-base">
          A practical path from campaign setup to governed reply review. Follow the parts you need; the only hard setup dependency shown here is Campaign Context before prospect ingestion.
        </p>
      </header>

      <div className="flex items-start gap-3 rounded-xl border border-[#242424] bg-[#1A1A1A] p-4 font-sans text-sm leading-6 text-[#888888]">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#FF5A1F]" aria-hidden="true" />
        <p><span className="font-medium text-[#FFFFFF]">Before consequential automation:</span> configure the Revenue Playbook, Sales Constitution, and required human approval boundaries in step 07. Availability varies by plan. Draft generation and manual review do not require advanced automation.</p>
      </div>

      <div className="flex flex-wrap gap-3 font-sans text-xs text-[#888888]" aria-label="Step label key">
        <span className="inline-flex items-center gap-2 rounded-full border border-[#FF5A1F]/40 bg-[#FF5A1F]/10 px-3 py-2"><span className="font-mono font-semibold text-[#FF5A1F]">Required</span><span>for the stated action</span></span>
        <span className="inline-flex items-center gap-2 rounded-full border border-[#1A1A1A] bg-[#1A1A1A] px-3 py-2"><span className="font-mono font-semibold text-[#FFFFFF]">Recommended</span><span>to use that feature well</span></span>
        <span className="inline-flex items-center gap-2 rounded-full border border-[#1A1A1A] bg-[#1A1A1A] px-3 py-2"><span className="font-mono font-medium text-[#888888]">Optional</span><span>based on your workflow</span></span>
        <span className="inline-flex items-center gap-2 rounded-full border border-[#1A1A1A] bg-[#1A1A1A] px-3 py-2"><span className="font-mono font-medium text-[#888888]">Plan</span><span>availability depends on subscription</span></span>
      </div>

      {sections.map((section, sectionIndex) => (
        <Fragment key={section.name}>
        <section key={section.name} aria-labelledby={`section-${section.name.toLowerCase()}`} className="rounded-2xl border border-[#242424] bg-[#1A1A1A] p-4 sm:p-5">
          <div className="mb-4 border-b border-[#242424] pb-3">
            <h2 id={`section-${section.name.toLowerCase()}`} className="font-heading text-xl font-semibold text-[#FFFFFF]">{section.name}</h2>
            <p className="mt-1 font-sans text-sm text-[#888888]">{section.description}</p>
          </div>
          <ol className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {section.steps.map((step) => {
              const Icon = step.icon;
              const isTransition = step.number === '07';
              return (
                <li key={step.number} className={`min-w-0 ${isTransition ? 'md:col-span-2 xl:col-span-3' : ''}`}>
                  <article className="flex h-full min-w-0 flex-col rounded-xl border border-[#1A1A1A] bg-[#242424] p-4 transition-colors hover:border-[#FF5A1F]/40">
                    <div className={`mb-2 flex items-center gap-3 ${isTransition ? 'xl:max-w-5xl' : ''}`}>
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1A1A1A] text-[#FF5A1F]">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-mono text-[11px] font-semibold tracking-wider text-[#888888]">{step.number}</span>
                          <h3 className={`font-heading text-sm font-semibold leading-5 text-[#FFFFFF] ${step.number === '13' ? 'xl:whitespace-nowrap' : ''}`}>{step.title}</h3>
                        </div>
                      </div>
                    </div>
                    <span className={`mb-3 inline-flex max-w-full self-start rounded-full border px-2 py-0.5 font-sans text-[10px] leading-4 tracking-normal xl:whitespace-nowrap ${step.statusTone === 'optional' || step.statusTone === 'plan' ? 'font-medium' : 'font-semibold'} ${step.number === '05' ? 'whitespace-nowrap text-[9px]' : ''} ${statusClasses[step.statusTone]}`}>{step.status}</span>
                    <p className={`mb-4 flex-1 font-sans text-[13px] leading-5 text-[#888888] ${isTransition ? 'xl:max-w-5xl' : ''}`}>{step.description}</p>
                    <div className={`flex flex-wrap gap-2 border-t border-[#1A1A1A] pt-3 ${step.links.length > 1 ? 'items-center' : ''} ${isTransition ? 'xl:max-w-5xl' : ''}`}>
                      {step.links.map((item) => (
                        <Link key={`${step.number}-${item.href}`} href={item.href} className="inline-flex min-h-9 max-w-full items-center justify-center whitespace-nowrap rounded-lg bg-[#FF5A1F] px-2.5 py-2 font-sans text-[10px] font-semibold text-[#000000] transition-all duration-200 hover:opacity-90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]">
                          {item.label}
                        </Link>
                      ))}
                    </div>
                  </article>
                </li>
              );
            })}
          </ol>
        </section>
        {sectionIndex < sections.length - 1 && <div aria-hidden="true" className="flex h-8 items-center justify-center text-[#FF5A1F] drop-shadow-[0_0_6px_rgba(255,90,31,0.7)]"><ArrowDown className="h-5 w-5" /></div>}
        </Fragment>
      ))}

      <div className="flex flex-col gap-3 rounded-xl border border-[#242424] bg-[#1A1A1A] p-4 font-sans text-sm text-[#888888] sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <p>Plan gates are enforced in their feature pages. This guide does not record setup progress or change account settings.</p>
        <Link href="/dashboard/campaign" className="inline-flex min-h-10 shrink-0 items-center gap-2 font-medium text-[#FF5A1F] hover:underline">Open Campaign<Layers3 className="h-4 w-4" aria-hidden="true" /></Link>
      </div>
    </main>
  );
}
