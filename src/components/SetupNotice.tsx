import Link from 'next/link';
import { AlertCircle, Info } from 'lucide-react';

type SetupNoticeProps = {
  level: 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL';
  title: string;
  children: React.ReactNode;
  href?: string;
  linkLabel?: string;
  tone?: 'notice' | 'warning';
};

export default function SetupNotice({ level, title, children, href, linkLabel, tone = 'notice' }: SetupNoticeProps) {
  const Icon = tone === 'warning' ? AlertCircle : Info;
  return <aside className={`w-full max-w-full min-w-0 rounded-xl border px-4 py-3 font-sans ${tone === 'warning' ? 'border-amber-500/25 bg-amber-500/5' : 'border-border/60 bg-card/35'}`}>
    <div className="flex items-center gap-2">
      <Icon className={`h-4 w-4 shrink-0 ${tone === 'warning' ? 'text-amber-400' : 'text-muted-foreground'}`} aria-hidden="true" />
      <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{level}</span>
    </div>
    <h2 className="mt-2 min-w-0 break-words font-sans text-sm font-semibold leading-5 text-foreground">{title}</h2>
    <div className="mt-1.5 min-w-0 break-words font-sans text-xs leading-5 text-muted-foreground">{children}</div>
    {href && linkLabel && <Link href={href} className="mt-3 inline-flex min-h-8 items-center font-sans text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{linkLabel}</Link>}
  </aside>;
}
