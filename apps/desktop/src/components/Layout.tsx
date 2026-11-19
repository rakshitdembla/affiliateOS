import { NavLink, Outlet } from "react-router-dom";
import { LayoutDashboard, Package, Layers, AtSign, Zap, Inbox, BarChart3, ScrollText, Settings } from "lucide-react";
import { cn } from "../lib/utils";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/products", label: "Products", icon: Package },
  { to: "/collections", label: "Collections", icon: Layers },
  { to: "/instagram", label: "Instagram", icon: AtSign },
  { to: "/automations", label: "Automations", icon: Zap },
  { to: "/queue", label: "Message Queue", icon: Inbox },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/logs", label: "Logs", icon: ScrollText },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Layout() {
  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-surface px-3 py-4">
        <div data-tauri-drag-region className="mb-6 px-2 pt-6 text-lg font-semibold tracking-tight">AffiliateOS</div>
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn("flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted hover:bg-stone-100 hover:text-ink", isActive && "bg-stone-100 font-medium text-ink")
              }
            >
              <Icon size={16} aria-hidden /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto px-2 text-xs text-muted">v0.1.0 · Phase 1</div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
