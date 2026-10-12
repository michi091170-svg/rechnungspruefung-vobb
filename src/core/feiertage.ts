/**
 * Gesetzliche Feiertage in Deutschland für die Fristberechnung nach § 193 BGB.
 * Maßgeblich ist der Erklärungs- bzw. Leistungsort; die App verwendet das Bundesland der Baustelle.
 * Regional begrenzte Feiertage (Mariä Himmelfahrt in Bayern nur in Gemeinden mit überwiegend
 * katholischer Bevölkerung, Fronleichnam in Teilen Sachsens und Thüringens, Augsburger Friedensfest)
 * sind bewusst nicht landesweit angesetzt.
 */

export const BUNDESLAENDER: [string, string][] = [
  ["", "– nur bundeseinheitliche Feiertage –"],
  ["BW", "Baden-Württemberg"], ["BY", "Bayern"], ["BE", "Berlin"], ["BB", "Brandenburg"],
  ["HB", "Bremen"], ["HH", "Hamburg"], ["HE", "Hessen"], ["MV", "Mecklenburg-Vorpommern"],
  ["NI", "Niedersachsen"], ["NW", "Nordrhein-Westfalen"], ["RP", "Rheinland-Pfalz"], ["SL", "Saarland"],
  ["SN", "Sachsen"], ["ST", "Sachsen-Anhalt"], ["SH", "Schleswig-Holstein"], ["TH", "Thüringen"],
];

const iso = (y: number, m: number, d: number): string => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function plus(y: number, m: number, d: number, n: number): string {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Ostersonntag (gregorianisch, Algorithmus nach Meeus/Jones/Butcher). */
export function ostersonntag(y: number): string {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, month, day);
}

/** Buß- und Bettag: Mittwoch vor dem 23. November. */
function bussUndBettag(y: number): string {
  const d = new Date(Date.UTC(y, 10, 22));
  while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const cache = new Map<string, Map<string, string>>();

/** Alle gesetzlichen Feiertage eines Jahres als Map ISO-Datum → Bezeichnung. */
export function feiertage(y: number, land = ""): Map<string, string> {
  const key = `${y}|${land}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [oy, om, od] = ostersonntag(y).split("-").map(Number);
  const os = (n: number) => plus(oy, om, od, n);
  const F = new Map<string, string>([
    [iso(y, 1, 1), "Neujahr"],
    [os(-2), "Karfreitag"],
    [os(1), "Ostermontag"],
    [iso(y, 5, 1), "Tag der Arbeit"],
    [os(39), "Christi Himmelfahrt"],
    [os(50), "Pfingstmontag"],
    [iso(y, 10, 3), "Tag der Deutschen Einheit"],
    [iso(y, 12, 25), "1. Weihnachtsfeiertag"],
    [iso(y, 12, 26), "2. Weihnachtsfeiertag"],
  ]);
  const add = (d: string, n: string, ...laender: string[]) => { if (laender.includes(land)) F.set(d, n); };
  add(iso(y, 1, 6), "Heilige Drei Könige", "BW", "BY", "ST");
  if (y >= 2019) add(iso(y, 3, 8), "Internationaler Frauentag", "BE");
  if (y >= 2023) add(iso(y, 3, 8), "Internationaler Frauentag", "MV");
  add(os(0), "Ostersonntag", "BB");
  add(os(49), "Pfingstsonntag", "BB");
  add(os(60), "Fronleichnam", "BW", "BY", "HE", "NW", "RP", "SL");
  add(iso(y, 8, 15), "Mariä Himmelfahrt", "SL");
  if (y >= 2019) add(iso(y, 9, 20), "Weltkindertag", "TH");
  add(iso(y, 10, 31), "Reformationstag", "BB", "MV", "SN", "ST", "TH");
  if (y >= 2018) add(iso(y, 10, 31), "Reformationstag", "HB", "HH", "NI", "SH");
  add(iso(y, 11, 1), "Allerheiligen", "BW", "BY", "NW", "RP", "SL");
  add(bussUndBettag(y), "Buß- und Bettag", "SN");
  cache.set(key, F);
  return F;
}

export const feiertagName = (d: string, land = ""): string | undefined => feiertage(Number(d.slice(0, 4)), land).get(d);
