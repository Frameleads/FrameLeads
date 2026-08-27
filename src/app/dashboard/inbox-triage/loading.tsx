export default function InboxTriageLoading() {
  return (
    <div className="min-h-[calc(100vh-8rem)] animate-pulse space-y-6 bg-[#0D0D0D] p-4" role="status" aria-label="Loading inbox triage">
      <div className="flex items-center justify-between gap-4">
        <div className="h-4 w-32 rounded bg-[#242424]" />
        <div className="h-10 w-44 rounded-lg bg-[#1A1A1A]" />
      </div>
      <div className="flex gap-4 overflow-hidden border-b border-[#1A1A1A] pb-4">
        {[1, 2, 3].map((item) => (
          <div key={item} className="h-24 min-w-[260px] rounded-lg border border-[#242424] bg-[#111111]" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="space-y-6 xl:col-span-2">
          <div className="h-52 rounded-xl border border-[#242424] bg-[#111111]" />
          <div className="h-64 rounded-xl border border-[#242424] bg-[#111111]" />
        </div>
        <div className="space-y-6 xl:col-span-3">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="h-56 rounded-xl border border-[#242424] bg-[#111111]" />
            <div className="h-56 rounded-xl border border-[#242424] bg-[#111111]" />
          </div>
          <div className="h-72 rounded-xl border border-[#242424] bg-[#111111]" />
        </div>
      </div>
      <span className="sr-only">Loading triage signals</span>
    </div>
  );
}
