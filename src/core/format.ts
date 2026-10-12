import { feiertagName } from "./feiertage";
import type { NumIn } from "./types";

export const uid = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
    : Math.random().toString(36).slice(2, 10);

export const round2 = (x: number): number => Math.round((x + Number.EPSILON) * 100) / 100;

export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export const eur = (n: NumIn): string => (Number(n) || 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });

export const fmtN = (n: NumIn, d = 3): string => (Number(n) || 0).toLocaleString("de-DE", { maximumFractionDigits: d });

export const fmtIn = (n: NumIn, d = 3, min = 0): string =>
  n === "" || n == null || isNaN(Number(n))
    ? ""
    : Number(n).toLocaleString("de-DE", { maximumFractionDigits: d, minimumFractionDigits: min, useGrouping: false });

/** Liest Zahlen tolerant: 1.234,56 · 1234,56 · 1.234 · 1234.56 · „12 €“. Ungültiges ergibt 0. */
export function num(v: NumIn): number {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  let s = String(v ?? "").trim().replace(/\s|€/g, "");
  if (!s) return 0;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

export const numOrNull = (v: NumIn): number | null =>
  v === null || v === undefined || v === "" ? null : typeof v === "number" ? v : num(v);

export const todayISO = (): string => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

export function addDays(iso: string, n: NumIn): string {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + Number(n || 0));
  return d.toISOString().slice(0, 10);
}

/** § 193 BGB: Fristende an Sa/So → nächster Werktag (Feiertage nicht berücksichtigt). */
export function shiftWeekend(iso: string): { d: string; shifted: boolean } {
  if (!iso) return { d: "", shifted: false };
  const d = new Date(iso + "T12:00:00");
  const w = d.getDay();
  if (w === 6) d.setDate(d.getDate() + 2);
  else if (w === 0) d.setDate(d.getDate() + 1);
  const out = d.toISOString().slice(0, 10);
  return { d: out, shifted: out !== iso };
}

/**
 * § 193 BGB: Fällt das Fristende auf Samstag, Sonntag oder einen am Leistungsort staatlich
 * anerkannten allgemeinen Feiertag, tritt der nächste Werktag an seine Stelle.
 */
export function shiftFrist(iso: string, land = ""): { d: string; shifted: boolean; grund: string } {
  if (!iso) return { d: "", shifted: false, grund: "" };
  const d = new Date(iso + "T12:00:00");
  const gruende: string[] = [];
  for (let k = 0; k < 10; k++) {
    const cur = d.toISOString().slice(0, 10), w = d.getDay(), ft = feiertagName(cur, land);
    if (w === 6) gruende.push("Samstag");
    else if (w === 0) gruende.push("Sonntag");
    else if (ft) gruende.push(ft);
    else break;
    d.setDate(d.getDate() + 1);
  }
  const out = d.toISOString().slice(0, 10);
  return { d: out, shifted: out !== iso, grund: [...new Set(gruende)].join(", ") };
}

/** Werktage im Sinne der VOB/B: Montag bis Samstag, ohne gesetzliche Feiertage. */
export function addWerktage(iso: string, n: number, land = ""): string {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  let k = 0;
  while (k < n) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && !feiertagName(d.toISOString().slice(0, 10), land)) k++;
  }
  return d.toISOString().slice(0, 10);
}

export const fmtD = (iso: string | null | undefined): string => (iso ? iso.split("-").reverse().join(".") : "–");

export const daysBetween = (a: string, b: string): number =>
  Math.round((new Date(b + "T12:00:00").getTime() - new Date(a + "T12:00:00").getTime()) / 86400000);

/** Regelverjährung §§ 195, 199 BGB: Jahresende des Entstehungsjahres + 3 Jahre. */
export const yearEnd3 = (iso: string): string => (iso ? `${Number(iso.slice(0, 4)) + 3}-12-31` : "");

export function toISODate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})$/);
  if (!m) return null;
  let y = +m[3];
  if (y < 100) y += 2000;
  const mo = +m[2], d = +m[1];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
