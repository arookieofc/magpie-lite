const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const compactNumber = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function fmt(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? number.format(n) : "—";
}

export function compact(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? compactNumber.format(n) : "—";
}

export function percent(part: number, whole: number): string {
  if (!whole) return "—";
  const p = (part / whole) * 100;
  return `${p >= 99.95 || p === 0 ? p.toFixed(0) : p.toFixed(1)}%`;
}

export function formatDuration(ms: number): string {
  if (ms === 0) return "Disabled";
  const s = Math.max(1, Math.ceil(ms / 1000));
  if (s >= 3600) return `${(s / 3600).toFixed(1)} h`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

export function initials(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9 ]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function hueOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

export function timeOf(unixMs?: number): string {
  if (!unixMs) return "—";
  return new Date(unixMs).toLocaleTimeString([], { hour12: false });
}

export function statusTone(status?: string): string {
  if (!status) return "";
  return status === "ok" ? "good" : "bad";
}
