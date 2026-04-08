# kcalc - Kalorienbedarf Rechner

Ein moderner, browserbasierter Kalorienbedarf-Rechner als statische GitHub Pages Webseite. Berechne deinen täglichen Kalorienbedarf nach Harris-Benedict und Mifflin-St.Jeor und verwalte deinen Gewichtsverlauf.

## Demo

**[https://kcalc.de/](https://kcalc.de/)**

## Features

- Berechnung des Grundumsatzes nach Harris-Benedict, Mifflin-St.Jeor oder Mittelwert
- Broca-Index-Anpassung bei BMI > 30
- PAL-basierte Leistungsumsatz-Berechnung mit dynamischen Tätigkeitszeilen
- Multi-Profil-Verwaltung (mehrere Personen lokal speichern)
- Gewichtsverlauf mit Canvas-Chart und CRUD-Tabelle
- Diätziele (moderat/normal/schnell) mit Kaloriendefizit/-überschuss
- Makronährstoff-Verteilung (Ausgewogen, Low-Carb, High-Protein) mit SVG-Kreisdiagramm
- Verlauf teilen per base64-URL (Auto-Update bei neueren Daten)
- BMI-Anzeige mit Farbcodierung
- Responsive Mobile-First Design mit Burger-Menü
- Komplett clientseitig - keine Serveranbindung, alle Daten im localStorage
- Deutsche Benutzeroberfläche

## Tech-Stack

- **HTML5** - Semantisches Markup
- **CSS3** - Custom Properties, Flexbox, Grid, Media Queries, Mobile-First
- **[Alpine.js](https://alpinejs.dev/)** - Reaktives UI-Framework (CDN, kein Build-Step)
- **[Toastify.js](https://apvarun.github.io/toastify-js/)** - Toast-Benachrichtigungen (CDN)
- **Canvas API** - Gewichtsverlauf-Diagramm
- **SVG** - Makronährstoff-Kreisdiagramm
- **localStorage** - Datenpersistenz (Multi-Profil)
- **Docksal** - Lokale Entwicklungsumgebung
- **GitHub Pages** - Hosting

## Projektstruktur

```
kcalc/
├── .docksal/
│   ├── docksal.yml        # Docker Compose Konfiguration
│   └── docksal.env        # Umgebungsvariablen
├── css/
│   ├── style.css          # Haupt-Stylesheet (Mobile-First)
│   └── print.css          # Druckansicht
├── js/
│   ├── calc.js            # Reine Berechnungsfunktionen (BMR, TDEE, BMI, Makros)
│   ├── chart.js           # Canvas Weight-Chart + SVG Makro-Pie
│   └── app.js             # Alpine.js Store (State, UI-Logik, Profil-Verwaltung)
├── img/
│   └── favicon.svg        # Favicon
├── index.html             # Hauptseite mit Alpine-Direktiven
├── CNAME                  # Custom Domain (kcalc.de)
├── LICENSE                # MIT Lizenz
└── README.md
```

## Lokale Entwicklung mit Docksal

### Voraussetzungen

- [Docksal](https://docksal.io/) installiert

### Setup

```bash
git clone git@github.com:casparjones/kcalc.git
cd kcalc
fin up
open http://kcalc.docksal.site
```

### Docksal-Befehle

| Befehl        | Beschreibung            |
|---------------|-------------------------|
| `fin up`      | Projekt starten         |
| `fin stop`    | Projekt stoppen         |
| `fin restart` | Projekt neu starten     |

## Lizenz

MIT License - siehe [LICENSE](LICENSE) für Details.
