'use client';

import { useRouter } from 'next/navigation';

export default function WelcomePortalPage() {
  const router = useRouter();

  const handleEnterApp = () => {
    router.push('/dashboard/campaign');
  };

  return (
    <div className="relative min-h-screen bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#FF5A1F]/15 via-[#0A0A0A]/80 to-[#0A0A0A] text-gray-200 flex flex-col justify-between overflow-hidden font-sans select-none">
      
      {/* Background Architectural Grid (Matches Notion Framework Visual) */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(255, 255, 255, 0.05) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255, 255, 255, 0.05) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px'
        }}
      />

      {/* Subtle Radial Orange Glow in Center */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-tr from-[#FF5A1F]/10 to-transparent rounded-full blur-3xl pointer-events-none" />

      {/* Main Center Stage (The Gateway) */}
      <main className="relative z-10 flex-grow flex flex-col items-center justify-center text-center px-4 sm:px-6 max-w-4xl mx-auto my-auto">
        
        {/* Brand Header / Logo Identifier */}
        <div className="mb-4">
          <div className="flex items-center justify-center w-16 h-16 bg-[#181818] rounded-2xl border border-white/5 shadow-lg mx-auto mb-6">
            <img src="/FrameLeads Logo.png" alt="FrameLeads Logo" className="w-8 h-8 object-contain" />
          </div>
          <span className="text-sm font-bold tracking-[0.3em] uppercase text-gray-500 block mb-2" style={{ fontFamily: 'Oxanium, sans-serif' }}>
            WELCOME TO FRAMELEADS
          </span>
          <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white leading-none" style={{ fontFamily: 'Oxanium, sans-serif' }}>
            Your outbound architecture is live.
          </h1>
        </div>

        {/* Visceral Pain / Worldview Slogan (Aligned to singular $40k deal) */}
        <p className="max-w-2xl text-base sm:text-lg text-gray-400 mt-6 mb-10 leading-relaxed font-normal" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          Stop babysitting your inbox. Connect your sending tools, drop your leads, and let the engine handle the endless follow-ups. You only step in when a whale replies.
        </p>

        {/* Primary Action Button */}
        <button
          onClick={handleEnterApp}
          className="group relative inline-flex items-center justify-center gap-3 px-10 py-5 rounded-xl bg-[#FF5A1F] hover:bg-[#ea580c] text-white font-bold text-base sm:text-lg tracking-wide transition-all duration-200 shadow-[0_0_30px_rgba(255,90,31,0.3)] hover:shadow-[0_0_45px_rgba(255,90,31,0.5)] active:scale-[0.98]"
          style={{ fontFamily: 'Oxanium, sans-serif' }}
        >
          <span>Enter Workspace →</span>
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
  );
}
