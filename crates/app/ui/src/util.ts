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

// The keys in text pasted at once, mirroring upstream's splitKeys: one a
// line, or separated by commas, semicolons or spaces; quotes stripped and
// dupes dropped so key slots (and their weights/limits) stay aligned.
export function splitKeys(text: string): string[] {
  const out: string[] = [];
  for (let f of String(text).split(/[,;，；\s\u3000]+/)) {
    f = f.replace(/^["'`]+|["'`]+$/g, "");
    if (f && !out.includes(f)) out.push(f);
  }
  return out;
}

// Origin helpers mirroring upstream's local-provider "Server address":
// one box moving every URL's origin while keeping its path. With a
// single base URL the same edit rewrites just its origin.
const withScheme = (s: string) =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`;

export function originOfUrl(value: string): string {
  const s = String(value).trim();
  if (!s) return "";
  try {
    const u = new URL(withScheme(s));
    return u.origin === "null" ? "" : u.origin;
  } catch {
    return "";
  }
}

export function withOriginUrl(url: string, origin: string): string {
  const o = String(origin).trim().replace(/\/+$/, "");
  if (!o) return url;
  try {
    const base = String(url).trim() || "http://localhost/";
    const u = new URL(withScheme(base));
    const nu = new URL(withScheme(o));
    u.protocol = nu.protocol;
    u.hostname = nu.hostname;
    u.port = nu.port;
    return u.toString();
  } catch {
    return url;
  }
}

export interface CurlFill {
  baseUrl: string;
  key: string;
}

// A pasted curl command fills the form, mirroring upstream's fromCurl:
// the request URL gives the base URL (request path stripped), an auth
// header the key. Placeholders and variable references are never keys.
export function curlFill(text: string): CurlFill | null {
  const raw = String(text);
  if (!/(^|\s|[;&|])curl(\s|$)/i.test(raw)) return null;
  const flat = raw.replace(/\\\r?\n/g, " ");
  const out: CurlFill = { baseUrl: "", key: "" };
  const urlAt = flat.search(/--url\s+|(?:^|\s)(?:-X\s+\w+\s+)?https?:\/\//i);
  if (urlAt >= 0) {
    const slice = flat.slice(urlAt).replace(/^--url\s+/i, "").trim();
    const m = slice.match(/https?:\/\/[^\s'"<>\\]+/i);
    if (m) {
      let u = m[0].replace(/[),;]+$/, "");
      try {
        const parsed = new URL(u);
        const cut = ["/chat/completions", "/messages", "/responses"];
        let path = parsed.pathname;
        for (const tail of cut) {
          if (path.toLowerCase().endsWith(tail)) {
            path = path.slice(0, -tail.length);
            break;
          }
        }
        const mi = path.toLowerCase().indexOf("/models/");
        if (mi >= 0) path = path.slice(0, mi);
        const oi = path.toLowerCase().indexOf("/openai/deployments");
        if (oi >= 0) path = path.slice(0, oi);
        if (path.length > 1) path = path.replace(/\/+$/, "");
        out.baseUrl = parsed.origin + (path === "/" ? "" : path);
      } catch {
        out.baseUrl = "";
      }
    }
  }
  const hm = flat.match(/authorization\s*:\s*bearer\s+([^\s'"<>;|&\\]+)/i) ||
    flat.match(/(?:x-api-key|api-key)\s*:\s*([^\s'"<>;|&\\]+)/i);
  if (hm) {
    const k = hm[1].replace(/[,)]+$/, "");
    const bad = /^(<.*>|[{}$%].*|.*[{}$%<>].*|your[-_].*|.*your[-_].*|xxx+|\*+|test|example|change-?me|replace-?me|insert[-_].*|sk-your.*|key[-_]?here)$/i;
    if (k && !bad.test(k)) out.key = k;
  }
  if (!out.baseUrl && !out.key) return null;
  return out;
}
