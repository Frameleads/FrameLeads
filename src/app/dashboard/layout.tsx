"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Settings2,
  Upload,
  FlaskConical,
  Rocket,
  MessageSquareReply,
  Zap,
  LogOut,
  Menu,
  X,
} from "lucide-react";

const navItems = [
  {
    label: "Campaign",
    href: "/dashboard/campaign",
    icon: Settings2,
  },
  {
    label: "Ingestion",
    href: "/dashboard/ingestion",
    icon: Upload,
  },
  {
    label: "Sandbox",
    href: "/dashboard/sandbox",
    icon: FlaskConical,
  },
  {
    label: "Deploy",
    href: "/dashboard/deploy",
    icon: Rocket,
  },
  {
    label: "Inbox Triage",
    href: "/dashboard/inbox-triage",
    icon: MessageSquareReply,
  },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  // ── Shared sidebar content (used in both mobile overlay & desktop) ──
  const SidebarContent = (
    <>
      {/* Brand */}
      <div className="flex items-center gap-3 px-6 h-16 border-b border-border/50 shrink-0">
        <div className="bg-[#1A1A1A] border border-[#242424] p-2 rounded-xl">
          <Zap className="text-[#FF5A1F] w-5 h-5" />
        </div>
        <span className="font-heading font-bold text-white tracking-wide text-xl">
          FrameLeads
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-5 space-y-1.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setIsOpen(false)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium transition-all duration-150 ${
                isActive
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-border/50 shrink-0">
        <button
          onClick={() => {
            setIsOpen(false);
            window.location.href = "/login";
          }}
          className="flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-150 w-full"
        >
          <LogOut className="w-5 h-5" />
          Sign Out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* ─── Mobile Top Bar (visible < md) ─────────────────────────── */}
      <div className="fixed top-0 left-0 right-0 z-40 h-16 border-b border-border/50 bg-card/80 backdrop-blur-xl flex items-center justify-between px-4 md:hidden">
        <div className="flex items-center gap-3">
          <div className="bg-[#1A1A1A] border border-[#242424] p-1.5 rounded-lg">
            <Zap className="text-[#FF5A1F] w-4 h-4" />
          </div>
          <span className="font-heading font-bold text-white tracking-wide text-lg">
            FrameLeads
          </span>
        </div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          aria-label="Toggle menu"
        >
          {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* ─── Mobile Sidebar Overlay (visible < md, when open) ──────── */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => setIsOpen(false)}
          />
          {/* Slide-in panel */}
          <aside className="fixed inset-y-0 left-0 z-50 w-72 bg-card/95 backdrop-blur-xl border-r border-border/50 flex flex-col md:hidden animate-in slide-in-from-left duration-200">
            {SidebarContent}
          </aside>
        </>
      )}

      {/* ─── Desktop Sidebar (visible >= md) ──────────────────────── */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 z-30 w-72 border-r border-border/50 bg-card/30 backdrop-blur-xl flex-col">
        {SidebarContent}
      </aside>

      {/* ─── Main Content ─────────────────────────────────────────── */}
      <main className="pt-16 md:pt-0 md:ml-72 min-h-screen">
        {/* Desktop page title bar */}
        <div className="hidden md:flex h-16 border-b border-border/50 bg-card/30 backdrop-blur-xl items-center px-8">
          <h2 className="text-sm font-medium text-muted-foreground">
            {navItems.find((i) => pathname.startsWith(i.href))?.label ||
              "Dashboard"}
          </h2>
        </div>
        <div className="p-4 md:p-8">{children}</div>
      </main>
    </div>
  );
}
