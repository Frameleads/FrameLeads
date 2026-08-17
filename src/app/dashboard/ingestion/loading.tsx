export default function Loading() {
  return (
    <div className="w-full h-full min-h-[50vh] flex flex-col items-center justify-center space-y-4 animate-pulse">
      <div className="w-16 h-16 rounded-full bg-[#1A1A1A] border border-[#242424] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full bg-[#2A2A2A]" />
      </div>
      <div className="h-4 w-48 bg-[#1A1A1A] rounded-md" />
      <div className="h-3 w-32 bg-[#1A1A1A] rounded-md" />
    </div>
  );
}
