<div align="center">

# PP-Steuern

### Vorabpauschale, Freibetrag und Verkaufsplanung für Portfolio Performance – eine HTML-Datei, läuft offline

[![Online öffnen](https://img.shields.io/badge/Online_öffnen-1f5f8b?style=for-the-badge)](https://inazr.github.io/pp-steuern/)
[![Offline-Version laden](https://img.shields.io/badge/Offline--Version_laden-1a7f4b?style=for-the-badge)](https://github.com/inazr/pp-steuern/releases/latest)

![Release](https://img.shields.io/github/v/release/inazr/pp-steuern)
![Pages](https://img.shields.io/github/actions/workflow/status/inazr/pp-steuern/pages.yml?label=Pages)
![Stand](https://img.shields.io/badge/Stand-25.11.2026-informational)
![Offline](https://img.shields.io/badge/läuft-offline-success)
![Abhängigkeiten](https://img.shields.io/badge/Abhängigkeiten-0-success)
![Lizenz](https://img.shields.io/badge/Lizenz-MIT-blue)

[Funktionen](#was-der-rechner-abbildet) · [Gesetzliche Werte](#gesetzliche-werte) · [Grenzen](#grenzen) · [Entwicklung](#entwicklung) · [Releases](#releases) · [Lizenz](#lizenz)

<sub>Keine Steuerberatung. Modellrechnung, alle Angaben ohne Gewähr. Maßgeblich ist die Abrechnung deiner Bank.</sub>

</div>

PP-Steuern liest eine Datei aus [Portfolio Performance](https://www.portfolio-performance.info/) und rechnet die deutschen Kapitalertragsteuer-Themen eines ETF- und Fondsdepots durch: Vorabpauschale je Jahr, wie du den Sparerpauschbetrag mit Verkauf und Rückkauf ausnutzt, und wie viel du verkaufen musst, um einen Netto-Betrag zu erhalten.

> [!TIP]
> Die ganze Anwendung ist **eine einzige HTML-Datei** mit eingebetteten Charts (Apache ECharts) und Schriften. Sie funktioniert ohne Internet, auch per Doppelklick. Deine Datei wird nur im Browser gelesen. Eine Content-Security-Policy verhindert jede Netzwerkanfrage. Gespeichert werden nur deine Einstellungen und Fondstypen im Browser, nie Buchungen oder Kurse.

Neu umgesetzt nach der Idee von [inazr/PortfolioPerformanceTaxes](https://github.com/inazr/PortfolioPerformanceTaxes) (Python/PyQt), mit korrigierter Steuerlogik.

## Was der Rechner abbildet

| Reiter | Inhalt |
|---|---|
| **Übersicht** | Steuer-Einstellungen (Veranlagung, Kirchensteuer, Bundesland, bereits genutzter Freibetrag), Depotauswahl, Wertpapiere mit Fondstyp, Chart der unrealisierten Gewinne je Lot |
| **Vorabpauschale** | § 18 InvStG je Jahr, Depot und Wertpapier: Basisertrag, Deckelung durch Wertsteigerung plus Ausschüttungen, Zwölftelung im Kaufjahr, Teilfreistellung, Steuer. Gestapelter Chart je Jahr, CSV-Export |
| **Freibetrag nutzen** | Welche Lots du verkaufen und sofort zurückkaufen kannst, damit der steuerpflichtige Gewinn den freien Sparerpauschbetrag genau füllt. Streng FIFO je Depot, CSV-Export |
| **Verkaufsplanung** | „Ich brauche X € netto“: verkauft je Depot nach FIFO und wählt zwischen Wertpapieren immer den Lot mit der geringsten Steuer je Euro netto. Wasserfall Brutto → Steuer → Netto, CSV-Export |

Steuerlogik im Überblick:

- **FIFO je Depot** (§ 20 Abs. 4 S. 7 EStG). Depotüberträge in Portfolio Performance nehmen die Lots mit Kaufdatum, Einstand und bereits versteuerter Vorabpauschale mit.
- **Vorabpauschale je Lot**, zum Jahresende verbucht und beim Verkauf auf den Gewinn angerechnet. Ausschüttungen zählen brutto (netto plus einbehaltene Steuern) und werden nach dem Bestand im jeweiligen Depot am Zahltag verteilt.
- **Teilfreistellung** je Fondstyp: Aktienfonds 30 %, Mischfonds 15 %, Immobilienfonds 60 % (Inland) bzw. 80 % (Ausland). Für **Einzelaktien** gibt es keine Vorabpauschale und keine Teilfreistellung, Käufe vor 2009 sind steuerfrei (Bestandsschutz).
- **Steuersatz** Abgeltungsteuer + Soli, wahlweise mit Kirchensteuer (8 % oder 9 %) und Ermäßigung nach § 32d Abs. 1 EStG.
- **Bereits genutzter Freibetrag** ist mit der steuerpflichtigen Vorabpauschale des Vorjahres (sie fließt im Januar zu) plus den Verkäufen des laufenden Jahres vorbelegt und lässt sich überschreiben.

## Gesetzliche Werte

| Wert | Jahr | Höhe | Quelle |
|---|---|---|---|
| Basiszins | 2018 | 0,87 % | BMF-Schreiben Januar 2018 (nicht online gegengeprüft) |
| Basiszins | 2019 | 0,52 % | BMF-Schreiben Januar 2019 (nicht online gegengeprüft) |
| Basiszins | 2020 | 0,07 % | BMF-Schreiben vom 29.01.2020 |
| Basiszins | 2021 | −0,45 % | BMF-Schreiben vom 06.01.2021 (nicht online gegengeprüft) |
| Basiszins | 2022 | −0,05 % | BMF-Schreiben vom 07.01.2022 |
| Basiszins | 2023 | 2,55 % | BMF-Schreiben vom 04.01.2023 |
| Basiszins | 2024 | 2,29 % | BMF-Schreiben vom 05.01.2024 |
| Basiszins | 2025 | 2,53 % | BMF-Schreiben vom 10.01.2025 |
| Basiszins | 2026 | 3,20 % | BMF-Schreiben vom 13.01.2026 |
| Sparerpauschbetrag | ab 2023 | 1.000 € / 2.000 € | § 20 Abs. 9 EStG (bis 2022: 801 € / 1.602 €) |
| Abgeltungsteuer, Soli | – | 25 %, 5,5 % | § 32d EStG, SolZG |
| Kirchensteuer | – | 8 % (BY, BW), sonst 9 % | Kirchensteuergesetze der Länder |

Ein neuer Basiszins wird jedes Jahr im Januar veröffentlicht und muss in `src/law.js` nachgetragen werden. Fehlt er, rechnet das Tool für dieses Jahr keine Vorabpauschale und zeigt einen Hinweis.

## Grenzen

- Nur **XML-Dateien** aus Portfolio Performance (beide XStream-Varianten, auch als `.portfolio`-ZIP). Binäre oder verschlüsselte Dateien bitte über „Datei → Speichern unter → XML“ unverschlüsselt speichern.
- Nur **Wertpapiere in EUR**. Andere werden ausgelassen und angezeigt.
- **Keine Verlustverrechnung** (Verlusttöpfe) und keine Anrechnung ausländischer Quellensteuer. Verluste mindern die Steuer im Verkaufsplan nicht (konservativ).
- Nicht abgebildet ist die **fiktive Veräußerung zum 31.12.2017** für Fondsanteile, die vor 2018 gekauft wurden (Altbestand, 100.000-€-Freibetrag).
- Gerechnet wird mit dem **letzten Kurs in der Datei**. Ordergebühren für künftige Verkäufe sind nicht berücksichtigt.

## Entwicklung

```bash
npm test        # Tests (node:vm, keine Abhängigkeiten); baut dabei auch dist/index.html
npm run build   # nur bauen
```

Node 22 oder neuer. Es gibt **keine npm-Abhängigkeiten**: `scripts/build.mjs` bettet ECharts, Schriften und die Skripte in `dist/index.html` ein. Die Engine-Dateien sind klassische Skripte mit gemeinsamem globalen Gültigkeitsbereich. Ihre Reihenfolge steht in `scripts/files.mjs` und gilt für Build und Tests.

| Datei | Inhalt |
|---|---|
| `src/xml.js`, `src/zip.js` | XML-Leser mit XStream-Referenzen (XPath- und id-Modus), `.portfolio`-ZIP |
| `src/pp.js` | Wertpapiere, Depots, Buchungen, Ausschüttungen und Kurse aus der PP-Datei |
| `src/law.js` | Gesetzliche Werte mit Quellen, Steuersatz, Fondstypen |
| `src/engine.js` | Chronologischer Durchlauf: FIFO je Depot, Überträge, Vorabpauschale je Lot |
| `src/freibetrag.js`, `src/planner.js` | Freibetrag-Optimierer, Netto-Verkaufsplan |
| `src/format.js`, `src/csv.js` | Deutsche Formate, CSV-Export |
| `src/charts.js` | ECharts-Optionen als reine Funktionen |
| `src/state.js`, `src/ui.js`, `src/page.html` | Einstellungen, Oberfläche, Seitenvorlage |
| `test/` | Tests und synthetische PP-Dateien |

## Releases

Version in `package.json` erhöhen und auf `main` pushen. Der Workflow `release.yml` legt den Tag `v<Version>` an und hängt `pp-steuern-<Version>.html` an das Release. `pages.yml` veröffentlicht jeden Stand von `main` auf GitHub Pages. Pages einmalig unter *Settings → Pages → Source: GitHub Actions* aktivieren.

## Hinweis

Keine Anlage-, Steuer- oder Rechtsberatung. Die Berechnung bildet die Regeln vereinfacht nach und ersetzt weder die Abrechnung deiner Bank noch eine Steuerberatung.

## Lizenz

MIT, siehe [LICENSE](LICENSE). Eingebettet: [Apache ECharts](https://echarts.apache.org/) 6.1.0 (Apache-2.0, siehe `vendor/`), [Public Sans](https://public-sans.digital.gov/) und [JetBrains Mono](https://www.jetbrains.com/lp/mono/) (SIL OFL 1.1, siehe `fonts/`).
