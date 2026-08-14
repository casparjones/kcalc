// CouchDB + RxForge sync + reactive push
'use strict';

import {
    getDb, rxRemoveLocal,
    listTombstones, removeTombstones, pruneTombstones,
    getLocalState, setLocalState, DB_INSTANCE_KEY
} from './db.js';
import { getDeviceInfo } from './device.js';

// ===== CouchDB Sync State =====
const SYNC_KEY = 'kcalc_couchdb_url';
const SYNC_SEQ_KEY = 'kcalc_couch_seq';
var syncTimers = [];
var syncRunning = false;
var couchPushNow = null;     // von startSync gesetzt: löst einen sofortigen CouchDB-Push aus
var reactivePushTimer = null; // Debounce-Timer für reaktives Pushen

// Reaktiv pushen: nach lokalen Änderungen (anlegen/ändern/löschen) sofort
// synchronisieren, statt bis zum 30s-Intervall zu warten. Debounced, damit
// mehrere schnelle Änderungen zu einem Push zusammengefasst werden.
export function requestReactivePush() {
    if (reactivePushTimer) clearTimeout(reactivePushTimer);
    reactivePushTimer = setTimeout(function () {
        reactivePushTimer = null;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        // RxForge: rxforgePush() ist eigenständig und schickt auch die Löschbelege mit
        if (rxforgeHasToken() && !rxforgeSyncRunning) {
            rxforgeSyncRunning = true;
            rxforgePush({ reason: 'user-edit' })
                .then(function () { rxforgeSyncRunning = false; })
                .catch(function (e) { rxforgeSyncRunning = false; console.error('Reaktiver RxForge-Push fehlgeschlagen:', e); });
        }
        // CouchDB
        if (couchPushNow) couchPushNow();
    }, 500);
}

// ===== CouchDB Sync Functions =====
export function getSyncUrl() {
    return localStorage.getItem(SYNC_KEY) || '';
}

export function setSyncUrl(url) {
    if (url) localStorage.setItem(SYNC_KEY, url);
    else localStorage.removeItem(SYNC_KEY);
}

// Strip credentials from URL and return a fetch wrapper that injects Basic Auth header.
// fetch() refuses to construct Requests from URLs containing user:pass@.
export function buildCouchFetch(rawUrl) {
    try {
        var u = new URL(rawUrl);
        if (!u.username && !u.password) return { url: rawUrl, authFetch: fetch };
        var auth = 'Basic ' + btoa(u.username + ':' + u.password);
        u.username = '';
        u.password = '';
        // Build clean URL without credentials
        var cleanUrl = u.protocol + '//' + u.host + u.pathname + u.search + u.hash;
        var authFetch = function (input, init) {
            init = Object.assign({}, init);
            init.headers = Object.assign({ 'Authorization': auth }, init.headers || {});
            return fetch(input, init);
        };
        return { url: cleanUrl, authFetch: authFetch };
    } catch (e) {
        return { url: rawUrl, authFetch: fetch };
    }
}

// Custom CouchDB sync against the existing single database (same _id format as PouchDB).
// Uses _changes for pull and _bulk_docs for push — no new database creation required.
export function startSync(url, callbacks) {
    stopSync();
    if (!url) return;

    var built = buildCouchFetch(url.replace(/\/$/, '') + '/');
    var couchUrl = built.url;
    var authFetch = built.authFetch;

    function pull() {
        var since = localStorage.getItem(SYNC_SEQ_KEY) || '0';
        return authFetch(couchUrl + '_changes?since=' + encodeURIComponent(since) + '&include_docs=true&limit=200')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.results || data.results.length === 0) return false;

                var profileDocs = [], entryDocs = [], metaDocs = [];
                var delProfiles = [], delEntries = [], delMeta = [];
                for (var i = 0; i < data.results.length; i++) {
                    var row = data.results[i];
                    var doc = row.doc || {};
                    var deleted = row.deleted || doc._deleted;
                    var id = row.id;
                    if (id.startsWith('_')) continue;

                    if (deleted) {
                        // Server-Löschung lokal nachvollziehen (sonst pusht eine
                        // veraltete lokale Kopie den Eintrag wieder hoch).
                        if (id.indexOf('profile_') === 0)    delProfiles.push(id.slice(8));
                        else if (id.indexOf('entry_') === 0) delEntries.push(id.slice(6));
                        else if (id === 'meta_active')       delMeta.push('active');
                        continue;
                    }

                    if (id.startsWith('profile_') && doc.name) {
                        profileDocs.push({ id: doc.name, name: doc.name, profileJson: JSON.stringify(doc.profile || {}) });
                    } else if (id.startsWith('entry_') && doc.profileName && doc.date) {
                        entryDocs.push({ id: doc.profileName + '_' + doc.date, profileName: doc.profileName, date: doc.date, weight: doc.weight, entryId: doc.entryId || Date.now() });
                    } else if (id === 'meta_active') {
                        metaDocs.push({ key: 'active', value: doc.value || '' });
                    }
                }

                var ops = [];
                if (profileDocs.length) ops.push(getDb().profiles.bulkUpsert(profileDocs));
                if (entryDocs.length)   ops.push(getDb().entries.bulkUpsert(entryDocs));
                if (metaDocs.length)    ops.push(getDb().meta.bulkUpsert(metaDocs));
                if (delProfiles.length) ops.push(rxRemoveLocal(getDb().profiles, delProfiles));
                if (delEntries.length)  ops.push(rxRemoveLocal(getDb().entries, delEntries));
                if (delMeta.length)     ops.push(rxRemoveLocal(getDb().meta, delMeta));

                return Promise.all(ops).then(function () {
                    localStorage.setItem(SYNC_SEQ_KEY, String(data.last_seq || since));
                    return (profileDocs.length + entryDocs.length + metaDocs.length +
                            delProfiles.length + delEntries.length + delMeta.length) > 0;
                });
            });
    }

    function push() {
        return Promise.all([
            getDb().profiles.find().exec(),
            getDb().entries.find().exec(),
            getDb().meta.find().exec()
        ]).then(function (results) {
            var docs = [];
            results[0].forEach(function (d) {
                var p = {}; try { p = JSON.parse(d.toJSON().profileJson || '{}'); } catch (e) {}
                docs.push({ _id: 'profile_' + d.id, type: 'profile', name: d.name, profile: p });
            });
            results[1].forEach(function (d) {
                var e = d.toJSON();
                docs.push({ _id: 'entry_' + e.profileName + '_' + e.date, type: 'entry', profileName: e.profileName, date: e.date, weight: e.weight, entryId: e.entryId });
            });
            results[2].forEach(function (d) {
                var m = d.toJSON();
                docs.push({ _id: 'meta_' + m.key, type: 'meta', value: m.value });
            });

            // Alle Server-Dokumente holen: liefert die _rev (Konfliktvermeidung)
            // und die Liste der serverseitig vorhandenen IDs.
            return Promise.all([
                authFetch(couchUrl + '_all_docs').then(function (r) { return r.json(); }),
                listTombstones()
            ])
            .then(function (res) {
                var allDocs    = res[0];
                var tombstones = res[1] || [];

                var revMap = {};
                var localIds = {};
                docs.forEach(function (d) { localIds[d._id] = true; });
                (allDocs.rows || []).forEach(function (row) {
                    if (!row.id || row.id.charAt(0) === '_') return; // Design-Docs ignorieren
                    if (row.value && row.value.rev) revMap[row.id] = row.value.rev;
                });
                docs.forEach(function (d) { if (revMap[d._id]) d._rev = revMap[d._id]; });

                // Löschen NUR mit Löschbeleg. Vorher wurde alles gelöscht, was
                // serverseitig existiert und lokal fehlt - das leert den Server
                // komplett, sobald der Browser die IndexedDB weggeräumt hat.
                var tombstoneIds = {};
                tombstones.forEach(function (ts) {
                    tombstoneIds[ts.id] = true;
                    if (localIds[ts.id]) return;          // wieder angelegt
                    if (!revMap[ts.id]) return;           // serverseitig schon weg
                    docs.push({ _id: ts.id, _rev: revMap[ts.id], _deleted: true });
                });

                // Server-Docs, die lokal ohne Beleg fehlen: der Server gewinnt.
                // Sequenz zurücksetzen, damit der nächste pull() sie zurückholt.
                var missing = Object.keys(revMap).filter(function (id) {
                    return !localIds[id] && !tombstoneIds[id];
                });
                if (missing.length > 0) {
                    console.warn('CouchDB: ' + missing.length + ' Dokument(e) fehlen lokal ohne Löschbeleg – ' +
                                 'Serverstand wird beim nächsten Pull wiederhergestellt.');
                    localStorage.setItem(SYNC_SEQ_KEY, '0');
                }

                if (docs.length === 0) return;

                return authFetch(couchUrl + '_bulk_docs', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ docs: docs })
                });
            });
        });
    }

    function syncCycle() {
        if (syncRunning) return;
        syncRunning = true;
        if (callbacks.onActive) callbacks.onActive();

        pull()
            .then(function (hadChanges) {
                if (hadChanges && callbacks.onChange) callbacks.onChange({ direction: 'pull', change: { docs: [1] } });
                return push();
            })
            .then(function () {
                syncRunning = false;
                if (callbacks.onPaused) callbacks.onPaused(null);
            })
            .catch(function (err) {
                syncRunning = false;
                console.error('CouchDB sync error:', err);
                if (callbacks.onError) callbacks.onError(err);
            });
    }

    // Sofortiger Push nach lokalen Änderungen (nur Push, kein Pull davor,
    // damit eine gerade gelöschte Position nicht vorher wieder reingezogen wird).
    couchPushNow = function () {
        if (syncRunning) return;
        syncRunning = true;
        if (callbacks.onActive) callbacks.onActive();
        push()
            .then(function () { syncRunning = false; if (callbacks.onPaused) callbacks.onPaused(null); })
            .catch(function (err) { syncRunning = false; console.error('CouchDB push error:', err); if (callbacks.onError) callbacks.onError(err); });
    };

    syncCycle();
    syncTimers.push(setInterval(syncCycle, 30000));
}

export function stopSync() {
    syncTimers.forEach(function (t) { clearInterval(t); });
    syncTimers = [];
    syncRunning = false;
    couchPushNow = null;
}

// ===== RxForge Sync Functions (OAuth 2.0 + RxDB Native Protocol) =====
export const RXFORGE_ACCESS_KEY  = 'kcalc_rxforge_access_token';
export const RXFORGE_REFRESH_KEY = 'kcalc_rxforge_refresh_token';
export const RXFORGE_EXPIRES_KEY = 'kcalc_rxforge_expires_at';
export const RXFORGE_CHECKPOINT_KEY  = 'kcalc_rxforge_checkpoint';
export const RXFORGE_MASTER_CACHE_KEY = 'kcalc_rxforge_master_cache';
// Spiegel der IndexedDB-Kennung. Fehlt sie dort, wurde die lokale Datenbank
// weggeräumt und der hier liegende Sync-Zustand beschreibt Daten, die es nicht
// mehr gibt -> er darf dann nicht als Löschbefehl interpretiert werden.
export const RXFORGE_DB_INSTANCE_KEY = 'kcalc_rxforge_db_instance';
const RXFORGE_APP_ID    = 'a72c6d46-4d6a-46b4-b4c1-7ee6b31b21a3';
export const RXFORGE_BASE      = 'https://rxforge.de';
export const RXFORGE_CLIENT_ID = 'rxf_d1863d3a6fa94566';

var rxforgeSseSource    = null;
var rxforgeTimers       = [];
var rxforgeSyncRunning  = false;
var rxforgeRefreshPromise = null;

// Ergebnis der Integritätsprüfung für diese Sitzung:
// 'ok'               – lokale DB und Sync-Zustand passen zusammen
// 'local-db-lost'    – IndexedDB weg, localStorage noch da (der Datenverlust-Fall)
// 'instance-mismatch'– localStorage beschreibt eine andere lokale DB
// 'localstorage-lost'– localStorage weg, lokale DB intakt
// 'fresh'            – erste Nutzung auf diesem Gerät
var rxforgeIntegrity    = null;
// Nach einer Wiederherstellung genau einmal einen vollen Pull fahren.
var rxforgeNeedsFullPull = false;
// Callback, um die UI über eine Wiederherstellung zu informieren.
var rxforgeOnRecovery   = null;
// Verhindert, dass derselbe Wiederherstellungs-Hinweis in jedem Zyklus erscheint.
var rxforgeMissingNotified = false;

// --- OAuth helpers ---

export function rxforgeHasToken() {
    return !!localStorage.getItem(RXFORGE_ACCESS_KEY);
}

/** Returns a valid access_token, refreshing via refresh_token if needed.
 *  Coalesces parallel refresh calls into one request.
 *  Throws Error('TOKEN_EXPIRED') and clears storage when refresh fails. */
export function rxforgeGetValidToken() {
    var token     = localStorage.getItem(RXFORGE_ACCESS_KEY) || '';
    var expiresAt = parseInt(localStorage.getItem(RXFORGE_EXPIRES_KEY) || '0', 10);
    var refresh   = localStorage.getItem(RXFORGE_REFRESH_KEY) || '';

    if (token && expiresAt && expiresAt - Date.now() > 60000) {
        return Promise.resolve(token);
    }
    if (!refresh) return Promise.reject(new Error('TOKEN_EXPIRED'));

    if (!rxforgeRefreshPromise) {
        rxforgeRefreshPromise = fetch(RXFORGE_BASE + '/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'refresh_token', client_id: RXFORGE_CLIENT_ID, refresh_token: refresh }).toString()
        }).then(function (r) {
            if (!r.ok) {
                localStorage.removeItem(RXFORGE_ACCESS_KEY);
                localStorage.removeItem(RXFORGE_REFRESH_KEY);
                localStorage.removeItem(RXFORGE_EXPIRES_KEY);
                throw new Error('TOKEN_EXPIRED');
            }
            return r.json();
        }).then(function (data) {
            localStorage.setItem(RXFORGE_ACCESS_KEY, data.access_token);
            if (data.refresh_token) localStorage.setItem(RXFORGE_REFRESH_KEY, data.refresh_token);
            localStorage.setItem(RXFORGE_EXPIRES_KEY, String(Date.now() + data.expires_in * 1000));
            return data.access_token;
        }).finally(function () { rxforgeRefreshPromise = null; });
    }
    return rxforgeRefreshPromise;
}

export function rxforgeGenerateCodeVerifier() {
    var arr = new Uint8Array(32);
    window.crypto.getRandomValues(arr);
    var str = '';
    arr.forEach(function (b) { str += String.fromCharCode(b); });
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function rxforgeCodeChallenge(verifier) {
    return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
        .then(function (hash) {
            var str = '';
            new Uint8Array(hash).forEach(function (b) { str += String.fromCharCode(b); });
            return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        });
}

/** Redirect the browser to the RxForge OAuth authorize page. */
export function rxforgeOAuthConnect() {
    var verifier = rxforgeGenerateCodeVerifier();
    var state    = Math.random().toString(36).slice(2);
    sessionStorage.setItem('rxforge_cv', verifier);
    sessionStorage.setItem('rxforge_state', state);

    rxforgeCodeChallenge(verifier).then(function (challenge) {
        var redirectUri = window.location.origin;
        var params = new URLSearchParams({
            client_id:             RXFORGE_CLIENT_ID,
            redirect_uri:          redirectUri,
            response_type:         'code',
            code_challenge:        challenge,
            code_challenge_method: 'S256',
            state:                 state
        });
        window.location.href = RXFORGE_BASE + '/oauth/authorize?' + params.toString();
    });
}

/**
 * Call on page load: exchanges the OAuth ?code= callback for tokens.
 * Returns a Promise that resolves to the access_token string, or '' if no code present.
 */
export function rxforgeHandleOAuthCallback() {
    var params   = new URLSearchParams(window.location.search);
    var code     = params.get('code');
    var state    = params.get('state');
    if (!code) return Promise.resolve('');

    var expectedState = sessionStorage.getItem('rxforge_state');
    var verifier      = sessionStorage.getItem('rxforge_cv');
    sessionStorage.removeItem('rxforge_cv');
    sessionStorage.removeItem('rxforge_state');
    window.history.replaceState({}, document.title, window.location.pathname);

    if (state !== expectedState || !verifier) return Promise.resolve('');

    return fetch(RXFORGE_BASE + '/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type:    'authorization_code',
            client_id:     RXFORGE_CLIENT_ID,
            code:          code,
            code_verifier: verifier,
            redirect_uri:  window.location.origin
        }).toString()
    }).then(function (r) {
        if (!r.ok) throw new Error('OAuth Token-Austausch fehlgeschlagen: ' + r.status);
        return r.json();
    }).then(function (data) {
        localStorage.setItem(RXFORGE_ACCESS_KEY, data.access_token);
        if (data.refresh_token) localStorage.setItem(RXFORGE_REFRESH_KEY, data.refresh_token);
        if (data.expires_in)    localStorage.setItem(RXFORGE_EXPIRES_KEY, String(Date.now() + data.expires_in * 1000));
        return data.access_token;
    });
}

// --- Master-State Cache (needed for assumedMasterState in push rows) ---

export function rxforgeLoadMasterCache() {
    var raw = localStorage.getItem(RXFORGE_MASTER_CACHE_KEY);
    if (raw) try { return JSON.parse(raw); } catch (e) {}
    return {};
}

export function rxforgeSaveMasterCache(cache) {
    localStorage.setItem(RXFORGE_MASTER_CACHE_KEY, JSON.stringify(cache));
}

// --- Integrität des lokalen Speichers ---

function rxforgeNewInstanceId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'inst-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/**
 * Prüft, ob IndexedDB und localStorage noch dieselbe Datenbank beschreiben.
 *
 * Hintergrund: Der Sync-Zustand (Checkpoint + Master-Cache) liegt in
 * localStorage, die Daten in IndexedDB. Browser räumen beide unabhängig
 * voneinander weg – Safari löscht script-writable Storage nach ~7 Tagen ohne
 * Besuch, und ein manuelles "IndexedDB löschen" trifft localStorage gar nicht.
 * Bleibt der Sync-Zustand ohne Daten zurück, sieht die App überall Löschungen,
 * wo eigentlich nur ihr Speicher leer ist. Genau das wird hier erkannt.
 *
 * @returns {Promise<string>} einer der oben dokumentierten Modi
 */
export function rxforgeCheckIntegrity() {
    var lsInstance = localStorage.getItem(RXFORGE_DB_INSTANCE_KEY) || '';
    return getLocalState(DB_INSTANCE_KEY).then(function (dbInstance) {
        if (lsInstance && dbInstance && lsInstance === dbInstance) return 'ok';

        var mode;
        if (lsInstance && !dbInstance)      mode = 'local-db-lost';
        else if (lsInstance && dbInstance)  mode = 'instance-mismatch';
        else if (!lsInstance && dbInstance) mode = 'localstorage-lost';
        else                                mode = 'fresh';

        // Die lokale DB ist die Wahrheit über sich selbst: ihre Kennung
        // übernehmen, sonst eine neue erzeugen und beide Speicher angleichen.
        var instance = dbInstance || rxforgeNewInstanceId();
        return setLocalState(DB_INSTANCE_KEY, instance).then(function () {
            localStorage.setItem(RXFORGE_DB_INSTANCE_KEY, instance);
            return mode;
        });
    });
}

/**
 * Einmal pro Sitzung: Integrität prüfen und bei Verdacht auf verlorene lokale
 * Daten den Sync-Zustand verwerfen, damit der SERVER gewinnt statt der leeren
 * lokalen Datenbank.
 */
export function rxforgeEnsureHealthy() {
    if (rxforgeIntegrity) return Promise.resolve(rxforgeIntegrity);

    return rxforgeCheckIntegrity().then(function (mode) {
        rxforgeIntegrity = mode;

        if (mode === 'local-db-lost' || mode === 'instance-mismatch') {
            // Checkpoint und Master-Cache beschreiben Dokumente, die lokal nicht
            // mehr existieren. Würden sie stehen bleiben, pusht die App für jedes
            // davon ein _deleted und löscht den Serverbestand. Also wegwerfen und
            // alles neu vom Server ziehen.
            console.warn('RxForge: lokale Datenbank war leer/neu (' + mode + ') – ' +
                         'Sync-Zustand wird verworfen, Serverdaten werden wiederhergestellt.');
            localStorage.removeItem(RXFORGE_CHECKPOINT_KEY);
            localStorage.removeItem(RXFORGE_MASTER_CACHE_KEY);
            rxforgeNeedsFullPull = true;
            if (rxforgeOnRecovery) rxforgeOnRecovery(mode);
        } else if (mode === 'localstorage-lost' || mode === 'fresh') {
            // Kein Sync-Zustand vorhanden -> ohnehin voller Pull, aber die lokale
            // DB (und damit die Grabsteine) ist intakt.
            rxforgeNeedsFullPull = true;
        }

        return mode;
    });
}

/** true, sobald der lokale Stand als vertrauenswürdig gilt. */
function rxforgeLocalTrusted() {
    return rxforgeIntegrity === 'ok' || rxforgeIntegrity === 'localstorage-lost';
}

// --- Sync core ---

/** Wendet Server-Dokumente auf die lokale Datenbank an. Gemeinsam genutzt von
 *  Pull und Wiederherstellung. Gibt die Zahl der betroffenen Dokumente zurück. */
function rxforgeApplyServerDocs(docs, masterCache) {
    var profileDocs  = [], entryDocs = [], metaDocs = [];
    var delProfiles  = [], delEntries = [], delMeta = [];

    docs.forEach(function (doc) {
        var id = doc.id || '';
        if (masterCache) masterCache[id] = doc; // Serverstand für den Push merken
        if (doc._deleted) {
            // Server-Löschung lokal nachvollziehen, sonst bleibt eine
            // veraltete lokale Kopie liegen und pusht den Eintrag wieder
            // als "lebendig" hoch (Wiederauferstehung über Geräte hinweg).
            if (id.indexOf('profile_') === 0)    delProfiles.push(id.slice(8));
            else if (id.indexOf('entry_') === 0) delEntries.push(id.slice(6));
            else if (id.indexOf('meta_') === 0)  delMeta.push(id.slice(5));
            return;
        }

        if (id.startsWith('profile_') && doc.name) {
            profileDocs.push({ id: doc.name, name: doc.name, profileJson: doc.profileJson || JSON.stringify(doc.profile || {}) });
        } else if (id.startsWith('entry_') && doc.profileName && doc.date) {
            entryDocs.push({ id: doc.profileName + '_' + doc.date, profileName: doc.profileName, date: doc.date, weight: doc.weight || 0, entryId: doc.entryId || Date.now() });
        } else if (id.startsWith('meta_') && doc.key) {
            metaDocs.push({ key: doc.key, value: doc.value || '' });
        }
    });

    var ops = [];
    if (profileDocs.length) ops.push(getDb().profiles.bulkUpsert(profileDocs));
    if (entryDocs.length)   ops.push(getDb().entries.bulkUpsert(entryDocs));
    if (metaDocs.length)    ops.push(getDb().meta.bulkUpsert(metaDocs));
    if (delProfiles.length) ops.push(rxRemoveLocal(getDb().profiles, delProfiles));
    if (delEntries.length)  ops.push(rxRemoveLocal(getDb().entries, delEntries));
    if (delMeta.length)     ops.push(rxRemoveLocal(getDb().meta, delMeta));

    // Vom Server (wieder) gelieferte Dokumente heben einen lokalen Löschbeleg
    // NICHT auf – deshalb hier keine Grabsteine anfassen. Umgekehrt braucht ein
    // vom Server gelöschtes Dokument keinen neuen Beleg.
    var touched = profileDocs.length + entryDocs.length + metaDocs.length +
                  delProfiles.length + delEntries.length + delMeta.length;

    return Promise.all(ops).then(function () { return touched; });
}

/** Holt eine Seite Änderungen. `checkpointOverride === ''` startet von vorn. */
function rxforgePullPage(checkpointOverride) {
    return rxforgeGetValidToken().then(function (token) {
        var checkpoint = checkpointOverride != null
            ? checkpointOverride
            : (localStorage.getItem(RXFORGE_CHECKPOINT_KEY) || '');
        var url = RXFORGE_BASE + '/api/v1/sync/' + RXFORGE_APP_ID + '/pull?limit=100';
        if (checkpoint) url += '&checkpoint=' + encodeURIComponent(checkpoint);

        return fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
            .then(function (r) {
                if (r.status === 401 || r.status === 403) throw new Error('TOKEN_EXPIRED');
                if (!r.ok) throw new Error('RxForge Pull fehlgeschlagen: ' + r.status);
                return r.json();
            }).then(function (data) {
                // Always advance checkpoint (server may filter docs but still move forward)
                var newCheckpoint = data.checkpoint != null ? String(data.checkpoint) : checkpoint;
                if (data.checkpoint != null) localStorage.setItem(RXFORGE_CHECKPOINT_KEY, newCheckpoint);

                var docs = data.documents || [];
                if (docs.length === 0) {
                    return { changed: false, docCount: 0, checkpoint: newCheckpoint, advanced: newCheckpoint !== checkpoint };
                }

                var masterCache = rxforgeLoadMasterCache();
                return rxforgeApplyServerDocs(docs, masterCache).then(function (touched) {
                    rxforgeSaveMasterCache(masterCache);
                    return {
                        changed: touched > 0,
                        docCount: docs.length,
                        checkpoint: newCheckpoint,
                        advanced: newCheckpoint !== checkpoint
                    };
                });
            });
    });
}

/** Eine Seite Änderungen ab dem gespeicherten Checkpoint. */
export function rxforgePull() {
    return rxforgePullPage().then(function (res) { return res.changed; });
}

/**
 * Zieht den KOMPLETTEN Serverbestand (Checkpoint zurücksetzen, dann Seite für
 * Seite). Wird nach einer erkannten Speicherlöschung benutzt: der Server ist
 * dann die Wahrheit und stellt den lokalen Bestand wieder her.
 */
export function rxforgeFullPull() {
    var PAGE_LIMIT = 100;
    var MAX_PAGES  = 500;   // Sicherheitsnetz gegen einen nicht vorrückenden Checkpoint
    var changed = false;

    localStorage.removeItem(RXFORGE_CHECKPOINT_KEY);

    function nextPage(pageNo, fromCheckpoint) {
        if (pageNo > MAX_PAGES) {
            console.warn('RxForge: voller Pull nach ' + MAX_PAGES + ' Seiten abgebrochen.');
            return Promise.resolve(changed);
        }
        return rxforgePullPage(fromCheckpoint).then(function (res) {
            if (res.changed) changed = true;
            // Fertig, wenn die Seite nicht voll war oder der Checkpoint stehen blieb.
            if (res.docCount < PAGE_LIMIT || !res.advanced) return changed;
            return nextPage(pageNo + 1, res.checkpoint);
        });
    }

    return nextPage(1, '').then(function (res) {
        rxforgeNeedsFullPull = false;
        // Nach einem vollständigen Pull deckt sich der lokale Stand wieder mit
        // dem Server. Ab hier sind Löschbelege dieses Geräts wieder gültig.
        // Bewusst hier und nicht im Sync-Zyklus: auch ein reaktiver Push nach
        // einer Wiederherstellung soll seine Löschungen loswerden.
        rxforgeIntegrity = 'ok';
        return res;
    });
}

// Vergleicht den fachlichen Inhalt eines neu gebauten Push-Status mit dem
// zuletzt bekannten Serverstand. updatedAt wird bewusst ignoriert, damit ein
// reiner Timestamp-Unterschied NICHT als Änderung gilt. Nur so lässt sich die
// Push/Pull-Endlosschleife verhindern (sonst macht jedes frische updatedAt
// jedes Dokument bei jedem Zyklus wieder "dirty").
export function rxforgeContentEqual(state, master) {
    if (!master || master._deleted) return false;
    var keys = Object.keys(state);
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (k === 'updatedAt') continue;
        var a = state[k], b = master[k];
        if (a && typeof a === 'object') {
            if (JSON.stringify(a) !== JSON.stringify(b)) return false;
        } else if (a !== b) {
            return false;
        }
    }
    return true;
}

/**
 * Schickt lokale Änderungen an RxForge.
 *
 * Wichtig: Gelöscht wird NUR, wofür es einen Grabstein in der lokalen Datenbank
 * gibt. Ein Dokument, das der Master-Cache kennt, das lokal aber ohne Beleg
 * fehlt, gilt als VERLOREN und nicht als gelöscht – dann gewinnt der Server und
 * der Eintrag wird lokal wiederhergestellt.
 *
 * @param {{reason?: string}} [opts] Auslöser für den Verlauf, z.B. 'user-edit'.
 */
export function rxforgePush(opts) {
    var reason = (opts && opts.reason) || 'sync';

    return rxforgeEnsureHealthy().then(function () {
        // Steht eine Wiederherstellung aus, erst den Server holen. Sonst würde
        // ein reaktiver Push (Nutzer ändert etwas direkt nach dem Start) auf
        // einem unvollständigen lokalen Stand arbeiten.
        return rxforgeNeedsFullPull ? rxforgeFullPull() : null;
    }).then(function () {
        return rxforgeGetValidToken();
    }).then(function (token) {
        return Promise.all([
            getDb().profiles.find().exec(),
            getDb().entries.find().exec(),
            getDb().meta.find().exec(),
            listTombstones()
        ]).then(function (results) {
            var masterCache = rxforgeLoadMasterCache();
            var now  = Date.now();
            var rows = [];
            var currentIds = {};

            // Eine Zeile NUR pushen, wenn sich der Inhalt gegenüber dem
            // Serverstand wirklich geändert hat; updatedAt wird ausschließlich
            // dann (auf "now") neu vergeben. Unveränderte Dokumente werden gar
            // nicht gepusht -> im Leerlauf bleibt rows leer und es geht kein
            // Traffic raus. currentIds erfasst trotzdem ALLE lokal vorhandenen
            // Dokumente.
            function consider(rid, state) {
                currentIds[rid] = true;
                var master = masterCache[rid] || null;
                if (rxforgeContentEqual(state, master)) return; // unverändert -> nicht pushen
                state.updatedAt = now;
                rows.push({ assumedMasterState: master, newDocumentState: state });
            }

            results[0].forEach(function (d) {
                var p = {}; try { p = JSON.parse(d.toJSON().profileJson || '{}'); } catch (e) {}
                var rid = 'profile_' + d.id;
                consider(rid, { id: rid, type: 'profile', name: d.name, profileJson: d.toJSON().profileJson, profile: p });
            });
            results[1].forEach(function (d) {
                var e   = d.toJSON();
                var rid = 'entry_' + e.id;
                consider(rid, { id: rid, type: 'entry', profileName: e.profileName, date: e.date, weight: e.weight, entryId: e.entryId });
            });
            results[2].forEach(function (d) {
                var m   = d.toJSON();
                var rid = 'meta_' + m.key;
                consider(rid, { id: rid, type: 'meta', key: m.key, value: m.value });
            });

            // --- Löschungen: ausschließlich aus Grabsteinen ---
            var tombstones     = results[3] || [];
            var tombstoneIds   = {};
            var staleTombstones = [];   // Beleg hinfällig -> lokal aufräumen

            tombstones.forEach(function (ts) {
                tombstoneIds[ts.id] = true;

                // Dokument wurde nach dem Löschen wieder angelegt -> Beleg verwerfen,
                // sonst würde der Neuanlage direkt wieder eine Löschung folgen.
                if (currentIds[ts.id]) { staleTombstones.push(ts.id); return; }

                var prev = masterCache[ts.id] || null;
                if (prev && prev._deleted) { staleTombstones.push(ts.id); return; } // Server weiß es schon

                // Löschungen erst schicken, wenn der lokale Stand vertrauenswürdig
                // ist. Direkt nach einer Wiederherstellung wird erst gepullt.
                if (!rxforgeLocalTrusted()) return;

                rows.push({
                    assumedMasterState: prev,
                    newDocumentState: prev
                        ? Object.assign({}, prev, { _deleted: true, updatedAt: now })
                        : { id: ts.id, _deleted: true, updatedAt: now }
                });
            });

            // --- Fehlend ohne Beleg: der Server gewinnt ---
            // Früher wurde genau das als Löschung interpretiert – der Grund für
            // den Totalverlust, wenn der Browser die IndexedDB weggeräumt hatte.
            var missing = Object.keys(masterCache).filter(function (rid) {
                var m = masterCache[rid];
                return m && !m._deleted && !currentIds[rid] && !tombstoneIds[rid];
            });

            var pre = Promise.resolve();
            if (missing.length > 0) {
                console.warn('RxForge: ' + missing.length + ' Dokument(e) fehlen lokal ohne Löschbeleg – ' +
                             'Serverstand wird wiederhergestellt.');
                var restoreDocs = missing.map(function (rid) { return masterCache[rid]; });
                // Sofort aus dem bekannten Serverstand wiederherstellen und
                // zusätzlich einen vollen Pull anstoßen, damit der echte
                // Serverstand (nicht nur der Cache) die Grundlage wird.
                rxforgeNeedsFullPull = true;
                reason = 'recovery';
                // Nur einmal pro Sitzung melden, sonst poppt bei jedem Zyklus ein Hinweis auf.
                if (rxforgeOnRecovery && !rxforgeMissingNotified) {
                    rxforgeMissingNotified = true;
                    rxforgeOnRecovery('missing-docs');
                }
                pre = rxforgeApplyServerDocs(restoreDocs, null);
            }

            return pre.then(function () {
                if (staleTombstones.length === 0 && rows.length === 0) return;
                return removeTombstones(staleTombstones).then(function () {
                    if (rows.length === 0) return;
                    return rxforgeSendPush(token, rows, reason, masterCache);
                });
            });
        });
    });
}

/** Führt den eigentlichen Push aus und verarbeitet Konflikte. */
function rxforgeSendPush(token, rows, reason, masterCache) {
    var deviceInfo = getDeviceInfo(reason);

    return fetch(RXFORGE_BASE + '/api/v1/sync/' + RXFORGE_APP_ID + '/push', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token,
            // Zusätzlich als Header, damit die Zuordnung auch dann steht, wenn
            // ein Server den Body-Anteil (noch) nicht kennt.
            'X-RxForge-Device-Id': deviceInfo.deviceId,
            'X-RxForge-Device-Label': deviceInfo.deviceLabel
        },
        body: JSON.stringify({ rows: rows, client: deviceInfo })
    }).then(function (r) {
        if (r.status === 401 || r.status === 403) throw new Error('TOKEN_EXPIRED');
        if (!r.ok) throw new Error('RxForge Push fehlgeschlagen: ' + r.status);
        return r.json();
    }).then(function (data) {
        var conflicts    = data.conflicts || [];
        var conflictIds  = {};
        conflicts.forEach(function (d) { conflictIds[d.id] = true; });

        // Master-Cache nur für tatsächlich geschriebene Zeilen fortschreiben.
        rows.forEach(function (row) {
            var id = row.newDocumentState.id;
            if (!conflictIds[id]) masterCache[id] = row.newDocumentState;
        });

        // Konflikte: der Server gewinnt, wenn sein Stand neuer ist (LWW über updatedAt)
        var localWrites = [];
        conflicts.forEach(function (serverDoc) {
            masterCache[serverDoc.id] = serverDoc; // immer den echten Serverstand merken
            var localRow = null;
            for (var i = 0; i < rows.length; i++) {
                if (rows[i].newDocumentState.id === serverDoc.id) { localRow = rows[i]; break; }
            }
            if (!localRow) return;
            if (!serverDoc._deleted && (serverDoc.updatedAt || 0) >= (localRow.newDocumentState.updatedAt || 0)) {
                var id = serverDoc.id || '';
                if (id.startsWith('profile_') && serverDoc.name)
                    localWrites.push(getDb().profiles.upsert({ id: serverDoc.name, name: serverDoc.name, profileJson: serverDoc.profileJson || JSON.stringify(serverDoc.profile || {}) }));
                else if (id.startsWith('entry_') && serverDoc.profileName && serverDoc.date)
                    localWrites.push(getDb().entries.upsert({ id: serverDoc.profileName + '_' + serverDoc.date, profileName: serverDoc.profileName, date: serverDoc.date, weight: serverDoc.weight || 0, entryId: serverDoc.entryId }));
                else if (id.startsWith('meta_') && serverDoc.key)
                    localWrites.push(getDb().meta.upsert({ key: serverDoc.key, value: serverDoc.value || '' }));
            }
        });

        rxforgeSaveMasterCache(masterCache);

        // Löschbelege bleiben bewusst liegen (siehe pruneTombstones): der
        // Master-Cache merkt sich die Löschung, also wird sie nicht erneut
        // gepusht, aber ein zweites Sync-Ziel kann sie noch abholen.
        return Promise.all(localWrites);
    });
}

export function rxforgeStartSse(onChanges) {
    if (rxforgeSseSource) { rxforgeSseSource.close(); rxforgeSseSource = null; }
    rxforgeGetValidToken().then(function (token) {
        if (!token) return;
        var url = RXFORGE_BASE + '/api/v1/sync/' + RXFORGE_APP_ID + '/stream?access_token=' + encodeURIComponent(token);
        try {
            rxforgeSseSource = new EventSource(url);
            // Der Server sendet BENANNTE SSE-Events ("event: change"). EventSource.onmessage
            // feuert ausschliesslich fuer UNBENANNTE Events (Typ "message") -> die change-Events
            // liefen bisher ins Leere und Aenderungen kamen erst per 30s-Polling an. Daher
            // gezielt auf "change" hoeren -> sofortiger reaktiver Pull.
            var handleSse = function (event) {
                var d = null;
                try { d = event && event.data ? JSON.parse(event.data) : null; } catch (e) {}
                if (onChanges) onChanges(d);
            };
            rxforgeSseSource.addEventListener('change', handleSse);
            rxforgeSseSource.onmessage = handleSse; // Fallback fuer unbenannte Events
            // Bei (Wieder-)Verbindung einmal nachziehen: waehrend einer Unterbrechung
            // verpasste Aenderungen holt der Pull anhand des gespeicherten Checkpoints auf.
            rxforgeSseSource.onopen = function () { if (onChanges) onChanges(null); };
            // onerror nicht schliessen: EventSource reconnectet selbsttaetig.
        } catch (e) {
            console.warn('RxForge SSE nicht verfügbar, nur Polling aktiv');
        }
    });
}

export function startRxForgeSync(callbacks) {
    stopRxForgeSync();
    if (!rxforgeHasToken()) return;

    rxforgeOnRecovery = function (mode) {
        if (callbacks.onRecovery) callbacks.onRecovery(mode);
    };

    function syncCycle() {
        if (rxforgeSyncRunning) return;
        rxforgeSyncRunning = true;
        if (callbacks.onActive) callbacks.onActive();

        // Vor allem anderen prüfen, ob der lokale Speicher noch zum Sync-Zustand
        // passt. Fehlt die lokale Datenbank, wird komplett neu vom Server geladen,
        // statt deren Abwesenheit als Löschung zu interpretieren.
        rxforgeEnsureHealthy()
            .then(function () {
                return rxforgeNeedsFullPull ? rxforgeFullPull() : rxforgePull();
            })
            .then(function (hadChanges) {
                if (hadChanges && callbacks.onChange) callbacks.onChange();
                return rxforgePush({ reason: 'sync' });
            })
            .then(function () {
                // Alte Löschbelege abräumen (best effort, blockiert den Sync nicht).
                return pruneTombstones().catch(function () {});
            })
            .then(function () {
                rxforgeSyncRunning = false;
                if (callbacks.onPaused) callbacks.onPaused(null);
            })
            .catch(function (err) {
                rxforgeSyncRunning = false;
                console.error('RxForge Sync-Fehler:', err);
                if (callbacks.onError) callbacks.onError(err);
            });
    }

    // Echtzeit ueber den SSE-Stream: jede Server-Aenderung loest sofort einen Pull aus.
    rxforgeStartSse(function () { syncCycle(); });
    syncCycle();
    // Reiner Fallback (Sicherheitsnetz), falls der Stream still wegbricht: seltener Pull.
    // Den schnellen Abgleich macht der Stream; daher 60s statt des frueheren 30s-Takts.
    rxforgeTimers.push(setInterval(syncCycle, 60000));
}

export function stopRxForgeSync() {
    rxforgeTimers.forEach(function (t) { clearInterval(t); });
    rxforgeTimers = [];
    rxforgeSyncRunning = false;
    rxforgeOnRecovery = null;
    if (rxforgeSseSource) { rxforgeSseSource.close(); rxforgeSseSource = null; }
}

/** Setzt die Integritätsprüfung zurück (z.B. nach Abmelden/Neuverbinden). */
export function rxforgeResetIntegrityState() {
    rxforgeIntegrity = null;
    rxforgeNeedsFullPull = false;
    rxforgeMissingNotified = false;
}
