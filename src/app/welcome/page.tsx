'use client';

import { useRouter } from 'next/navigation';

export default function WelcomePortalPage() {
  const router = useRouter();

  const handleEnterApp = () => {
    router.push('/dashboard/campaign');
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0A0A0A] text-gray-200 flex flex-col justify-between font-sans select-none">
      
      {/* Noise Texture Overlay */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:16px_16px]" />

      {/* Organic Ambient Glow Orbs */}
      <div className="absolute -bottom-32 -left-32 w-[500px] h-[500px] bg-[#FF5A1F]/15 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute -top-32 -right-32 w-[400px] h-[400px] bg-[#FF5A1F]/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Main Center Stage (The Gateway) */}
      <main className="relative z-10 flex-grow flex flex-col items-center justify-center text-center px-4 sm:px-6 max-w-4xl mx-auto my-auto">
        
        {/* Brand Header / Logo Identifier */}
        <div className="mb-4">
          <img
            src="/FrameLeads Logo.png"
            alt="FrameLeads"
            className="w-16 h-16 mx-auto mb-6 rounded-2xl shadow-2xl object-cover"
            style={{ border: '1px solid #888888' }}
          />
          <span className="text-sm font-bold tracking-[0.3em] uppercase text-gray-500 block mb-2" style={{ fontFamily: 'Oxanium, sans-serif' }}>
            WELCOME TO FRAMELEADS
          </span>
          <h1
            className="text-4xl md:text-5xl font-bold text-center tracking-tight mb-6 max-w-3xl mx-auto"
            style={{ color: '#FF5A1F', textShadow: '0px 0px 35px rgba(255, 90, 31, 0.4)' }}
          >
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
  );
}
