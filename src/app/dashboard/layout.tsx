"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Settings2,
  Upload,
  FlaskConical,
  Radar,
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
  ChevronDown,
} from "lucide-react";
import { clearCampaignContext } from "@/lib/campaign-session";

interface LeadListSummary {
  id: string;
  name: string;
  _count?: { leads: number };
}

type NavChild = { label: string; href: string };
const navItems: Array<{ label: string; href: string; icon: React.ElementType; children?: NavChild[] }> = [
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
    label: "Scout",
    href: "/dashboard/scout",
    icon: Radar,
    children: [
      { label: "Prospects", href: "/dashboard/scout" },
      { label: "ICP Profile", href: "/dashboard/scout/settings" },
      { label: "FrameLeads Brain", href: "/dashboard/brain" },
      { label: "Market Profiles", href: "/dashboard/market-profiles" },
    ],
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
    label: "Decision Sandbox",
    href: "/dashboard/decision-sandbox",
    icon: FlaskConical,
  },
  {
    label: "Outcome Learning",
    href: "/dashboard/outcome-learning",
    icon: Zap,
  },
  {
    label: "Governance",
    href: "/dashboard/governance",
    icon: Shield,
    children: [
      { label: "Overview", href: "/dashboard/governance" },
      { label: "Revenue Playbook", href: "/dashboard/playbook" },
      { label: "Sales Constitution", href: "/dashboard/constitution" },
      { label: "Automation", href: "/dashboard/automation" },
      { label: "Response SLA", href: "/dashboard/response-sla" },
    ],
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
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const pendingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedListId = searchParams.get("list");

  const prefetchRoute = useCallback((href: string) => router.prefetch(href), [router]);
  const beginNavigation = useCallback((href: string) => {
    if (pendingTimeout.current) clearTimeout(pendingTimeout.current);
    setPendingHref(href);
    pendingTimeout.current = setTimeout(() => {
      setPendingHref(current => current === href ? null : current);
      pendingTimeout.current = null;
    }, 12000);
  }, []);

  useEffect(() => {
    setPendingHref(null);
    if (pendingTimeout.current) clearTimeout(pendingTimeout.current);
    pendingTimeout.current = null;
  }, [pathname, selectedListId]);

  useEffect(() => () => {
    if (pendingTimeout.current) clearTimeout(pendingTimeout.current);
  }, []);

  useEffect(() => {
    for (const item of navItems) {
      if (item.children?.some(child => {
        const childPath = child.href.split("#")[0];
        return pathname === childPath || pathname.startsWith(`${childPath}/`);
      })) setExpandedGroups(current => ({ ...current, [item.href]: true }));
    }
  }, [pathname]);

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
          const childPaths = item.children?.map(child => child.href.split("#")[0]) ?? [];
          const isWithinGroup = childPaths.some(path => pathname === path || pathname.startsWith(`${path}/`));
          const isActive = (pathname === item.href || pathname.startsWith(`${item.href}/`) || isWithinGroup) && (!isSandbox || !selectedListId);
          const pendingPath = pendingHref?.split("?")[0];
          const isPending = pendingHref === item.href || pendingPath === item.href || (pendingPath ? childPaths.includes(pendingPath) : false);
          const childrenOpen = item.children?.length
            ? (Object.prototype.hasOwnProperty.call(expandedGroups, item.href) ? expandedGroups[item.href] : isWithinGroup)
            : false;
          return (
            <div key={item.href}>
              <div className="flex items-center gap-1">
                <Link
                  href={item.href}
                  onClick={() => { beginNavigation(item.href); setIsOpen(false); }}
                  onMouseEnter={() => prefetchRoute(item.href)}
                  onFocus={() => prefetchRoute(item.href)}
                  className={`flex min-w-0 flex-1 items-center gap-3 rounded-xl px-4 py-3 text-base font-medium transition-colors duration-150 ${
                    isPending
                      ? "border border-[#FF5A1F]/30 bg-[#FF5A1F]/10 text-white"
                      : isActive
                      ? "border border-primary/20 bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {isPending && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#FF5A1F]" aria-label="Loading" />}
                </Link>
                {item.children?.length ? <button type="button"
                  aria-label={`${childrenOpen ? "Collapse" : "Expand"} ${item.label} navigation`}
                  aria-expanded={childrenOpen} aria-controls={`nav-children-${item.label.toLowerCase()}`}
                  onClick={() => setExpandedGroups(current => ({ ...current, [item.href]: !childrenOpen }))}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]">
                  <ChevronDown className={`h-4 w-4 transition-transform duration-150 ${childrenOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                </button> : null}
              </div>
              {item.children?.length && childrenOpen ? <div id={`nav-children-${item.label.toLowerCase()}`} className="ml-7 mt-1 space-y-1 border-l border-border/50 pl-3">
                {item.children.map(child => {
                  const childPath = child.href.split("#")[0];
                  const childActive = pathname === childPath;
                  const childPending = pendingHref === child.href;
                  return <Link key={child.href} href={child.href} onClick={() => { beginNavigation(child.href); setIsOpen(false); setExpandedGroups(current => ({ ...current, [item.href]: true })); }}
                    onMouseEnter={() => prefetchRoute(child.href)} onFocus={() => prefetchRoute(child.href)}
                    aria-current={childActive ? "page" : undefined}
                    className={`flex min-h-10 items-center justify-between gap-2 rounded-lg px-3 py-2 text-[13px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F] ${childPending
                      ? "border-l-2 border-[#FF5A1F] bg-[#1A1A1A] text-white"
                      : childActive
                      ? "border-l-2 border-[#FF5A1F] bg-[#1A1A1A] text-white"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                    <span className="truncate">{child.label}</span>{childPending && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#FF5A1F]" aria-label="Loading" />}
                  </Link>;
                })}
              </div> : null}
              {isSandbox && pathname.startsWith("/dashboard/sandbox") && (
                <div className="ml-7 mt-1 space-y-1 border-l border-border/50 pl-3">
                  {lists.map((list) => (
                    <div key={list.id} className="group flex items-center gap-1">
                      <Link
                        href={`/dashboard/sandbox?list=${encodeURIComponent(list.id)}`}
                        onClick={() => { beginNavigation(`/dashboard/sandbox?list=${encodeURIComponent(list.id)}`); setIsOpen(false); }}
                        onMouseEnter={() => prefetchRoute(`/dashboard/sandbox?list=${encodeURIComponent(list.id)}`)}
                        onFocus={() => prefetchRoute(`/dashboard/sandbox?list=${encodeURIComponent(list.id)}`)}
                        className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                          pendingHref === `/dashboard/sandbox?list=${encodeURIComponent(list.id)}`
                            ? "bg-[#FF5A1F]/10 text-white"
                            : pathname === "/dashboard/sandbox" && selectedListId === list.id
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                        }`}
                      >
                        <Folder className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{list.name}</span>
                        <span className="ml-auto text-[10px] opacity-60">{list._count?.leads || 0}</span>
                        {pendingHref === `/dashboard/sandbox?list=${encodeURIComponent(list.id)}` && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#FF5A1F]" aria-label="Loading" />}
                      </Link>
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() => setOpenListMenuId((current) => current === list.id ? null : list.id)}
                          aria-label={`Manage ${list.name}`}
                          className="flex h-10 w-10 md:h-7 md:w-7 items-center justify-center rounded-md text-muted-foreground opacity-100 transition-all hover:bg-muted hover:text-foreground md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
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
          onClick={() => { clearCampaignContext(); setIsOpen(false); }}
          className="flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-150 w-full"
        >
          <LogOut className="w-5 h-5" />
          Sign Out
        </Link>
      </div>
    </>
  );

  return (
    <div className="min-h-dvh max-w-full overflow-x-clip bg-background md:overflow-x-visible">
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
          className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
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
      <main className="min-h-dvh w-full min-w-0 max-w-full pt-16 md:ml-72 md:w-auto md:pt-0">
        {/* Desktop page title bar */}
        <div className="hidden md:flex h-16 border-b border-border/50 bg-card/30 backdrop-blur-xl items-center px-8">
          <h2 className="text-sm font-medium text-muted-foreground">
            {navItems.find((i) => pathname.startsWith(i.href))?.label ||
              "Dashboard"}
          </h2>
        </div>
        <div className="w-full min-w-0 max-w-full px-4 py-4 sm:px-6 sm:py-6 md:p-8">{children}</div>
      </main>

    </div>
  );
}

function DashboardLayoutFallback({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh max-w-full overflow-x-clip bg-background md:overflow-x-visible">
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

      <main className="min-h-dvh w-full min-w-0 max-w-full pt-16 md:ml-72 md:w-auto md:pt-0">
        <div className="hidden h-16 items-center border-b border-border/50 bg-card/30 px-8 backdrop-blur-xl md:flex">
          <div className="h-3 w-24 animate-pulse rounded bg-[#242424]" />
        </div>
        <div className="w-full min-w-0 max-w-full px-4 py-4 sm:px-6 sm:py-6 md:p-8">{children}</div>
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
