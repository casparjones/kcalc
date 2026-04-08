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

## Lokale Entwicklung mit Docksal

### Voraussetzungen

- [Docksal](https://docksal.io/) installiert

### Setup

```bash
# Repository klonen
git clone <repo-url> kcalc
cd kcalc

# Docksal-Projekt starten
fin up

# Seite im Browser öffnen
open http://kcalc.docksal.site
```

### Docksal-Befehle

| Befehl    | Beschreibung                |
|-----------|-----------------------------|
| `fin up`  | Projekt starten             |
| `fin stop`| Projekt stoppen             |
| `fin restart` | Projekt neu starten     |

## Tech-Stack

- **HTML5** - Semantisches Markup
- **CSS3** - Custom Properties, Flexbox, Grid, Media Queries
- **JavaScript** (Vanilla) - Keine externen Abhängigkeiten
- **Docksal** - Lokale Entwicklungsumgebung
- **GitHub Pages** - Hosting

## Projektstruktur

```
kcalc/
├── .docksal/
│   ├── docksal.yml      # Docker Compose Konfiguration
│   └── docksal.env      # Umgebungsvariablen
├── css/
│   └── style.css        # Haupt-Stylesheet
├── js/
│   └── main.js          # Haupt-JavaScript
├── img/                 # Bilder und Icons
├── index.html           # Hauptseite
└── README.md            # Diese Datei
```

## Lizenz

MIT License - siehe [LICENSE](LICENSE) für Details.
