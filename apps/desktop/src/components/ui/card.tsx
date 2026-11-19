import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export const Card = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("rounded-xl border border-border bg-surface p-5", className)} {...p} />
);

const tones = {
  ok: "bg-green-50 text-ok border-green-200",
  warn: "bg-amber-50 text-warn border-amber-200",
  bad: "bg-red-50 text-bad border-red-200",
  neutral: "bg-stone-100 text-muted border-border",
} as const;

export const Badge = ({ tone = "neutral", children }: { tone?: keyof typeof tones; children: React.ReactNode }) => (
  <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>
);
