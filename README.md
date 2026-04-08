# Diäthelfer - Kalorienbedarf Rechner

Ein moderner, browserbasierter Kalorienbedarf-Rechner als statische GitHub Pages Webseite. Berechne deinen täglichen Kalorienbedarf basierend auf der Mifflin-St Jeor Formel und erhalte personalisierte Empfehlungen für deine Diätziele.

## Features

- Berechnung des Grundumsatzes (BMR) nach Mifflin-St Jeor
- Berechnung des Gesamtumsatzes (TDEE) basierend auf Aktivitätslevel
- Personalisierte Diätziel-Empfehlungen (Abnehmen, Halten, Zunehmen)
- Makronährstoff-Verteilung (Protein, Kohlenhydrate, Fett)
- Responsive Design (Mobile-First)
- Komplett clientseitig - keine Serveranbindung nötig
- Deutsche Benutzeroberfläche

## Demo

Die Live-Version ist verfügbar unter: [GitHub Pages URL]

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
