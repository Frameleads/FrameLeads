export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse space-y-6" role="status" aria-label="Loading dashboard">
      <div className="space-y-3">
        <div className="h-9 w-56 rounded-lg bg-[#242424]" />
        <div className="h-4 w-80 max-w-full rounded bg-[#1A1A1A]" />
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {[1, 2, 3].map((item) => (
          <div key={item} className="h-40 rounded-2xl border border-[#242424] bg-[#111111] p-6">
            <div className="h-4 w-28 rounded bg-[#242424]" />
            <div className="mt-6 h-9 w-24 rounded bg-[#242424]" />
            <div className="mt-5 h-3 w-40 max-w-full rounded bg-[#1A1A1A]" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {[1, 2].map((item) => (
          <div key={item} className="h-80 rounded-2xl border border-[#242424] bg-[#111111] p-6">
            <div className="h-5 w-40 rounded bg-[#242424]" />
            <div className="mt-6 h-[230px] rounded-xl bg-[#1A1A1A]" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading dashboard content</span>
    </div>
  );
}
