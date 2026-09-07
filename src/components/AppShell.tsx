"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Cash Position", icon: "M3 12h4l2 5 4-13 2 8h6" },
  {
    href: "/reconciliation",
    label: "Reconciliation",
    icon: "M4 7h16M4 12h16M4 17h10",
  },
  {
    href: "/anomalies",
    label: "Anomalies",
    icon: "M12 3l9 16H3l9-16zm0 6v4m0 3h.01",
  },
  {
    href: "/statements",
    label: "Statements",
    icon: "M6 3h9l4 4v14H6zM14 3v5h5",
  },
  {
    href: "/integrations",
    label: "Integrations",
    icon: "M12 3v6m0 6v6M3 12h6m6 0h6",
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

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
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
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
                  <path d={item.icon} />
                </svg>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-6 py-4 text-xs text-slate-500">
          Cash Position · O2C &amp; P2P
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-6 py-3 md:hidden">
          <span className="text-base font-semibold">aggcenter</span>
        </header>
        <main className="flex-1 overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
