export function formatPrice(minor: number | null, currency = "INR"): string {
  if (minor === null) return "Price unavailable";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
}
/** "1,299.50" or "₹1299" → minor units; null if empty/invalid. */
export function parsePriceInput(v: string): number | null | "invalid" {
  const t = v.replace(/[₹,\s]/g, "");
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return "invalid";
  return Math.round(Number(t) * 100);
}
export const minorToInput = (m: number | null): string => (m === null ? "" : (m / 100).toString());

export const PLATFORM_LABEL: Record<string, string> = { amazon: "Amazon", myntra: "Myntra", meesho: "Meesho" };
export const ERROR_HELP: Record<string, string> = {
  invalid_url: "That isn't a valid https link.",
  unsupported_url: "Only Amazon, Myntra and Meesho links are supported.",
  redirect_unresolved: "The link redirected somewhere that couldn't be followed safely.",
  site_unreachable: "The website couldn't be reached or the page wasn't found.",
  extraction_blocked: "The website blocked automated access. Enter the details manually.",
  product_unavailable: "The product looks unavailable on the website.",
  adapter_not_implemented: "This platform isn't implemented yet.",
  parse_failed: "No product details could be read from the page.",
};

export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (s < 0) return `in ${fmtDuration(-s)}`;
  if (s < 10) return "just now";
  return `${fmtDuration(s)} ago`;
}
export function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86_400) return `${Math.round(sec / 360) / 10}h`;
  return `${Math.round(sec / 8640) / 10}d`;
}
