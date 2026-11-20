import { useState } from "react";
import type { DailyPoint } from "@affiliateos/shared";

/** Single-series daily bar chart: thin rounded bars, recessive axis, hover tooltip, table view. */
export function DailyChart({ data, metric, label }: { data: DailyPoint[]; metric: keyof Omit<DailyPoint, "day">; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 720, H = 180, PAD_B = 22, PAD_T = 12;
  const max = Math.max(1, ...data.map((d) => d[metric]));
  const step = W / Math.max(1, data.length);
  const bw = Math.max(2, Math.min(28, step - 2));
  const y = (v: number) => PAD_T + (H - PAD_B - PAD_T) * (1 - v / max);
  const total = data.reduce((s, d) => s + d[metric], 0);
  const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const tickEvery = Math.ceil(data.length / 8);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-muted">
        <span>{label}: {total} in this period</span>
        <button className="underline" onClick={() => setTable((t) => !t)}>{table ? "Show chart" : "Show table"}</button>
      </div>
      {table ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-left text-sm"><thead className="text-xs text-muted"><tr><th className="py-1">Day</th><th className="text-right">{label}</th></tr></thead>
            <tbody className="divide-y divide-border">{data.map((d) => <tr key={d.day}><td className="py-1">{fmtDay(d.day)}</td><td className="text-right tabular-nums">{d[metric]}</td></tr>)}</tbody></table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${label} per day, ${total} total`} onMouseLeave={() => setHover(null)}>
            <line x1={0} x2={W} y1={H - PAD_B} y2={H - PAD_B} stroke="#e7e5e4" />
            <line x1={0} x2={W} y1={PAD_T} y2={PAD_T} stroke="#f5f5f4" />
            <text x={W} y={PAD_T - 2} textAnchor="end" fontSize="10" fill="#a8a29e">{max}</text>
            {data.map((d, i) => {
              const x = i * step + (step - bw) / 2;
              const top = y(d[metric]);
              const h = H - PAD_B - top;
              return (
                <g key={d.day} onMouseEnter={() => setHover(i)}>
                  <rect x={i * step} y={0} width={step} height={H} fill="transparent" />
                  {d[metric] > 0 && <path d={`M${x},${H - PAD_B} v${-Math.max(0, h - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${Math.max(0, h - 4)} z`} fill={hover === i ? "#1c1917" : "#57534e"} />}
                  {i % tickEvery === 0 && <text x={i === 0 ? i * step + (step - bw) / 2 : i * step + step / 2} y={H - 6} textAnchor={i === 0 ? "start" : "middle"} fontSize="10" fill="#a8a29e">{fmtDay(d.day)}</text>}
                </g>
              );
            })}
          </svg>
          {hover !== null && data[hover] && (
            <div role="tooltip" className="pointer-events-none absolute top-0 rounded-md border border-border bg-surface px-2 py-1 text-xs shadow-sm" style={{ left: `${Math.min(85, (hover / data.length) * 100)}%` }}>
              <div className="text-muted">{fmtDay(data[hover]!.day)}</div><div className="font-medium tabular-nums">{data[hover]![metric]} {label.toLowerCase()}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
