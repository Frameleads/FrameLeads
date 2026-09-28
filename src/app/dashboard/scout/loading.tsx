export default function ScoutLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 animate-pulse" role="status" aria-label="Loading Scout">
      <div className="space-y-3"><div className="h-8 w-44 rounded bg-muted" /><div className="h-4 w-72 max-w-full rounded bg-muted/60" /></div>
      <div className="h-11 w-full max-w-lg rounded-xl bg-muted/50" />
      <div className="space-y-3">
        {[1, 2, 3, 4].map(item => <div key={item} className="h-24 rounded-2xl border border-border/50 bg-card/50" />)}
      </div>
      <span className="sr-only">Loading prospects</span>
    </div>
  );
}
