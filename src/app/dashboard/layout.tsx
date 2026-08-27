"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  LayoutTemplate,
  Shield,
  Folder,
  MoreHorizontal,
} from "lucide-react";

interface LeadListSummary {
  id: string;
  name: string;
  _count?: { leads: number };
}

const navItems = [
  {
    label: "Onboarding",
    href: "/dashboard/onboarding",
    icon: LayoutTemplate,
  },
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
  {
    label: "Governance",
    href: "/dashboard/governance",
    icon: Shield,
  },
];

function DashboardLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isOpen, setIsOpen] = useState(false);
  const [lists, setLists] = useState<LeadListSummary[]>([]);
  const [openListMenuId, setOpenListMenuId] = useState<string | null>(null);
  const selectedListId = searchParams.get("list");

  const loadLists = useCallback(async () => {
    try {
      const response = await fetch("/api/lists", { cache: "no-store" });
      if (!response.ok) return;
      const result = await response.json();
      setLists(Array.isArray(result.lists) ? result.lists : []);
    } catch {
      // Keep navigation usable if lists cannot be loaded.
    }
  }, []);

  useEffect(() => {
    loadLists();
    window.addEventListener("frameleads:lists-changed", loadLists);
    return () => window.removeEventListener("frameleads:lists-changed", loadLists);
  }, [loadLists]);

  const handleDeleteList = async (list: LeadListSummary) => {
    if (!window.confirm(`Delete the list “${list.name}”? Its leads will remain in the Sandbox.`)) return;

    setOpenListMenuId(null);
    const response = await fetch(`/api/lists/${encodeURIComponent(list.id)}`, { method: "DELETE" });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      window.alert(result?.error || "Failed to delete list.");
      return;
    }

    await loadLists();
    window.dispatchEvent(new Event("frameleads:lists-changed"));
    if (selectedListId === list.id) router.push("/dashboard/sandbox");
  };

  const handleRenameList = async (list: LeadListSummary) => {
    setOpenListMenuId(null);
    const requestedName = window.prompt("Enter a new name for this list:", list.name);
    const name = requestedName?.trim();
    if (!name || name === list.name) return;

    const response = await fetch(`/api/lists/${encodeURIComponent(list.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      window.alert(result?.error || "Failed to rename list.");
      return;
    }

    await loadLists();
    window.dispatchEvent(new Event("frameleads:lists-changed"));
  };

  const handleDuplicateList = async (list: LeadListSummary) => {
    setOpenListMenuId(null);
    const response = await fetch(`/api/lists/${encodeURIComponent(list.id)}/duplicate`, {
      method: "POST",
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      window.alert(result?.error || "Failed to duplicate list.");
      return;
    }

    await loadLists();
    window.dispatchEvent(new Event("frameleads:lists-changed"));
  };


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
          const isSandbox = item.href === "/dashboard/sandbox";
          const isActive = pathname === item.href && (!isSandbox || !selectedListId);
          return (
            <div key={item.href}>
              <Link
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
              {isSandbox && pathname.includes("/sandbox") && (
                <div className="ml-7 mt-1 space-y-1 border-l border-border/50 pl-3">
                  {lists.map((list) => (
                    <div key={list.id} className="group flex items-center gap-1">
                      <Link
                        href={`/dashboard/sandbox?list=${encodeURIComponent(list.id)}`}
                        onClick={() => setIsOpen(false)}
                        className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                          pathname === "/dashboard/sandbox" && selectedListId === list.id
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                        }`}
                      >
                        <Folder className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{list.name}</span>
                        <span className="ml-auto text-[10px] opacity-60">{list._count?.leads || 0}</span>
                      </Link>
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() => setOpenListMenuId((current) => current === list.id ? null : list.id)}
                          aria-label={`Manage ${list.name}`}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground group-hover:opacity-100 focus:opacity-100"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {openListMenuId === list.id && (
                          <div className="absolute right-0 top-8 z-[160] w-32 overflow-hidden rounded-lg border border-border/70 bg-[#111111] p-1 shadow-2xl shadow-black/60">
                            <button
                              type="button"
                              onClick={() => handleRenameList(list)}
                              className="w-full rounded-md px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-muted/70"
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDuplicateList(list)}
                              className="w-full rounded-md px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-muted/70"
                            >
                              Duplicate
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteList(list)}
                              className="w-full rounded-md px-3 py-2 text-left text-xs text-red-400 transition-colors hover:bg-red-500/10"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-border/50 shrink-0">
        <Link
          href="/login"
          onClick={() => setIsOpen(false)}
          className="flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-150 w-full"
        >
          <LogOut className="w-5 h-5" />
          Sign Out
        </Link>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* ─── Mobile Top Bar (visible < md) ─────────────────────────── */}
      <div className="fixed top-0 left-0 right-0 z-[100] h-16 border-b border-border/50 bg-card/80 backdrop-blur-xl flex items-center justify-between px-4 md:hidden">
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
            className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => setIsOpen(false)}
          />
          {/* Slide-in panel */}
          <aside className="fixed inset-y-0 left-0 z-[100] w-72 bg-card/95 backdrop-blur-xl border-r border-border/50 flex flex-col md:hidden animate-in slide-in-from-left duration-200">
            {SidebarContent}
          </aside>
        </>
      )}

      {/* ─── Desktop Sidebar (visible >= md) ──────────────────────── */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 z-50 w-72 border-r border-border/50 bg-card/30 backdrop-blur-xl flex-col">
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
        <div className="px-4 py-4 sm:px-6 sm:py-6 md:p-8">{children}</div>
      </main>

    </div>
  );
}

function DashboardLayoutFallback({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="fixed inset-x-0 top-0 z-[100] flex h-16 items-center border-b border-border/50 bg-card/80 px-4 backdrop-blur-xl md:hidden">
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-[#242424] bg-[#1A1A1A] p-1.5">
            <Zap className="h-4 w-4 text-[#FF5A1F]" />
          </div>
          <span className="font-heading text-lg font-bold tracking-wide text-white">FrameLeads</span>
        </div>
      </div>

      <aside className="fixed inset-y-0 left-0 z-50 hidden w-72 flex-col border-r border-border/50 bg-card/30 backdrop-blur-xl md:flex">
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border/50 px-6">
          <div className="rounded-xl border border-[#242424] bg-[#1A1A1A] p-2">
            <Zap className="h-5 w-5 text-[#FF5A1F]" />
          </div>
          <span className="font-heading text-xl font-bold tracking-wide text-white">FrameLeads</span>
        </div>
        <div className="space-y-3 px-5 py-6">
          {[1, 2, 3, 4, 5, 6, 7].map((item) => (
            <div key={item} className="h-11 animate-pulse rounded-xl bg-[#1A1A1A]" />
          ))}
        </div>
      </aside>

      <main className="min-h-screen pt-16 md:ml-72 md:pt-0">
        <div className="hidden h-16 items-center border-b border-border/50 bg-card/30 px-8 backdrop-blur-xl md:flex">
          <div className="h-3 w-24 animate-pulse rounded bg-[#242424]" />
        </div>
        <div className="px-4 py-4 sm:px-6 sm:py-6 md:p-8">{children}</div>
      </main>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<DashboardLayoutFallback>{children}</DashboardLayoutFallback>}>
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </Suspense>
  );
}
