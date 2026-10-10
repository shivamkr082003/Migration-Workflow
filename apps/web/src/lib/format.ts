export const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

export const relTime = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

export const short = (hash: string | null | undefined, n = 10) => (hash ? hash.slice(0, n) : "—");

export const pct = (part: number, total: number) => (total ? `${((part / total) * 100).toFixed(1)}%` : "0%");

export function display(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return v === "" ? '""' : v;
  return JSON.stringify(v);
}
