// CouchDB + RxForge sync + reactive push
'use strict';

import { getDb, rxRemoveLocal } from './db.js';

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
        // RxForge: rxforgePush() ist eigenständig und enthält die Löscherkennung
        if (rxforgeHasToken() && !rxforgeSyncRunning) {
            rxforgeSyncRunning = true;
            rxforgePush()
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

            if (docs.length === 0) return;

            // Alle Server-Dokumente holen: liefert die _rev (Konfliktvermeidung)
            // UND erlaubt Löscherkennung. RxDB-Soft-Deletes sind von .find() oben
            // ausgeblendet, daher fehlen lokal gelöschte Docs in "docs" - sie müssen
            // serverseitig als _deleted markiert werden, sonst kommen sie beim Pull zurück.
            return authFetch(couchUrl + '_all_docs')
            .then(function (r) { return r.json(); })
            .then(function (allDocs) {
                var revMap = {};
                var localIds = {};
                docs.forEach(function (d) { localIds[d._id] = true; });
                (allDocs.rows || []).forEach(function (row) {
                    if (!row.id || row.id.charAt(0) === '_') return; // Design-Docs ignorieren
                    if (row.value && row.value.rev) revMap[row.id] = row.value.rev;
                });
                docs.forEach(function (d) { if (revMap[d._id]) d._rev = revMap[d._id]; });

                // Server-Docs, die lokal nicht mehr existieren -> löschen.
                // (pull() läuft im selben Sync-Zyklus vor push(), daher ist der
                // lokale Stand vorher aktuell und es werden keine fremden Docs gelöscht.)
                Object.keys(revMap).forEach(function (id) {
                    if (!localIds[id]) {
                        docs.push({ _id: id, _rev: revMap[id], _deleted: true });
                    }
                });

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
const RXFORGE_APP_ID    = 'a72c6d46-4d6a-46b4-b4c1-7ee6b31b21a3';
export const RXFORGE_BASE      = 'https://rxforge.de';
export const RXFORGE_CLIENT_ID = 'rxf_d1863d3a6fa94566';

var rxforgeSseSource    = null;
var rxforgeTimers       = [];
var rxforgeSyncRunning  = false;
var rxforgeRefreshPromise = null;

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

// --- Sync core ---

export function rxforgePull() {
    return rxforgeGetValidToken().then(function (token) {
        var checkpoint = localStorage.getItem(RXFORGE_CHECKPOINT_KEY) || '';
        var url = RXFORGE_BASE + '/api/v1/sync/' + RXFORGE_APP_ID + '/pull?limit=100';
        if (checkpoint) url += '&checkpoint=' + encodeURIComponent(checkpoint);

        return fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
            .then(function (r) {
                if (r.status === 401 || r.status === 403) throw new Error('TOKEN_EXPIRED');
                if (!r.ok) throw new Error('RxForge Pull fehlgeschlagen: ' + r.status);
                return r.json();
            }).then(function (data) {
                // Always advance checkpoint (server may filter docs but still move forward)
                if (data.checkpoint != null) localStorage.setItem(RXFORGE_CHECKPOINT_KEY, String(data.checkpoint));

                var docs = data.documents || [];
                if (docs.length === 0) return false;

                var masterCache  = rxforgeLoadMasterCache();
                var profileDocs  = [], entryDocs = [], metaDocs = [];
                var delProfiles  = [], delEntries = [], delMeta = [];

                docs.forEach(function (doc) {
                    var id = doc.id || '';
                    masterCache[id] = doc; // track server state for later push
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

                rxforgeSaveMasterCache(masterCache);

                var ops = [];
                if (profileDocs.length) ops.push(getDb().profiles.bulkUpsert(profileDocs));
                if (entryDocs.length)   ops.push(getDb().entries.bulkUpsert(entryDocs));
                if (metaDocs.length)    ops.push(getDb().meta.bulkUpsert(metaDocs));
                if (delProfiles.length) ops.push(rxRemoveLocal(getDb().profiles, delProfiles));
                if (delEntries.length)  ops.push(rxRemoveLocal(getDb().entries, delEntries));
                if (delMeta.length)     ops.push(rxRemoveLocal(getDb().meta, delMeta));

                return Promise.all(ops).then(function () {
                    return (profileDocs.length + entryDocs.length + metaDocs.length +
                            delProfiles.length + delEntries.length + delMeta.length) > 0;
                });
            });
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

export function rxforgePush() {
    return rxforgeGetValidToken().then(function (token) {
        return Promise.all([
            getDb().profiles.find().exec(),
            getDb().entries.find().exec(),
            getDb().meta.find().exec()
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
            // Dokumente, damit die Löscherkennung unten korrekt bleibt.
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

            // Löschungen erkennen: Dokumente, die der masterCache kennt, die aber
            // lokal nicht mehr existieren (RxDB-Soft-Delete -> von .find() ausgeblendet),
            // müssen als _deleted gepusht werden, sonst kommen sie beim Pull zurück.
            Object.keys(masterCache).forEach(function (rid) {
                var prev = masterCache[rid];
                if (!prev || prev._deleted) return;   // bereits gelöscht
                if (currentIds[rid]) return;          // existiert lokal noch
                rows.push({
                    assumedMasterState: prev,
                    newDocumentState: Object.assign({}, prev, { _deleted: true, updatedAt: now })
                });
            });

            if (rows.length === 0) return;

            return fetch(RXFORGE_BASE + '/api/v1/sync/' + RXFORGE_APP_ID + '/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ rows: rows })
            }).then(function (r) {
                if (r.status === 401 || r.status === 403) throw new Error('TOKEN_EXPIRED');
                if (!r.ok) throw new Error('RxForge Push fehlgeschlagen: ' + r.status);
                return r.json();
            }).then(function (data) {
                // Update cache with successfully written docs
                rows.forEach(function (row) { masterCache[row.newDocumentState.id] = row.newDocumentState; });

                // Conflicts: server's actual state wins when server is newer (last-write-wins by updatedAt)
                var conflicts   = data.conflicts || [];
                var localWrites = [];
                conflicts.forEach(function (serverDoc) {
                    masterCache[serverDoc.id] = serverDoc; // always track real master state
                    var localRow = null;
                    for (var i = 0; i < rows.length; i++) {
                        if (rows[i].newDocumentState.id === serverDoc.id) { localRow = rows[i]; break; }
                    }
                    if (!localRow) return;
                    // If server is newer, overwrite local
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
                return Promise.all(localWrites);
            });
        });
    });
}

export function rxforgeStartSse(onChanges) {
    if (rxforgeSseSource) { rxforgeSseSource.close(); rxforgeSseSource = null; }
    rxforgeGetValidToken().then(function (token) {
        if (!token) return;
        var url = RXFORGE_BASE + '/api/v1/sync/' + RXFORGE_APP_ID + '/stream?access_token=' + encodeURIComponent(token);
        try {
            rxforgeSseSource = new EventSource(url);
            rxforgeSseSource.onmessage = function (event) {
                try { var d = JSON.parse(event.data); if (d && onChanges) onChanges(d); } catch (e) {}
            };
        } catch (e) {
            console.warn('RxForge SSE nicht verfügbar, nur Polling aktiv');
        }
    });
}

export function startRxForgeSync(callbacks) {
    stopRxForgeSync();
    if (!rxforgeHasToken()) return;

    function syncCycle() {
        if (rxforgeSyncRunning) return;
        rxforgeSyncRunning = true;
        if (callbacks.onActive) callbacks.onActive();

        rxforgePull()
            .then(function (hadChanges) {
                if (hadChanges && callbacks.onChange) callbacks.onChange();
                return rxforgePush();
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

    rxforgeStartSse(function () { syncCycle(); });
    syncCycle();
    rxforgeTimers.push(setInterval(syncCycle, 30000));
}

export function stopRxForgeSync() {
    rxforgeTimers.forEach(function (t) { clearInterval(t); });
    rxforgeTimers = [];
    rxforgeSyncRunning = false;
    if (rxforgeSseSource) { rxforgeSseSource.close(); rxforgeSseSource = null; }
}
