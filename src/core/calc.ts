import { addDays, esc, eur, fmtD, fmtN, num, round2, shiftFrist, todayISO } from "./format";
import { evalExpr, topTerms } from "./formula";
import { nlNT, seOn } from "./model";
import type { AufmassEintrag, Hint, HintLevel, Nachtrag, Position, Project, Rechnung } from "./types";
import { uebRules, unitKind } from "./vobc";

export interface InvRow {
  pos: Position;
  a: AufmassEintrag;
  an: number;
  gp: number;
  gpA: number;
  bAN: number;
  bGP: number;
  fErr: boolean;
  nt: Nachtrag | null;
  ntOk: boolean;
  flags: ("cut" | "warn")[];
}
export type InvResult = ReturnType<typeof calcInv>;

export function calcAll(p: Project) {
  const ntMap: Record<string, Nachtrag> = Object.fromEntries(p.nachtraege.map(n => [n.id, n]));
  const auftragNetto = round2(p.positions.filter(x => !x.nt).reduce((s,x) => s + round2(num(x.menge) * num(x.ep)), 0));
  const ntWert = (n: Nachtrag) => num(n.geprueft) > 0 ? num(n.geprueft) : num(n.angebot);
  const ntBeauftragt = round2(p.nachtraege.filter(n => n.status === "beauftragt").reduce((s,n) => s + ntWert(n), 0));
  const ntOffen = round2(p.nachtraege.filter(n => ["angekündigt","Angebot eingegangen","in Prüfung","zurückgestellt"].includes(n.status)).reduce((s,n) => s + num(n.angebot), 0));
  const auftragGesamt = round2(auftragNetto + ntBeauftragt);
  const auftragBrutto = chain(p, auftragGesamt, ntBeauftragt).brutto;
  const out: InvResult[] = []; let vor = 0;
  p.rechnungen.forEach((inv, idx) => { const r = calcInv(p, inv, idx, vor, auftragBrutto, auftragGesamt, ntMap, out[idx-1]); out.push(r); vor = round2(vor + r.anrechnung); });
  return { out, auftragNetto, ntBeauftragt, ntOffen, auftragGesamt, auftragBrutto, ntMap };
}
/** Kürzungskette netto → Nachlass → Umlage → USt. ntNet = darin enthaltener Nachtragsanteil. */
export function chain(p: Project, net: number, ntNet = 0) {
  const nlBasis = nlNT(p) ? net : round2(net - ntNet);
  const nl = round2(nlBasis * num(p.nachlass)/100), n1 = round2(net - nl);
  const ul = round2(n1 * num(p.umlage)/100), n2 = round2(n1 - ul);
  const ust = p.rc13b ? 0 : round2(n2 * num(p.ust)/100);
  return { net, nl, n1, ul, n2, ust, brutto: round2(n2 + ust) };
}
/** Kumulierte Prüfung einer Rechnung: Leistungsstand bis heute abzüglich Einbehalte und aller Vorzahlungen. */
export function calcInv(p: Project, inv: Rechnung, idx: number, vor: number, auftragBrutto: number, auftragGesamt: number, ntMap: Record<string, Nachtrag>, prev?: { rows: InvRow[] }) {
  const H: Hint[] = []; const add = (lvl: HintLevel, t: string) => { H.push({ lvl, t }); };
  const am: Record<string, AufmassEintrag> = inv.aufmass || {};
  const isSchluss = inv.art === "Schlussrechnung";
  const rows: InvRow[] = p.positions.map(pos => {
    const a: AufmassEintrag = am[pos.id] || {};
    const an = num(a.an);
    let gp = num(a.gp), fErr = false;
    if (a.formel && String(a.formel).trim()) { const v = evalExpr(a.formel); if (v === null || isNaN(v)) { fErr = true; gp = 0; } else gp = v; }
    const nt = pos.nt ? ntMap[pos.nt] : null;
    const ntOk = !nt || nt.status === "beauftragt";
    const gpA = ntOk ? gp : 0;
    const bAN = round2(an * num(pos.ep)), bGP = round2(gpA * num(pos.ep));
    const prevGp = prev ? (prev.rows.find(r => r.pos.id === pos.id)?.gp ?? 0) : 0;
    const flags: ("cut" | "warn")[] = [];
    if (!fErr && a.formel && String(a.formel).trim()) {
      const kd = unitKind(pos.eh), rl = kd ? uebRules(p, p.atv, kd).filter(r => r.g != null && (kd === "m" ? r.mode === "l" : kd === "m2" ? r.mode === "f" : r.mode === "v")) : [];
      const isBoden = kd === "m2" && rl.some(r => r.id === "boden") && /boden|dielung|estrich|schüttung|schuettung|belag|podest/i.test(pos.text || "");
      const rc = kd === "m2" && rl.some(r => r.id === "boden") ? rl.filter(r => isBoden ? r.id === "boden" : r.id !== "boden") : rl;
      if (rc.length) {
        const gMin = Math.min(...rc.map(r => r.g as number)), uL = kd === "m" ? "m" : kd === "m2" ? "m²" : "m³";
        const need = kd === "m" ? 1 : kd === "m2" ? 2 : 3;
        const small = topTerms(a.formel).map(t => { const mm = t.text.match(/^(\d+)\*(.+)$/); const multi = mm && !/[()+\-\/]/.test(t.text) && t.text.split("*").length > need; return { ...t, e: multi && mm ? evalExpr(mm[2]) : t.v }; }).filter(t => t.sign < 0 && t.e != null && t.e > 0 && t.e <= gMin + 1e-9);
        if (small.length) { flags.push("warn"); add("warn", `<b>Pos. ${esc(pos.oz)}:</b> Abzug ${small.map(t => `${esc(t.text.replace(/\./g, ","))} (Einzelgröße ${fmtN(t.e)} ${uL})`).join("; ")} liegt innerhalb der Übermessungsgrenze (≤ ${fmtN(gMin)} ${uL}${isBoden ? ", in Böden" : ""}) nach Abschnitt 5 ATV ${esc(p.atv)}. Ohne abweichende Regelung im LV wäre zu übermessen – die Kürzung ist so angreifbar.`); }
      }
    }
    if (fErr) { flags.push("cut"); add("cut", `<b>Pos. ${esc(pos.oz)}:</b> Aufmaß-Formel ist nicht auswertbar – Menge mit 0 angesetzt. Erlaubt sind Zahlen und + − × ÷ ( ).`); }
    if (nt && !ntOk && (gp > 0 || an > 0)) { flags.push("cut"); add("cut", `<b>Pos. ${esc(pos.oz)}</b> gehört zu ${esc(nt.nr)} (Status: ${esc(nt.status)}). Nicht beauftragte Nachtragsleistungen werden nicht anerkannt – Vergütung nur bei Beauftragung bzw. unter den Voraussetzungen des § 2 Abs. 8 VOB/B.`); }
    if (gp > an + 1e-9 && an > 0) { flags.push("warn"); add("warn", `<b>Pos. ${esc(pos.oz)}:</b> geprüfte Menge (${fmtN(gp)}) übersteigt die vom AN angesetzte Menge (${fmtN(an)}).`); }
    if (an > 0 && gp === 0 && !fErr && ntOk) flags.push("warn");
    if (num(pos.menge) > 0 && gp > num(pos.menge) * 1.1 && !pos.nt && pos.eh !== "psch") { flags.push("warn"); add("info", `<b>Pos. ${esc(pos.oz)}:</b> Mengenüberschreitung um ${fmtN((gp/num(pos.menge)-1)*100,1)} %. Nach § 2 Abs. 3 Nr. 2 VOB/B ist für die über 110 % hinausgehende Menge auf Verlangen ein neuer Preis zu vereinbaren.`); }
    if (isSchluss && num(pos.menge) > 0 && gp < num(pos.menge) * 0.9 && !pos.nt) add("info", `<b>Pos. ${esc(pos.oz)}:</b> Mengenunterschreitung > 10 %. Nach § 2 Abs. 3 Nr. 3 VOB/B kann der AN auf Verlangen eine Erhöhung des Einheitspreises verlangen.`);
    if (prev && gp < prevGp - 1e-9) add("info", `<b>Pos. ${esc(pos.oz)}:</b> geprüfte Menge geht gegenüber der Vorrechnung zurück (${fmtN(prevGp)} → ${fmtN(gp)}). Kumulierte Korrektur – bitte im Prüfvermerk begründen.`);
    return { pos, a, an, gp, gpA, bAN, bGP, fErr, nt, ntOk, flags };
  });
  const pAN = round2(num(inv.pauschalAN)), pGP = round2(num(inv.pauschalGP));
  const sumAN = round2(rows.reduce((s,r) => s + r.bAN, 0) + pAN);
  const sumGP = round2(rows.reduce((s,r) => s + r.bGP, 0) + pGP);
  if (pAN > 0 || pGP > 0) add("warn", `Pauschaler Abschlag ohne Positionsaufstellung (AN ${eur(pAN)}, anerkannt ${eur(pGP)} netto kumuliert). § 16 Abs. 1 Nr. 1 VOB/B: Abschlagszahlungen in Höhe des Werts der nachgewiesenen vertragsgemäßen Leistungen; die Leistungen sind durch eine prüfbare Aufstellung nachzuweisen. Leistungsstand je Position anfordern.`);
  if (pGP > pAN + 0.01) add("warn", "Anerkannter Pauschalbetrag übersteigt die Forderung des AN.");
  const ntAN = round2(rows.filter(r => r.pos.nt).reduce((s,r) => s + r.bAN, 0)), ntGP = round2(rows.filter(r => r.pos.nt).reduce((s,r) => s + r.bGP, 0));
  const cAN = chain(p, sumAN, ntAN), cGP = chain(p, sumGP, ntGP);
  if (num(p.nachlass) > 0 && (ntAN > 0 || ntGP > 0)) add("info", nlNT(p)
    ? `Nachlass ${fmtN(p.nachlass,2)} % wird auch auf Nachtragsleistungen (${eur(ntGP)} netto geprüft) angewendet. Ob ein Pauschalnachlass auf Nachträge fortwirkt, ist Auslegungsfrage und in Rechtsprechung und Literatur strittig – Einstellung unter „Vertrag & Konditionen“.`
    : `Nachlass ${fmtN(p.nachlass,2)} % nur auf den Hauptauftrag; Nachtragsleistungen (${eur(ntGP)} netto geprüft) ohne Nachlass. Die Gegenansicht (Fortschreibung des Nachlasses über § 2 Abs. 5/6 VOB/B) ist vertretbar – Einstellung unter „Vertrag & Konditionen“.`);

  let se = 0, seLabel = "", seCapped = false;
  if (!seOn(p)) {
    seLabel = "Kein Sicherheitseinbehalt – Sicherheitsleistung nicht vereinbart (§ 17 Abs. 1 Nr. 1 VOB/B)";
  } else if (!isSchluss) {
    seLabel = `Sicherheitseinbehalt ${fmtN(p.seSatz,2)} % (§ 17 Abs. 6 VOB/B)`;
    if (p.seBuergschaft) seLabel = "Sicherheitseinbehalt – durch Bürgschaft abgelöst (§ 17 Abs. 3 VOB/B)";
    else {
      se = round2(cGP.brutto * num(p.seSatz)/100);
      if (num(p.seDeckel) > 0) { const cap = round2(auftragBrutto * num(p.seDeckel)/100); if (se > cap) { se = cap; seCapped = true; } }
    }
  } else {
    seLabel = `Sicherheit für Mängelansprüche ${fmtN(p.gwSatz,2)} % (§ 17 VOB/B)`;
    if (p.gwBuergschaft) seLabel = "Sicherheit für Mängelansprüche – durch Bürgschaft abgelöst";
    else se = round2(cGP.brutto * num(p.gwSatz)/100);
  }
  const maengel = round2(num(inv.maengel)), sonst = round2(num(inv.sonst));
  const nachAbzug = round2(cGP.brutto - se - maengel - sonst);
  const zahlbetrag = round2(nachAbzug - vor);

  const skontoMoeglich = p.skontoVereinbart && (isSchluss || p.skontoAbschlag) && zahlbetrag > 0;
  const skonto = skontoMoeglich ? round2(zahlbetrag * num(p.skontoSatz)/100) : 0;
  const baRate = p.freistellung ? 0 : 0.15;
  const gegenMit = round2(zahlbetrag - skonto), baMit = round2(Math.max(gegenMit,0) * baRate), auszMit = round2(gegenMit - baMit);
  const baOhne = round2(Math.max(zahlbetrag,0) * baRate), auszOhne = round2(zahlbetrag - baOhne);

  const skF: { d: string; shifted: boolean; grund: string } = inv.eingang ? shiftFrist(addDays(inv.eingang, p.skontoTage), p.bundesland || "") : {d:"",shifted:false,grund:""};
  const zF: { d: string; shifted: boolean; grund: string } = inv.eingang ? shiftFrist(addDays(inv.eingang, isSchluss ? p.fristSchluss : p.fristAbschlag), p.bundesland || "") : {d:"",shifted:false,grund:""};

  const paidRecorded = num(inv.zahlBetrag) > 0;
  const skIst = (inv.skontoIst === "" || inv.skontoIst == null) ? null : round2(num(inv.skontoIst));
  let anrechnung: number, paid = 0, baPaid = 0, skPaid = 0;
  if (paidRecorded) {
    paid = round2(num(inv.zahlBetrag));
    baPaid = p.freistellung ? 0 : round2(paid * 15 / 85);
    skPaid = skIst != null ? skIst : (inv.skontoGezogen ? skonto : 0);
    anrechnung = round2(paid + baPaid + skPaid);
  } else anrechnung = Math.max(0, zahlbetrag);

  /* Hinweise */
  if (!inv.eingang) add("warn", "Zugangsdatum fehlt – Zahlungsfrist (§ 16 VOB/B) und Skontofrist können nicht berechnet werden.");
  if (p.skontoVereinbart && (num(p.skontoSatz) < 2 || num(p.skontoSatz) > 5)) add("warn", `Skontosatz ${fmtN(p.skontoSatz,2)} % liegt außerhalb der üblichen Spanne von 2–5 % (Erfahrungswert, keine Normvorgabe). Vertragliche Vereinbarung prüfen.`);
  if (!p.skontoVereinbart) add("info", "Kein Skonto angesetzt: Skontoabzüge sind nur zulässig, wenn sie vereinbart sind (§ 16 Abs. 5 Nr. 2 VOB/B).");
  if (sumGP > auftragGesamt + 0.01 && auftragGesamt > 0) add("warn", `Geprüfter Leistungsstand (${eur(sumGP)}) übersteigt die Auftragssumme inkl. beauftragter Nachträge (${eur(auftragGesamt)}).`);
  if (!inv.gemAufmass) add("info", "Kein gemeinsames Aufmaß vermerkt. § 14 Abs. 2 VOB/B: Feststellungen möglichst gemeinsam treffen – insbesondere bei Leistungen, die später nicht mehr feststellbar sind. Abrechnung nach Abschnitt 5 der ATV " + esc(p.atv) + ".");
  if (!seOn(p)) add("info", "Kein Sicherheitseinbehalt angesetzt: Eine Sicherheitsleistung ist nicht als vereinbart erfasst. Nach § 17 Abs. 1 Nr. 1 VOB/B nur bei vertraglicher Vereinbarung – Einstellung unter „Vertrag & Konditionen“.");
  if (se > 0 && !isSchluss) add("info", "Einbehalt dem AN mitteilen und binnen 18 Werktagen auf ein Sperrkonto einzahlen (§ 17 Abs. 6 Nr. 1 VOB/B); öffentliche AG dürfen den Betrag auf ein eigenes Verwahrgeldkonto nehmen (§ 17 Abs. 6 Nr. 4). Öffentliche AG: Vertragserfüllungssicherheit soll 5 %, Mängelsicherheit 3 % nicht überschreiten (§ 9c Abs. 2 VOB/A).");
  if (seCapped) add("info", `Einbehalt auf die vereinbarte Sicherheitssumme von ${fmtN(p.seDeckel,2)} % der Brutto-Auftragssumme (${eur(round2(auftragBrutto*num(p.seDeckel)/100))}) begrenzt.`);
  if (!p.freistellung) add("warn", "Keine Freistellungsbescheinigung (§ 48b EStG): 15 % Bauabzugsteuer vom Bruttobetrag einbehalten, bis zum 10. des Folgemonats anmelden und an das Finanzamt des AN abführen (§ 48a EStG).");
  if (p.freistellung && p.freistellungBis && p.freistellungBis < (inv.zahlDatum || todayISO())) add("cut", `Freistellungsbescheinigung nach § 48b EStG ist am ${fmtD(p.freistellungBis)} abgelaufen – ohne gültige Bescheinigung ist Bauabzugsteuer einzubehalten.`);
  if (p.rc13b) add("info", "Umsatzsteuer nicht ausgewiesen: Steuerschuldnerschaft des Leistungsempfängers nach § 13b UStG. Rechnung muss den Hinweis \"Steuerschuldnerschaft des Leistungsempfängers\" enthalten.");
  if (isSchluss) {
    add("info", "§ 16 Abs. 3 Nr. 1 VOB/B: Schlusszahlung spätestens 30 Tage nach Zugang der Schlussrechnung (bei ausdrücklicher Vereinbarung max. 60 Tage). Einwendungen gegen die Prüfbarkeit nur innerhalb dieser Frist unter Angabe der Gründe.");
    add("info", "§ 16 Abs. 3 Nr. 2–5 VOB/B: AN schriftlich über die Schlusszahlung unterrichten und auf die Ausschlusswirkung hinweisen; Vorbehalt des AN binnen 28 Tagen, Begründung binnen weiterer 28 Tage.");
    add("info", "Abnahme (§ 12 VOB/B) und ggf. Vorbehalt einer Vertragsstrafe bei Abnahme (§ 11 Abs. 4 VOB/B) prüfen." + (p.abnahme ? ` Abnahme vermerkt am ${fmtD(p.abnahme)}.` : " Kein Abnahmedatum erfasst."));
  } else {
    add("info", "§ 16 Abs. 1 VOB/B: Abschlagszahlungen auf Grundlage einer prüfbaren Aufstellung, fällig binnen 21 Tagen nach Zugang. Sie sind ohne Einfluss auf Haftung und gelten nicht als Abnahme von Teilen der Leistung (Abs. 1 Nr. 4).");
  }
  if (inv.forderung !== "" && inv.forderung != null && num(inv.forderung) > 0) {
    const d = round2(num(inv.forderung) - zahlbetrag);
    if (Math.abs(d) >= 0.01) add(d > 0 ? "warn" : "info", `Forderung laut Rechnung ${eur(num(inv.forderung))} – festgestellter Zahlbetrag ${eur(zahlbetrag)}: ${d > 0 ? "Kürzung" : "Mehrbetrag"} ${eur(Math.abs(d))}. Kürzungen positionsweise begründen.`);
  }
  if (zahlbetrag < 0) add("cut", `Überzahlung: bisherige Zahlungen übersteigen den kumuliert anerkannten Betrag um ${eur(-zahlbetrag)}. Rückforderung prüfen.`);
  if (paidRecorded) {
    if (!inv.zahlDatum) add("info", "Zahlungsdatum fehlt – Skontoberechtigung (Fristwahrung) und Verzug sind nicht prüfbar. Datum lt. Kontoauszug eintragen.");
    if (skIst != null && skontoMoeglich && skIst > skonto + 0.01) add("warn", `Abgezogenes Skonto ${eur(skIst)} übersteigt ${fmtN(p.skontoSatz,2)} % des festgestellten Zahlbetrags (${eur(skonto)}) um ${eur(round2(skIst - skonto))} – Aufteilung klären (z. B. nachträglicher Skontoabzug zu einer Vorrechnung).`);
    if (skPaid > 0 && !skontoMoeglich) add("cut", "Skonto wurde gezogen, ist für diese Rechnung aber nicht vereinbart bzw. nicht zulässig.");
    else if (inv.skontoGezogen && skIst == null && !skontoMoeglich) add("cut", `Skonto als gezogen vermerkt, für diese Rechnung aber ${p.skontoVereinbart ? "nicht zulässig (nur Schlussrechnung bzw. kein positiver Zahlbetrag)" : "nicht vereinbart"} (§ 16 Abs. 5 Nr. 2 VOB/B). Ein Abzug ist unberechtigt; der Differenzbetrag bleibt offen.`);
    if (skPaid > 0 && skontoMoeglich && skF.d && inv.zahlDatum && inv.zahlDatum > skF.d) add("cut", `Skonto unberechtigt: Zahlung am ${fmtD(inv.zahlDatum)} nach Ablauf der Skontofrist (${fmtD(skF.d)}). Skontobetrag ${eur(skonto)} ist nachzuzahlen.`);
    const skS = skIst != null ? skPaid : Math.min(skPaid, skonto);
    const soll = round2(zahlbetrag - skS - (p.freistellung ? 0 : round2(Math.max(zahlbetrag - skS, 0) * 0.15)));
    if (paid < soll - 0.01) add("warn", `Minderzahlung von ${eur(round2(soll - paid))} gegenüber dem festgestellten Betrag. Der Rest bleibt offen und wird in der nächsten kumulierten Prüfung berücksichtigt.`);
    if (zF.d && inv.zahlDatum && inv.zahlDatum > zF.d) add("warn", `Zahlung erst am ${fmtD(inv.zahlDatum)} nach Fälligkeit (${fmtD(zF.d)}). Verzugsvoraussetzungen nach § 16 Abs. 5 Nr. 3 VOB/B beachten (Verzugszinsen § 288 Abs. 2 BGB).`);
  }
  return { inv, idx, rows, sumAN, sumGP, cAN, cGP, se, seLabel, seCapped, maengel, sonst, nachAbzug, vor, zahlbetrag,
    skontoMoeglich, skonto, gegenMit, baMit, auszMit, baOhne, auszOhne, skF, zF, paidRecorded, paid, baPaid, skPaid, anrechnung, isSchluss, hints: H };
}

