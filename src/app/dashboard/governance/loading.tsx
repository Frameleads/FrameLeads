export default function GovernanceLoading() {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8 lg:px-0 mt-8">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8 md:mb-10">
        <div>
          <div className="w-64 h-10 bg-[#1A1A1A] rounded-md animate-pulse mb-3"></div>
          <div className="w-96 h-5 bg-[#1A1A1A] rounded-md animate-pulse"></div>
        </div>
      </div>

      {/* ── Primary Metrics Grid ────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-[#242424] bg-[#121212] p-6 md:p-7 h-[200px] animate-pulse">
            <div className="w-11 h-11 bg-[#1A1A1A] rounded-xl mb-5"></div>
            <div className="w-32 h-10 bg-[#1A1A1A] rounded-md"></div>
          </div>
        ))}
      </div>

      {/* ── Data Visualizations (Live-Bound) ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-8">
        {[1, 2].map((i) => (
          <div key={i} className="rounded-2xl border border-[#242424] bg-[#121212] p-6 md:p-7 h-[350px] animate-pulse flex flex-col">
            <div className="w-48 h-6 bg-[#1A1A1A] rounded-md mb-6"></div>
            <div className="flex-1 w-full bg-[#1A1A1A] rounded-xl"></div>
          </div>
        ))}
      </div>
    </div>
  );
}
