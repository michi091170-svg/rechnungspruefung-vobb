# Rechnungsprüfung nach VOB/B

Web-App für die externe Bauleitung: kumulierte Prüfung von Abschlags-, Teilschluss- und Schlussrechnungen nach VOB/B, mit Aufmaß und Übermessung nach VOB/C, Nachtragsmanagement, Einbehalten, Skonto, Bauabzugsteuer, Sicherheiten und Prüfvermerk.

Der Build erzeugt **eine einzige HTML-Datei** (`dist/index.html`). Sie läuft lokal im Browser oder als claude.ai-Artifact; dort kommen Kontospeicher, Downloads und KI-Texterkennung von Scans hinzu.

## Fachliche Grundlagen und Grenzen

| Bereich | Grundlage |
|---|---|
| Abschlags- und Schlusszahlung, Fristen, Skonto | § 16 VOB/B |
| Aufmaß, Abrechnung | § 14 VOB/B, VOB/C Abschnitt 5 der jeweiligen ATV |
| Mengenänderung, Nachträge | § 2 Abs. 3, 5, 6, 8, 9 VOB/B, § 6 Abs. 6 VOB/B |
| Sicherheiten | § 17 VOB/B, § 9c VOB/A, §§ 650i, 650m BGB, §§ 765 ff. BGB |
| Steuern | § 13b UStG, §§ 48–48b EStG |

- **Normstand:** VOB Gesamtausgabe 2019 mit ATV-Ergänzungsband 2023. Maßgeblich ist immer die **vertraglich vereinbarte Fassung**. Übermessungsgrenzen mit dem Status „abgleichen“ vor Verwendung im Prüfvermerk am Normtext prüfen.
- **Voreinstellungen** neuer Projekte (seit 1.0.0): Skonto *nicht vereinbart*, Sicherheitsleistung *nicht vereinbart*, Nachlass *nur auf den Hauptauftrag*. Abweichungen müssen bewusst unter „Vertrag & Konditionen“ gesetzt werden. Sicherungen älterer Versionen behalten ihr bisheriges Rechenverhalten (`migrateProject`).
- **Strittig** und deshalb als Schalter umgesetzt: Fortwirkung eines Pauschalnachlasses auf Nachträge.
- **Nicht berücksichtigt:** gesetzliche Feiertage bei Fristende (§ 193 BGB, nur Sa/So), länderspezifische Regelungen.
- Die Software ersetzt keine Rechtsberatung. KI-erkannte Werte sind Vorschläge und am Original zu prüfen.

## Aufbau

```
src/core/          Rechenkern, rein funktional, TypeScript (strict), vollständig getestet
  types.ts         Datenmodell (Projekt, Position, Nachtrag, Rechnung, Sicherheit)
  format.ts        Zahlen, Beträge, Datum, Fristen (§ 193 BGB, Werktage)
  formula.ts       Aufmaßformel-Parser ohne eval
  vobc.ts          ATV-Liste, Übermessungsregeln, Übermessungsrechner
  model.ts         Voreinstellungen, Beispielprojekt, Migration alter Sicherungen
  calc.ts          kumulierte Rechnungsprüfung, Kürzungskette, Hinweise
  sicherheit.ts    Vertragserfüllungssicherheit und Bürgschaften
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
```

Rauchtest im Browser (benötigt Playwright mit Chromium):

```bash
npm run build && node e2e/smoke.mjs dist/index.html
```

## Veröffentlichung als Artifact

`dist/index.html` wird unverändert als Artifact veröffentlicht. Das Artifact benötigt die Fähigkeiten `db`, `user` (Kontospeicher), `downloads` (Dateien speichern) und `sample` (Texterkennung).

## Weiterentwicklung

1. Gesetzliche Feiertage je Bundesland für Fristende.
2. Prüfvermerk: Herkunft jedes Werts (KI-erkannt / manuell geprüft) und Programmversion ausweisen.
3. Schemaversion im Projekt, Konflikterkennung beim Sync zwischen Geräten.
4. Oberfläche schrittweise nach TypeScript überführen und Teil-Rendering für große LVs.
5. Hinweis und Freigabe vor Übergabe von Dokumenten an die KI-Erkennung (DSGVO, Verschwiegenheit).
