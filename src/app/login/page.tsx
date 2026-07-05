"use client";

import { LogIn, Zap } from "lucide-react";

export default function LoginPage() {
  const handleWhopLogin = () => {
    // Route through the server-side OAuth handler which
    // redirects to Whop and handles the token exchange.
    window.location.href = "/api/auth/login";
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      {/* Ambient glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-md px-6">
        {/* Logo / Brand */}
        <div className="text-center mb-10 flex flex-col items-center">
          <div className="flex items-center gap-3 justify-center mb-4">
            <div className="bg-[#1A1A1A] border border-[#242424] p-2 rounded-xl">
              <Zap className="text-[#FF5A1F] w-5 h-5" />
            </div>
            <span className="font-heading font-bold text-white tracking-wide text-xl">
              FrameLeads
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            AI-powered outreach for high-ticket B2B
          </p>
        </div>

        {/* Auth Card */}
        <div className="rounded-2xl border border-border/50 bg-card/50 backdrop-blur-xl p-8 shadow-2xl shadow-black/20">
          <div className="space-y-4">
            <div className="text-center mb-6">
              <h2 className="text-lg font-medium text-white">
                Welcome back
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Sign in to access your outreach engine
              </p>
            </div>

            <button
              id="whop-login-button"
              onClick={handleWhopLogin}
              className="w-full flex items-center justify-center gap-3 h-12 px-6 rounded-xl bg-primary text-primary-foreground font-medium text-sm transition-all duration-200 hover:opacity-90 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98]"
            >
              <LogIn className="w-5 h-5" />
              Log in with Whop
            </button>
          </div>

          <div className="mt-6 pt-6 border-t border-border/50">
            <p className="text-xs text-center text-muted-foreground">
              By continuing, you agree to our Terms of Service and Privacy
              Policy.
            </p>
          </div>
        </div>

        <p className="text-xs text-center text-muted-foreground mt-8">
          Subscription validated via Whop &middot; Powered by LangGraph
        </p>
      </div>
    </div>
  );
}
