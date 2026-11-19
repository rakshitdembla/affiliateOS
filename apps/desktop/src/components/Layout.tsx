import { NavLink, Outlet } from "react-router-dom";
import { LayoutDashboard, Package, Layers, AtSign, Zap, Inbox, BarChart3, ScrollText, Settings } from "lucide-react";
import { cn } from "../lib/utils";
import { useEngine } from "../engine";
import { ENGINE_LABEL } from "../lib/queueLabels";

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
  const snap = useEngine();
  const dot = { idle: "bg-ok", sending: "bg-ok", cooldown: "bg-warn", blocked: "bg-warn", offline: "bg-bad", paused: "bg-stone-400", stopped: "bg-stone-300" }[snap.state];
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
        <NavLink to="/queue" className="mt-auto flex items-center gap-2 rounded-md px-2 py-2 text-xs text-muted hover:bg-stone-100" title={snap.reason ?? ENGINE_LABEL[snap.state]}>
          <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} aria-hidden />
          <span className="truncate">Queue: {ENGINE_LABEL[snap.state]}</span>
        </NavLink>
        <div className="px-2 pt-1 text-xs text-muted">v{__APP_VERSION__}</div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
