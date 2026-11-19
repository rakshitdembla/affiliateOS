import { useEffect, type ReactNode } from "react";
import { Button } from "./ui/button";

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`max-h-[90vh] w-full overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-xl ${wide ? "max-w-2xl" : "max-w-md"}`}>
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = "Delete", busy, onConfirm, onCancel }: { title: string; message: string; confirmLabel?: string; busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Dialog title={title} onClose={onCancel}>
      <p className="text-sm text-muted">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button onClick={onConfirm} disabled={busy} className="bg-bad hover:bg-red-800">{busy ? "Working…" : confirmLabel}</Button>
      </div>
    </Dialog>
  );
}
