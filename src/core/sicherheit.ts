import { calcAll, chain } from "./calc";
import { addWerktage, daysBetween, esc, eur, fmtD, fmtN, num, round2, todayISO, yearEnd3 } from "./format";
import { ensureSic } from "./model";
import type { HintLevel, Project } from "./types";

/** Vertragserfüllungssicherheit: Soll nach § 650m BGB bzw. Vereinbarung, Deckung durch Bürgschaften. */
export function sicCalc(p: Project) {
  const s = ensureSic(p), C = calcAll(p);
  const ch = (net: number, nt: number) => { const c = chain(p, net, nt); return s.basis === "netto" ? c.n2 : c.brutto; };
  const urspr = ch(C.auftragNetto, 0), ges = ch(C.auftragGesamt, C.ntBeauftragt), zus = round2(ges - urspr);
  const erh = C.auftragNetto ? (C.ntBeauftragt / C.auftragNetto) * 100 : 0;
  const p650m = s.verbraucher === true && s.vbv === true;
  let soll = 0, sollTxt = "";
  if (p650m) { soll = round2(urspr * 0.05 + (erh > 10 ? zus * 0.05 : 0)); sollTxt = `§ 650m Abs. 2 BGB: 5 % der vereinbarten Gesamtvergütung${erh > 10 ? " zzgl. 5 % des zusätzlichen Vergütungsanspruchs (Nachträge > 10 %)" : ""}`; }
  if (s.vereinbart === true) { const v = round2(ges * num(s.satz) / 100); if (v > soll) { soll = v; sollTxt = `vertraglich vereinbart: ${fmtN(s.satz,2)} % der Auftragssumme (${s.basis})`; } }
  const vorh = round2(s.buergschaften.filter(b => b.status === "liegt vor").reduce((a, b) => a + num(b.betrag), 0));
  const abschl = round2(C.out.filter(r => !r.isSchluss).reduce((a, r) => a + r.anrechnung, 0));
  const ford = round2(s.forderungen.reduce((a, x) => a + num(x.betrag), 0));
  return { s, C, urspr, ges, zus, erh, p650m, soll, sollTxt, vorh, abschl, ford, grenze90: round2(C.auftragBrutto * 0.9) };
}
export function sicHints(p: Project, K: ReturnType<typeof sicCalc>): [HintLevel, string][] {
  const s = K.s, H: [HintLevel, string][] = [], add = (l: HintLevel, t: string) => { H.push([l, t]); };
  if (s.verbraucher === null || s.vbv === null || s.vereinbart === null) add("warn", "Angaben zum Vertrag vervollständigen (Verbraucher, Verbraucherbauvertrag, vertragliche Vereinbarung) – erst dann ist die Bewertung belastbar.");
  if (s.verbraucher === true && s.vbv === false) add("info", "Kein Verbraucherbauvertrag: § 650i BGB setzt den Bau eines neuen Gebäudes oder erhebliche Umbaumaßnahmen aus einer Hand voraus. Bei gewerkeweiser Vergabe liegt nach BGH (Urt. v. 16.03.2023 – VII ZR 94/22) kein Verbraucherbauvertrag vor – § 650m BGB (5 %-Sicherheit, 90 %-Grenze) gilt dann nicht.");
  if (K.p650m) add("info", "§ 650m Abs. 2 BGB: Der Unternehmer hat bei der ersten Abschlagszahlung eine Sicherheit für die rechtzeitige Herstellung ohne wesentliche Mängel zu leisten. Auf Verlangen des Unternehmers erfolgt sie durch Einbehalt von Abschlagszahlungen bis zum Gesamtbetrag der Sicherheit (§ 650m Abs. 2 S. 3, Abs. 3: Garantie oder Zahlungsversprechen eines Kreditinstituts/Kreditversicherers).");
  if (K.p650m && K.abschl > K.grenze90 + 0.01) add("cut", `§ 650m Abs. 1 BGB: Abschlagszahlungen (${eur(K.abschl)}) übersteigen 90 % der Gesamtvergütung inkl. Nachträge (${eur(K.grenze90)}).`);
  if (!K.p650m && s.vereinbart === false) add("info", "Nach BGB besteht außerhalb des Verbraucherbauvertrags kein gesetzlicher Anspruch auf eine Vertragserfüllungssicherheit – sie muss vertraglich vereinbart sein. Ohne Vereinbarung kann sie nicht verlangt und kein Sicherheitseinbehalt vorgenommen werden.");
  if (s.vereinbart === true && s.klausel === "agb" && num(s.satz) > 10) add("cut", `Vertragserfüllungssicherheit von ${fmtN(s.satz,2)} % in AGB des Auftraggebers: über 10 % der Auftragssumme regelmäßig unangemessene Benachteiligung (§ 307 BGB).`);
  if (s.vereinbart === true && s.zweckMaengel && (num(p.gwSatz) > 0 || p.gwBuergschaft)) add("warn", "Sicherungszweck umfasst auch Mängelansprüche nach Abnahme und daneben ist eine Mängelsicherheit vereinbart: Gefahr der Übersicherung durch Kumulation (§ 307 BGB) – Gesamtbelastung prüfen.");
  const vob = p.vobB !== false;
  if (vob) {
    add("info", "VOB/B vereinbart: § 17 VOB/B ergänzt bzw. verdrängt die BGB-Regeln. Sicherheit nur bei Vereinbarung (§ 17 Abs. 1 Nr. 1); sie dient der vertragsgemäßen Ausführung und den Mängelansprüchen (Abs. 1 Nr. 2). Der AN hat die Wahl zwischen Einbehalt, Hinterlegung und Bürgschaft und kann eine Sicherheit durch eine andere ersetzen (Abs. 3).");
    if (s.vereinbart === true) {
      const fr = addWerktage(p.vertragsdatum, 18);
      if (!p.vertragsdatum) add("warn", "§ 17 Abs. 7 VOB/B: Sicherheit binnen 18 Werktagen nach Vertragsschluss – Vertragsdatum fehlt.");
      else if (!s.buergschaften.some(b => b.status === "liegt vor")) add(todayISO() > fr ? "warn" : "info", `§ 17 Abs. 7 VOB/B: Sicherheit war bis ${fmtD(fr)} zu leisten (18 Werktage nach Vertragsschluss). ${todayISO() > fr ? "Frist abgelaufen: der AG darf vom Guthaben des AN einen Betrag in Höhe der vereinbarten Sicherheit einbehalten (Abs. 6 und 8 gelten entsprechend)." : ""}`);
      if (num(s.satz) > 5) add("info", "Öffentliche Auftraggeber: Vertragserfüllungssicherheit soll 5 % der Auftragssumme nicht überschreiten (§ 9c Abs. 2 VOB/A). Für private AG Richtwert; in AGB Obergrenze 10 %.");
    }
    add("info", "Rückgabe (§ 17 Abs. 8 VOB/B): Vertragserfüllungssicherheit spätestens nach Abnahme und Stellung der Mängelsicherheit, soweit keine gesicherten Ansprüche offen sind; Mängelsicherheit nach Ablauf von 2 Jahren, sofern nichts anderes vereinbart.");
  }
  if (K.soll > 0 && K.vorh + 0.01 < K.soll) add("warn", `Unterdeckung: vorliegende Bürgschaften ${eur(K.vorh)} gegenüber Soll ${eur(K.soll)} (fehlen ${eur(round2(K.soll - K.vorh))}).`);
  if (K.soll === 0 && K.vorh > 0) add("warn", "Es liegt eine Bürgschaft vor, ohne dass ein Anspruch auf Sicherheit festgestellt ist – Sicherungsabrede prüfen; ohne wirksame Abrede kann der AN Herausgabe verlangen.");
  const t = todayISO();
  s.buergschaften.forEach((b, i) => {
    const n = `Bürgschaft ${i + 1}${b.nr ? " (" + b.nr + ")" : ""}`;
    if (vob && b.erstesAnfordern) add("cut", `${n}: § 17 Abs. 4 S. 3 VOB/B – der AG kann keine Bürgschaft auf erstes Anfordern verlangen.`);
    else if (b.erstesAnfordern && s.klausel === "agb") add("cut", `${n}: Vertragserfüllungsbürgschaft auf erstes Anfordern ist in AGB des Auftraggebers unwirksam (st. Rspr. BGH, u. a. Urt. v. 18.04.2002 – VII ZR 192/01). Die Sicherungsabrede ist gefährdet.`);
    if (vob && !b.selbstschuldnerisch) add("cut", `${n}: § 17 Abs. 4 S. 2 VOB/B verlangt eine Bürgschaft unter Verzicht auf die Einrede der Vorausklage (§ 771 BGB) – Urkunde nicht vertragsgerecht.`);
    else if (!b.selbstschuldnerisch) add("warn", `${n}: ohne Verzicht auf die Einrede der Vorausklage (§ 771 BGB) muss zunächst die Zwangsvollstreckung gegen den AN versucht werden – selbstschuldnerische Bürgschaft (§ 773 Abs. 1 Nr. 1 BGB) verlangen.`);
    if (b.verz770 && s.klausel === "agb") add("warn", `${n}: Verzicht auf die Einrede der Aufrechenbarkeit (§ 770 Abs. 2 BGB) in AGB ist unwirksam, soweit die Gegenforderung unbestritten oder rechtskräftig festgestellt ist.`);
    if (!b.original && b.status === "liegt vor") add("warn", `${n}: Original-Urkunde nicht vermerkt – Inanspruchnahme und Rückgabe setzen das Original voraus; Schriftform § 766 BGB (Ausnahme Kaufmann, § 350 HGB).`);
    if (!b.tauglich) add("warn", `${n}: Tauglichkeit des Bürgen prüfen (§ 239 BGB; in der Praxis Kreditinstitut oder Kreditversicherer mit Zulassung in der EU).`);
    if (vob && b.befristetBis) add("cut", `${n}: § 17 Abs. 4 S. 2 VOB/B – Bürgschaft darf nicht auf bestimmte Zeit begrenzt sein. Unbefristete Urkunde verlangen.`);
    if (vob && !b.tauglich) add("warn", `${n}: § 17 Abs. 2 und 4 VOB/B – Bürge muss vom AG als tauglich anerkannt sein (Kreditinstitut/Kreditversicherer mit Zulassung in der EU, im EWR oder WTO-Vertragsstaat).`);
    if (b.befristetBis && b.status === "liegt vor") {
      const d = daysBetween(t, b.befristetBis);
      if (d < 0) add("cut", `${n}: Befristung am ${fmtD(b.befristetBis)} abgelaufen. Bei einer Zeitbürgschaft wird der Bürge frei, wenn die Inanspruchnahme nicht unverzüglich nach Fristablauf angezeigt wird (§ 777 BGB).`);
      else add(d <= 60 ? "warn" : "info", `${n}: befristet bis ${fmtD(b.befristetBis)} (noch ${d} Tage) – gesicherte Ansprüche rechtzeitig geltend machen.`);
    }
    if (num(b.betrag) > 0 && K.soll > 0 && num(b.betrag) > K.soll * 1.1 && s.klausel === "agb") add("info", `${n}: Betrag übersteigt das Soll deutlich – Übersicherung prüfen, ggf. Teilfreigabe.`);
    if (b.status === "liegt vor" && p.abnahme) add("info", `${n}: Abnahme am ${fmtD(p.abnahme)} – Bürgschaft zurückgeben, sobald die bis zur Abnahme entstandenen gesicherten Ansprüche erfüllt sind${num(p.gwSatz) > 0 || p.gwBuergschaft ? " und die Mängelsicherheit gestellt ist" : ""}.`);
  });
  s.forderungen.forEach(f => { if (f.faellig) { const v = yearEnd3(f.faellig); const d = daysBetween(t, v); if (d < 180) add(d < 0 ? "cut" : "warn", `Forderung „${esc(f.text || "–")}“: Verjährung des Bürgschaftsanspruchs zum ${fmtD(v)} (§§ 195, 199 BGB – Beginn mit Fälligkeit der Hauptforderung); Hemmung durch Klage/Mahnbescheid gegen den Bürgen (§ 204 BGB).`); } });
  if (K.ford > 0 && K.vorh > 0 && K.ford > K.vorh) add("warn", `Gesicherte Forderungen (${eur(K.ford)}) übersteigen die vorliegende Bürgschaftssumme (${eur(K.vorh)}) – Bürge haftet nur bis zum Höchstbetrag.`);
  return H;
}
