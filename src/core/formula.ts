/**
 * Aufmaß-Formeln: nur Zahlen, + - * / ( ), deutsches Komma und x/×/· als Malzeichen.
 * Eigener rekursiver Parser, kein eval. Ergebnis auf drei Nachkommastellen,
 * null bei leerer Eingabe, NaN bei ungültiger Eingabe.
 */
export function evalExpr(str: unknown): number | null {
  const s = String(str || "").replace(/\s+/g, "").replace(/[x×·]/g, "*").replace(/,/g, ".");
  if (!s) return null;
  if (!/^[0-9.+\-*/()]+$/.test(s)) return NaN;
  let i = 0;
  const fail = (): never => { throw new Error("syntax"); };
  const number = (): number => {
    const st = i;
    while (i < s.length && /[0-9.]/.test(s[i])) i++;
    if (st === i) fail();
    const t = s.slice(st, i);
    if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) fail(); // z. B. „1..2“ nicht still als 1 lesen
    const v = parseFloat(t);
    return v;
  };
  const factor = (): number => {
    if (s[i] === "-") { i++; return -factor(); }
    if (s[i] === "+") { i++; return factor(); }
    if (s[i] === "(") {
      i++;
      const v = expr();
      if (s[i] !== ")") fail();
      i++;
      return v;
    }
    return number();
  };
  const term = (): number => {
    let v = factor();
    while (s[i] === "*" || s[i] === "/") {
      const o = s[i++];
      const f = factor();
      v = o === "*" ? v * f : v / f;
    }
    return v;
  };
  const expr = (): number => {
    let v = term();
    while (s[i] === "+" || s[i] === "-") {
      const o = s[i++];
      const t = term();
      v = o === "+" ? v + t : v - t;
    }
    return v;
  };
  try {
    const v = expr();
    if (i !== s.length || !isFinite(v)) return NaN;
    return Math.round(v * 1000) / 1000;
  } catch {
    return NaN;
  }
}

export interface Term { sign: 1 | -1; text: string; v: number | null }

/** Oberste Summanden einer Aufmaßformel, Vorzeichen getrennt. */
export function topTerms(str: unknown): Term[] {
  const s = String(str || "").replace(/\s+/g, "").replace(/[x×·]/g, "*");
  const out: Term[] = [];
  let depth = 0, st = 0, sign: 1 | -1 = 1;
  for (let i = 0; i <= s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (i === s.length || ((c === "+" || c === "-") && depth === 0 && i > 0 && !"*/(".includes(s[i - 1]))) {
      let t = s.slice(st, i);
      if (t) {
        let sg = sign;
        if (t[0] === "+") t = t.slice(1);
        else if (t[0] === "-" && st === 0) { sg = -1; t = t.slice(1); }
        out.push({ sign: sg, text: t, v: evalExpr(t) });
      }
      sign = c === "-" ? -1 : 1;
      st = i + 1;
    }
  }
  return out;
}
