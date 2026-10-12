# Änderungen

## 1.1.0 – 2026-10-12

- Fristende nach § 193 BGB berücksichtigt jetzt gesetzliche Feiertage; Bundesland der Baustelle unter „Vertrag“ wählbar. Werktagsfristen (§ 17 Abs. 7 VOB/B) ebenso.
- Als gezogen vermerktes Skonto ohne Vereinbarung bzw. Zulässigkeit wird als unberechtigter Abzug gemeldet (§ 16 Abs. 5 Nr. 2 VOB/B), nicht mehr nur als Minderzahlung.
- Prüfvermerk: KI-erkannte, nicht von Hand geänderte Mengen sind mit „K“ gekennzeichnet; vereinbarte VOB-Fassung, Programmversion und Feiertagsgrundlage werden ausgewiesen.
- Einmaliger Datenschutz-Hinweis vor der ersten KI-Erkennung.
- Projekte tragen eine Schemaversion. Wurde ein Projekt auf zwei Geräten geändert, bleibt der lokale Stand beim Abgleich als „Konflikt-Kopie“ erhalten statt überschrieben zu werden.
- Bibliotheken (pdf.js, jsPDF, SheetJS) sind in die HTML-Datei eingebettet: Die App läuft ohne Internet, z. B. als Datei auf dem Desktop. jsPDF auf 4.2.1 aktualisiert.

## 1.0.0 – 2026-10-12

- Code-Repository aus dem bisherigen Einzeldatei-Artifact aufgebaut: Rechenkern in TypeScript-Module ausgelagert, Unit-Tests, Build zur Einzeldatei, CI.
- Neue Projekte: Skonto standardmäßig nicht vereinbart (§ 16 Abs. 5 Nr. 2 VOB/B).
- Sicherheitseinbehalt nur bei vereinbarter Sicherheitsleistung (§ 17 Abs. 1 Nr. 1 VOB/B); Schalter wird mit dem Reiter Vertragserfüllungsbürgschaft abgeglichen. Voreinstellung 5 % / 3 % entsprechend § 9c Abs. 2 VOB/A.
- Schalter „Nachlass gilt auch für Nachtragsleistungen“; Voreinstellung nein. Ausweis im Prüfergebnis und Prüfvermerk.
- Prüfvermerk nennt die angewandten Konditionen (Skonto, Sicherheit, Nachlass).
- Skonto-Spanne 2–5 % als Erfahrungswert gekennzeichnet, nicht als Normvorgabe.
- Aufmaßformel: fehlerhafte Zahlen wie „1..2“ werden abgewiesen statt still als 1 gelesen.
- Sicherungen älterer Versionen behalten ihr Rechenverhalten.
