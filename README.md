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
- Export/Import als JSON-Backup
- CouchDB Live-Sync via Connection String
- Google Drive AppData Sync (nur Chrome)
- Komplett clientseitig - keine Serveranbindung, Daten in IndexedDB (RxDB + Dexie)
- **PWA** - installierbar und voll offline-nutzbar (Service Worker), mit Offline-Hinweis und automatischer Sync-Fortsetzung bei Netzrückkehr
- Deutsche Benutzeroberfläche

## Tech-Stack

- **HTML5** - Semantisches Markup
- **CSS3** - Custom Properties, Flexbox, Grid, Media Queries, Mobile-First
- **[Alpine.js](https://alpinejs.dev/)** - Reaktives UI-Framework (CDN, kein Build-Step)
- **[Toastify.js](https://apvarun.github.io/toastify-js/)** - Toast-Benachrichtigungen (CDN)
- **Canvas API** - Gewichtsverlauf-Diagramm
- **SVG** - Makronährstoff-Kreisdiagramm
- **[RxDB](https://rxdb.info/)** (v15, Storage: Dexie) - Lokale Datenpersistenz (IndexedDB) mit reaktiven Queries
- **[RxForge](https://rxforge.de)** - Cloud-Sync via OAuth 2.0 (PKCE) und RxDB-Protokoll
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
│   ├── favicon.svg        # Favicon
│   ├── icon-192.png       # PWA-Icon
│   ├── icon-512.png       # PWA-Icon
│   ├── icon-maskable-512.png  # PWA-Icon (maskable)
│   └── apple-touch-icon.png   # iOS-Homescreen-Icon
├── index.html             # Hauptseite mit Alpine-Direktiven
├── manifest.json          # PWA Web App Manifest
├── sw.js                  # Service Worker (Offline-Cache)
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

## Self-Hosting

### Google Drive Backup

Das Google Drive Backup benötigt eine eigene OAuth Client ID aus der [Google Cloud Console](https://console.cloud.google.com/):

1. Neues Projekt erstellen (oder bestehendes nutzen)
2. Google Drive API aktivieren
3. OAuth-Zustimmungsbildschirm einrichten (Typ: Extern)
4. OAuth-Client-ID erstellen (Typ: Webanwendung)
   - Autorisierte JavaScript-Ursprünge: deine Domain (z.B. `https://meine-domain.de`)
5. Client ID in `js/app.js` eintragen - suche nach der bestehenden Client ID und ersetze sie:
   ```javascript
   client_id: 'DEINE_CLIENT_ID.apps.googleusercontent.com',
   ```

> **Hinweis:** GitHub Pages unterstützt keine Umgebungsvariablen. Die Client ID muss direkt im Code stehen. Das ist sicher - OAuth Client IDs sind öffentliche Identifier, kein Geheimnis.

## Lizenz

MIT License - siehe [LICENSE](LICENSE) für Details.
