'use client';

import { useRouter } from 'next/navigation';
import { ShieldCheck, ArrowRight, Terminal } from 'lucide-react';

export default function WelcomePortalPage() {
  const router = useRouter();

  const handleEnterApp = () => {
    router.push('/dashboard/campaign');
  };

  return (
    <div className="relative min-h-screen bg-[#0a0a0a] text-gray-200 flex flex-col justify-between overflow-hidden font-sans select-none">
      
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

      {/* Top Status Bar */}
      <header className="relative z-10 w-full px-8 py-6 flex justify-between items-center border-b border-gray-800/60 bg-[#0a0a0a]/50 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-[#FF5A1F] animate-pulse" />
          <span className="text-xs font-bold tracking-widest uppercase text-gray-400" style={{ fontFamily: 'Oxanium, sans-serif' }}>
            FRAMELEADS // INFRASTRUCTURE
          </span>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-xs text-gray-500 font-mono">
          <Terminal className="w-3.5 h-3.5 text-[#FF5A1F]" />
          <span>VELVET ROPE GOVERNANCE: ENABLED</span>
        </div>
      </header>

      {/* Main Center Stage (The Gateway) */}
      <main className="relative z-10 flex-grow flex flex-col items-center justify-center text-center px-4 sm:px-6 max-w-4xl mx-auto my-auto">
        
        {/* Top Terminal Tag Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#121212] border border-gray-800 mb-8 shadow-inner">
          <ShieldCheck className="w-4 h-4 text-[#FF5A1F]" />
          <span className="text-xs uppercase tracking-widest text-gray-300 font-medium" style={{ fontFamily: 'Oxanium, sans-serif' }}>
            SYSTEM STATUS: SECURE • EXECUTIVE OVERRIDE ACTIVE
          </span>
        </div>

        {/* Brand Header / Logo Identifier */}
        <div className="mb-4">
          <span className="text-sm font-bold tracking-[0.3em] uppercase text-gray-500 block mb-2" style={{ fontFamily: 'Oxanium, sans-serif' }}>
            WELCOME TO FRAMELEADS
          </span>
          <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white leading-none" style={{ fontFamily: 'Oxanium, sans-serif' }}>
            Autonomous Outbound. <br className="hidden sm:block" />
            <span className="text-[#FF5A1F]">Zero Brand Risk.</span>
          </h1>
        </div>

        {/* Visceral Pain / Worldview Slogan */}
        <p className="max-w-2xl text-base sm:text-lg text-gray-400 mt-6 mb-10 leading-relaxed font-normal" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          Stop renting SDR memory and triaging edge-cases manually. Initialize your campaign context once, deploy across 4 channels, and let the Executive Override Queue protect your $40k deals.
        </p>

        {/* Primary Action Button */}
        <button
          onClick={handleEnterApp}
          className="group relative inline-flex items-center justify-center gap-3 px-10 py-5 rounded-xl bg-[#FF5A1F] hover:bg-[#ea580c] text-white font-bold text-base sm:text-lg tracking-wide uppercase transition-all duration-200 shadow-[0_0_30px_rgba(255,90,31,0.3)] hover:shadow-[0_0_45px_rgba(255,90,31,0.5)] active:scale-[0.98]"
          style={{ fontFamily: 'Oxanium, sans-serif' }}
        >
          <span>INITIALIZE COMMAND CENTER</span>
          <ArrowRight className="w-5 h-5 transition-transform duration-200 group-hover:translate-x-1" />
        </button>

        {/* Micro Trust Note Below CTA */}
        <p className="mt-6 text-xs text-gray-600 tracking-wider uppercase font-mono">
          NO MANUAL ROUTING REQUIRED  •  INSTANT OMNICHANNEL SYNTHESIS
        </p>

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