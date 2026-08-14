// Geräte-Identität für die Synchronisation.
//
// Jedes Gerät (genauer: jedes Browser-Profil) bekommt eine stabile ID in
// localStorage. Sie geht bei jedem Push an RxForge mit, damit dort ein Verlauf
// entsteht, welches Gerät welches Dokument geschrieben oder gelöscht hat.
// Die ID ist reine Protokoll-Information, sie gewährt keine Rechte.
'use strict';

var DEVICE_ID_KEY    = 'kcalc_device_id';
var DEVICE_LABEL_KEY = 'kcalc_device_label';

// Sollte zu CACHE_VERSION in sw.js passen; landet im Verlauf, damit man sieht,
// welche App-Version eine Änderung verursacht hat.
export var APP_VERSION = '1.9.0';

function randomId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        var arr = new Uint8Array(16);
        crypto.getRandomValues(arr);
        var hex = '';
        arr.forEach(function (b) { hex += (b + 0x100).toString(16).slice(1); });
        return hex;
    }
    return 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** Stabile Geräte-ID; wird beim ersten Aufruf erzeugt und dann wiederverwendet. */
export function getDeviceId() {
    var id = '';
    try { id = localStorage.getItem(DEVICE_ID_KEY) || ''; } catch (e) {}
    if (!id) {
        id = randomId();
        try { localStorage.setItem(DEVICE_ID_KEY, id); } catch (e) {}
    }
    return id;
}

/** Grobe Plattform-Erkennung – nur zur Anzeige im Verlauf, nicht für Logik. */
export function detectPlatform() {
    var ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    var os = 'Unbekannt';
    if (/iPhone/i.test(ua))            os = 'iPhone';
    else if (/iPad/i.test(ua))         os = 'iPad';
    else if (/Android/i.test(ua))      os = 'Android';
    else if (/Windows/i.test(ua))      os = 'Windows';
    else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
    else if (/CrOS/i.test(ua))         os = 'ChromeOS';
    else if (/Linux/i.test(ua))        os = 'Linux';

    // Reihenfolge wichtig: Edge/Opera/Samsung geben sich auch als Chrome aus,
    // Chrome auf iOS als CriOS, und Safari steht in fast jedem UA-String.
    var browser = 'Browser';
    if (/Edg\//i.test(ua))                        browser = 'Edge';
    else if (/OPR\/|Opera/i.test(ua))             browser = 'Opera';
    else if (/SamsungBrowser/i.test(ua))          browser = 'Samsung Internet';
    else if (/FxiOS|Firefox/i.test(ua))           browser = 'Firefox';
    else if (/CriOS/i.test(ua))                   browser = 'Chrome';
    else if (/Chrome/i.test(ua))                  browser = 'Chrome';
    else if (/Safari/i.test(ua))                  browser = 'Safari';

    return os + ' · ' + browser;
}

/** Anzeigename des Geräts. Standard aus dem User-Agent, vom Nutzer änderbar. */
export function getDeviceLabel() {
    var label = '';
    try { label = localStorage.getItem(DEVICE_LABEL_KEY) || ''; } catch (e) {}
    if (label) return label;

    label = detectPlatform();
    // PWA vom Homescreen verhält sich beim Storage anders als der Tab-Browser,
    // deshalb im Verlauf unterscheidbar machen.
    if (isStandalone()) label += ' (App)';
    return label;
}

/** Setzt einen eigenen Namen; leerer Wert stellt die automatische Erkennung wieder her. */
export function setDeviceLabel(label) {
    try {
        if (label && label.trim()) localStorage.setItem(DEVICE_LABEL_KEY, label.trim());
        else localStorage.removeItem(DEVICE_LABEL_KEY);
    } catch (e) {}
}

/** true, wenn die App als installierte PWA läuft (nicht im Browser-Tab). */
export function isStandalone() {
    try {
        if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
        return navigator.standalone === true; // iOS Safari
    } catch (e) {
        return false;
    }
}

/**
 * Kompaktes Objekt für den Push-Body.
 * @param {string} [reason] Auslöser, z.B. 'user-edit', 'periodic', 'recovery'.
 */
export function getDeviceInfo(reason) {
    return {
        deviceId:    getDeviceId(),
        deviceLabel: getDeviceLabel(),
        platform:    detectPlatform(),
        appVersion:  APP_VERSION,
        reason:      reason || 'sync'
    };
}
