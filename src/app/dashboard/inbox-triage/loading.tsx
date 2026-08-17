export default function TriageLoading() {
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#0D0D0D] text-[#F5F1E8] font-sans">
      {/* QUEUE HEADER SKELETON */}
      <div className="flex items-center gap-3 p-4 pb-0 shrink-0">
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
          ACTIVE QUEUE
        </span>
        <span className="bg-[#1A1A1A] border border-[#333] text-[#FF5A1F] font-mono text-[10px] px-2 py-0.5 rounded-sm">
          [ ... ]
        </span>
      </div>

      {/* HORIZONTAL SKELETON QUEUE */}
      <div className="w-full border-b border-[#1A1A1A] p-4 flex gap-4 overflow-hidden shrink-0">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="w-[300px] min-w-[300px] h-[100px] rounded-xl border border-[#242424] bg-[#121212] animate-pulse flex-shrink-0"
          ></div>
        ))}
      </div>

      {/* MAIN SKELETON BODY */}
      <div className="flex-1 w-full p-4 md:p-8 flex flex-col">
        <div className="w-1/3 h-8 bg-[#1A1A1A] rounded-md animate-pulse mb-8"></div>
        <div className="flex flex-col xl:flex-row gap-6 md:gap-12 flex-1">
          {/* Left panel */}
          <div className="w-full xl:w-[400px] flex-shrink-0 space-y-6">
            <div className="w-full h-32 bg-[#1A1A1A] rounded-xl animate-pulse"></div>
            <div className="w-full h-48 bg-[#1A1A1A] rounded-xl animate-pulse"></div>
          </div>
          {/* Right panel */}
          <div className="flex-1 space-y-6 relative">
            <div className="w-full h-[300px] bg-[#1A1A1A] rounded-xl animate-pulse"></div>
          </div>
        </div>
      </div>
    </div>
  );
}
