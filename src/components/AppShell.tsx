"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

type WorkspaceId = "cash" | "suppliers";

const WORKSPACES: { id: WorkspaceId; label: string; home: string; hint: string }[] = [
  { id: "cash", label: "Cash", home: "/", hint: "O2C & P2P" },
  { id: "suppliers", label: "Suppliers", home: "/suppliers", hint: "Master data" },
];

const NAV: Record<WorkspaceId, { href: string; label: string; icon: string }[]> = {
  cash: [
    { href: "/", label: "Cash Position", icon: "M3 12h4l2 5 4-13 2 8h6" },
    { href: "/reconciliation", label: "Reconciliation", icon: "M4 7h16M4 12h16M4 17h10" },
    { href: "/anomalies", label: "Anomalies", icon: "M12 3l9 16H3l9-16zm0 6v4m0 3h.01" },
    { href: "/statements", label: "Statements", icon: "M6 3h9l4 4v14H6zM14 3v5h5" },
  ],
  suppliers: [
    { href: "/suppliers", label: "Overview", icon: "M4 19V5m0 14h16M8 15l3-4 3 3 4-6" },
    {
      href: "/suppliers/records",
      label: "Records",
      icon: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
    },
    {
      href: "/suppliers/review",
      label: "Review",
      icon: "M9 5H7a2 2 0 00-2 2v12l3-1.5L11 19l3-1.5L17 19V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
    },
    {
      href: "/suppliers/audit",
      label: "Audit",
      icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
    },
    {
      href: "/suppliers/fbdi",
      label: "FBDI",
      icon: "M14 3h7v7M14 10l7-7M5 12v7a2 2 0 002 2h10M5 8V5a2 2 0 012-2h5",
    },
  ],
};

const SHARED = [
  { href: "/files", label: "Files", icon: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" },
  { href: "/integrations", label: "Integrations", icon: "M12 3v6m0 6v6M3 12h6m6 0h6" },
];

function workspaceFromPath(pathname: string): WorkspaceId {
  if (pathname === "/suppliers" || pathname.startsWith("/suppliers/")) return "suppliers";
  return "cash";
}

function navActive(pathname: string, href: string): boolean {
  if (href === "/" || href === "/suppliers") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const workspace = workspaceFromPath(pathname);
  const items = NAV[workspace];
  const hint = WORKSPACES.find((w) => w.id === workspace)?.hint ?? "";

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col bg-slate-900 text-slate-200 md:flex">
        <div className="flex items-center gap-3 px-6 py-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-400 to-sky-400 font-bold text-slate-900">
            a
          </div>
          <div>
            <div className="text-lg font-semibold leading-tight">aggcenter</div>
            <div className="text-xs text-slate-400">Aggregation Center</div>
          </div>
        </div>

        <div className="px-3 pb-3">
          <div className="flex rounded-lg bg-slate-800 p-1">
            {WORKSPACES.map((ws) => (
              <button
                key={ws.id}
                type="button"
                onClick={() => {
                  if (ws.id !== workspace) router.push(ws.home);
                }}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
                  workspace === ws.id
                    ? "bg-slate-700 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {ws.label}
              </button>
            ))}
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {items.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={navActive(pathname, item.href)}
            />
          ))}
          <div className="pt-3">
            <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Platform
            </div>
            {SHARED.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={navActive(pathname, item.href)}
              />
            ))}
          </div>
        </nav>
        <div className="px-6 py-4 text-xs text-slate-500">
          {workspace === "cash" ? `Cash Position · ${hint}` : `Suppliers · ${hint}`}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-6 py-3 md:hidden">
          <span className="text-base font-semibold">aggcenter</span>
          <div className="ml-auto flex rounded-lg border border-slate-200 p-0.5 text-xs">
            {WORKSPACES.map((ws) => (
              <Link
                key={ws.id}
                href={ws.home}
                className={`rounded-md px-2 py-1 font-medium ${
                  workspace === ws.id ? "bg-slate-900 text-white" : "text-slate-600"
                }`}
              >
                {ws.label}
              </Link>
            ))}
          </div>
        </header>
        <main className="flex-1 overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function NavLink({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-slate-800 text-white"
          : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
      }`}
    >
      <svg
        className="h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={icon} />
      </svg>
      {label}
    </Link>
  );
}
