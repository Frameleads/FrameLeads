'use client';

import { useRouter } from 'next/navigation';

export default function WelcomePortalPage() {
  const router = useRouter();

  const handleEnterApp = () => {
    router.push('/dashboard/campaign');
  };

  return (
    <div className="relative w-full min-h-screen overflow-hidden bg-[#000000] flex items-center justify-center">
      {/* Deep Void Base */}
      <div className="absolute inset-0 bg-[#000000]"></div>

      {/* Subdued Mesh Orbs */}
      <div className="absolute top-[-20%] left-[-10%] w-[50vw] h-[50vw] bg-[#FF5A1F] rounded-full mix-blend-screen filter blur-[200px] opacity-[0.12] animate-pulse pointer-events-none"></div>
      <div className="absolute bottom-[-20%] right-[-10%] w-[60vw] h-[60vw] bg-[#1A1A1A] rounded-full mix-blend-normal filter blur-[150px] opacity-90 pointer-events-none"></div>
      <div className="absolute top-[20%] right-[10%] w-[40vw] h-[40vw] bg-[#242424] rounded-full mix-blend-normal filter blur-[150px] opacity-80 pointer-events-none"></div>
      <div className="absolute bottom-[10%] left-[20%] w-[30vw] h-[30vw] bg-[#888888] rounded-full mix-blend-overlay filter blur-[150px] opacity-10 pointer-events-none"></div>

      {/* Micro-Fine Noise Texture */}
      <div
        className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-30"
        style={{
          backgroundImage: "url('data:image/svg+xml;utf8,%3Csvg viewBox=%220 0 256 256%22 width=%22256%22 height=%22256%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noise%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%221.5%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noise)%22/%3E%3C/svg%3E')",
          backgroundRepeat: "repeat",
          backgroundSize: "128px 128px"
        }}
      ></div>

      <div className="relative z-10 w-full min-h-screen flex flex-col justify-between text-gray-200 font-sans select-none">

      {/* Main Center Stage (The Gateway) */}
      <main className="relative z-10 flex-grow flex flex-col items-center justify-center text-center px-4 sm:px-6 max-w-4xl mx-auto my-auto">
        
        <div className="flex flex-col items-center justify-center w-full px-4 mt-8">
          {/* Eyebrow */}
          <p className="text-sm font-bold tracking-[0.2em] text-[#888888] uppercase text-center mb-6">
            Welcome to FrameLeads
          </p>

          {/* Headline with Hard Line Break */}
          <h1
            className="text-5xl md:text-6xl font-bold text-center tracking-tight mb-8 leading-[1.1]"
            style={{ color: '#FF5A1F', textShadow: '0px 0px 35px rgba(255, 90, 31, 0.4)' }}
          >
            Your outbound <br /> architecture is live.
          </h1>

          {/* Subheadline */}
          <p className="text-gray-400 text-center max-w-2xl mx-auto text-lg mb-12 leading-relaxed">
            Stop babysitting your inbox. Connect your sending tools, drop your leads, and let the engine handle the endless follow-ups. You only step in when a whale replies.
          </p>
        </div>

        {/* Primary Action Button */}
        <button
          onClick={handleEnterApp}
          className="flex items-center justify-center text-center px-8 py-4 bg-[#FF5A1F] text-white font-medium rounded-xl shadow-[0_10px_30px_-10px_rgba(255,90,31,0.5)]"
          style={{ fontFamily: 'Oxanium, sans-serif' }}
        >
          <span>Enter Workspace</span>
        </button>

      </main>

      {/* Bottom Minimalist Footer */}
      <footer className="relative z-10 w-full px-8 py-6 border-t border-gray-800/60 bg-[#0a0a0a]/50 backdrop-blur-md flex flex-col sm:flex-row justify-between items-center text-xs text-gray-600 gap-2">
        <div style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          FRAMELEADS ARCHITECTURE © 2026 • ZERO-CODE DEPLOYMENT
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
          <span>ALL LOGIC ENGINES OPERATIONAL</span>
        </div>
      </footer>

      </div>
    </div>
  );
}
