# Rechnungsprüfung nach VOB/B

Web-App für die externe Bauleitung: kumulierte Prüfung von Abschlags-, Teilschluss- und Schlussrechnungen nach VOB/B, mit Aufmaß und Übermessung nach VOB/C, Nachtragsmanagement, Einbehalten, Skonto, Bauabzugsteuer, Sicherheiten und Prüfvermerk.

Der Build erzeugt **eine einzige HTML-Datei** (`dist/index.html`) mit allen Bibliotheken. Sie läuft ohne Internet lokal im Browser (z. B. vom Desktop) oder als claude.ai-Artifact; dort kommen Kontospeicher über mehrere Geräte und die KI-Auswertung von Unterlagen hinzu. Scans ohne Textebene liest eine eingebettete Texterkennung (Tesseract, deutsch) direkt auf dem Gerät; an die KI geht dann nur der Text.

## Fachliche Grundlagen und Grenzen

| Bereich | Grundlage |
|---|---|
| Abschlags- und Schlusszahlung, Fristen, Skonto | § 16 VOB/B |
| Aufmaß, Abrechnung | § 14 VOB/B, VOB/C Abschnitt 5 der jeweiligen ATV |
| Mengenänderung, Nachträge | § 2 Abs. 3, 5, 6, 8, 9 VOB/B, § 6 Abs. 6 VOB/B |
| Sicherheiten | § 17 VOB/B, § 9c VOB/A, §§ 650i, 650m BGB, §§ 765 ff. BGB |
| Steuern | § 13b UStG, §§ 48–48b EStG |

- **Normstand** (geprüft 12.10.2026): VOB/B Ausgabe 2016 (in der Gesamtausgabe 2019 unverändert), VOB/C Gesamtausgabe 2019 mit ATV-Ergänzungsband 2023. Die Änderungen 2026 betreffen nur die VOB/A. Die Fassung ist je Projekt einstellbar und erscheint im Prüfvermerk. Maßgeblich ist immer die **vertraglich vereinbarte Fassung**. Übermessungsgrenzen mit dem Status „abgleichen“ vor Verwendung im Prüfvermerk am Normtext prüfen.
- **Voreinstellungen** neuer Projekte (seit 1.0.0): Skonto *nicht vereinbart*, Sicherheitsleistung *nicht vereinbart*, Nachlass *nur auf den Hauptauftrag*. Abweichungen müssen bewusst unter „Vertrag & Konditionen“ gesetzt werden. Sicherungen älterer Versionen behalten ihr bisheriges Rechenverhalten (`migrateProject`).
- **Strittig** und deshalb als Schalter umgesetzt: Fortwirkung eines Pauschalnachlasses auf Nachträge.
- **Feiertage** (§ 193 BGB): bundeseinheitliche und landesweite Feiertage des gewählten Bundeslands. Nur regional geltende Feiertage (Mariä Himmelfahrt in Teilen Bayerns, Fronleichnam in einzelnen Gemeinden Sachsens und Thüringens, Augsburger Friedensfest) sind **nicht** enthalten und im Einzelfall selbst zu prüfen.
- Die Software ersetzt keine Rechtsberatung. KI-erkannte Werte sind Vorschläge, im Prüfvermerk mit „K“ gekennzeichnet und am Original zu prüfen.

## Aufbau

```
src/core/          Rechenkern, rein funktional, TypeScript (strict), vollständig getestet
  types.ts         Datenmodell (Projekt, Position, Nachtrag, Rechnung, Sicherheit)
  format.ts        Zahlen, Beträge, Datum, Fristen (§ 193 BGB, Werktage)
  formula.ts       Aufmaßformel-Parser ohne eval
  vobc.ts          ATV-Liste, Übermessungsregeln, Übermessungsrechner
  feiertage.ts     Gesetzliche Feiertage je Bundesland
  model.ts         Voreinstellungen, Beispielprojekt, Schemaversion, Migration, Abgleich mit dem Konto
  calc.ts          kumulierte Rechnungsprüfung, Kürzungskette, Hinweise
  sicherheit.ts    Vertragserfüllungssicherheit und Bürgschaften
  lokaltext.ts     Auswertung von Seitentext ohne KI (Rechnung, LV, Aufmaß, Nachtrag)
src/ui/app.js      Oberfläche, Speicherung, Datei-Import (GAEB, Excel, PDF), Texterkennung
src/ui/styles.css  Gestaltung inkl. Dunkelmodus und Druck
tests/             Vitest, inkl. Referenzwerte des Beispielprojekts (Golden Master)
e2e/smoke.mjs      Browser-Rauchtest der gebauten Datei
```

## Entwicklung

```bash
npm install
npm run dev        # Entwicklungsserver
npm test           # Unit-Tests
npm run typecheck  # TypeScript strict
npm run build      # dist/index.html
npm run check      # alles zusammen, wie in der CI
npm run desktop    # dist/Rechnungspruefung-VOB-B.html zum Ablegen auf dem Desktop
```

Rauchtest im Browser (benötigt Playwright mit Chromium):

```bash
npm run build && node e2e/smoke.mjs dist/index.html
node e2e/ocr.mjs dist/index.html       # reiner Scan, Texterkennung auf dem Gerät, KI bekommt nur Text
node e2e/offline.mjs dist/index.html   # Desktop ohne KI: Auftrag und Rechnung als Scan einlesen und prüfen
```

## Veröffentlichung als Artifact

`dist/index.html` wird unverändert als Artifact veröffentlicht. Das Artifact benötigt die Fähigkeiten `db`, `user` (Kontospeicher), `downloads` (Dateien speichern) und `sample` (Texterkennung).

## Desktop-Version

`npm run desktop` erzeugt `dist/Rechnungspruefung-VOB-B.html`. Die Datei per Doppelklick im Browser öffnen (Chrome, Edge oder Firefox).

- Läuft ohne Internet. Ohne Internet wird statt der Webschrift die Systemschrift verwendet.
- Daten liegen im Speicher des Browsers auf diesem Rechner. Regelmäßig über das Menü „Sicherung herunterladen (JSON)“ eine Datei sichern; Browserdaten löschen entfernt auch die Projekte.
- Scans und PDFs (Rechnung, Auftrag mit LV, Aufmaß, Nachtrag) werden auch hier eingelesen: Texterkennung auf dem Gerät, danach Auswertung nach festen Leseregeln ohne KI. Das klappt bei klar gegliederten Tabellen (OZ, Text, Menge, EH, EP, GP in einer Zeile) zuverlässig; Handschrift, verschachtelte Tabellen und Freitext-Vertragsbedingungen liest die KI-Auswertung der claude.ai-Version besser. Kontospeicher gibt es nur dort. Sicherungen lassen sich zwischen beiden Versionen austauschen.

## Sicherheit der Bibliotheken

- Tesseract.js 7.0.0 mit Rechenkern 7.0.0 (Apache-2.0) und Sprachdaten `deu` 4.0.0_best_int laufen in einem Web Worker; Sprachdaten werden aus der Datei geliefert, nicht aus dem Netz.
- pdf.js 3.11.174 wird mit `isEvalSupported: false` aufgerufen; das schließt die bekannte Lücke beim Öffnen manipulierter PDF (GHSA-wgrm-67xf-hhpq).
- SheetJS 0.18.5 ist die letzte Version auf npm und hat bekannte Schwachstellen beim Einlesen manipulierter Excel-Dateien (CVE-2023-30533, CVE-2024-22363). Excel-LVs nur aus vertrauenswürdiger Quelle einlesen; Umstieg auf SheetJS 0.20.x steht aus.

## Weiterentwicklung

Erledigt in 1.1.0: Feiertage je Bundesland, Herkunftskennzeichnung im Prüfvermerk, Programmversion, Schemaversion, Konfliktkopie beim Abgleich, Datenschutz-Hinweis vor der KI-Erkennung, Offline-Fähigkeit.

Erledigt in 1.2.0: Texterkennung auf dem Gerät, Auswertung ohne KI für die Desktop-Version.

1. SheetJS auf 0.20.x und pdf.js auf eine aktuelle Hauptversion umstellen.
2. Oberfläche schrittweise nach TypeScript überführen und Teil-Rendering für große LVs.
3. Regional begrenzte Feiertage (Gemeindeebene) optional erfassen.
