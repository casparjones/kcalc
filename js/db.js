// RxDB setup + persistence layer
'use strict';

import { createRxDatabase } from 'https://esm.sh/rxdb@15';
import { getRxStorageDexie } from 'https://esm.sh/rxdb@15/plugins/storage-dexie';

// ===== Storage Keys (legacy migration) =====
const STORAGE_KEY = 'diaethelfer_profiles';
const ACTIVE_KEY = 'diaethelfer_active';
const MIGRATED_KEY = 'diaethelfer_pouchdb_migrated';
const RXDB_MIGRATED_KEY = 'kcalc_rxdb_migrated';

// ===== Schemas =====
var profileSchema = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id:          { type: 'string', maxLength: 100 },
        name:        { type: 'string', maxLength: 100 },
        profileJson: { type: 'string' }
    },
    required: ['id', 'name', 'profileJson']
};

var entrySchema = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id:          { type: 'string', maxLength: 200 },
        profileName: { type: 'string', maxLength: 100 },
        date:        { type: 'string', maxLength: 10 },
        weight:      { type: 'number', minimum: 0 },
        entryId:     { type: 'number' }
    },
    required: ['id', 'profileName', 'date', 'weight']
};

var metaSchema = {
    version: 0,
    primaryKey: 'key',
    type: 'object',
    properties: {
        key:   { type: 'string', maxLength: 50 },
        value: { type: 'string' }
    },
    required: ['key', 'value']
};

// ===== Database instance =====
let _db = null;

export const dbReady = createRxDatabase({
    name: 'kcalc',
    storage: getRxStorageDexie()
}).then(function (db) {
    return db.addCollections({
        profiles: { schema: profileSchema },
        entries:  { schema: entrySchema },
        meta:     { schema: metaSchema }
    }).then(function () { _db = db; return db; });
});

export function getDb() { return _db; }

// Entfernt lokale Dokumente, die der Server als gelöscht meldet.
export function rxRemoveLocal(collection, ids) {
    return Promise.all(ids.map(function (localId) {
        return collection.findOne(localId).exec().then(function (d) { return d ? d.remove() : null; });
    }));
}

// ===== RxDB Helper Functions =====

export function migrateFromLocalStorage() {
    if (localStorage.getItem(MIGRATED_KEY)) return Promise.resolve(false);

    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { localStorage.setItem(MIGRATED_KEY, '1'); return Promise.resolve(false); }

    var allProfiles;
    try { allProfiles = JSON.parse(raw); } catch (e) { localStorage.setItem(MIGRATED_KEY, '1'); return Promise.resolve(false); }

    var names = Object.keys(allProfiles);
    if (names.length === 0) { localStorage.setItem(MIGRATED_KEY, '1'); return Promise.resolve(false); }

    var profileDocs = [], entryDocs = [];
    for (var i = 0; i < names.length; i++) {
        var name = names[i];
        var data = allProfiles[name];
        profileDocs.push({ id: name, name: name, profileJson: JSON.stringify(data.profile || {}) });

        var wh = data.weightHistory || [];
        for (var j = 0; j < wh.length; j++) {
            entryDocs.push({
                id: name + '_' + wh[j].date,
                profileName: name,
                date: wh[j].date,
                weight: wh[j].weight,
                entryId: wh[j].id || Date.now() + j
            });
        }
    }

    var active = localStorage.getItem(ACTIVE_KEY) || '';
    var promises = [];
    if (profileDocs.length > 0) promises.push(getDb().profiles.bulkUpsert(profileDocs));
    if (entryDocs.length > 0)   promises.push(getDb().entries.bulkUpsert(entryDocs));
    if (active)                  promises.push(getDb().meta.upsert({ key: 'active', value: active }));

    return Promise.all(promises).then(function () {
        localStorage.setItem(MIGRATED_KEY, '1');
        return true;
    }).catch(function () {
        localStorage.setItem(MIGRATED_KEY, '1');
        return true;
    });
}

export function migrateFromPouchDB() {
    if (localStorage.getItem(RXDB_MIGRATED_KEY)) return Promise.resolve(false);

    // Load PouchDB dynamically – only needed for this one-time migration
    var pouchReady = (typeof PouchDB !== 'undefined')
        ? Promise.resolve()
        : new Promise(function (resolve) {
            var s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/pouchdb@9.0.0/dist/pouchdb.min.js';
            s.onload = resolve;
            s.onerror = resolve;
            document.head.appendChild(s);
        });

    return pouchReady.then(function () {
    if (typeof PouchDB === 'undefined') {
        localStorage.setItem(RXDB_MIGRATED_KEY, '1');
        return false;
    }

    var oldDb = new PouchDB('kcalc');
    return oldDb.allDocs({ include_docs: true }).then(function (result) {
        var docs = result.rows.map(function (r) { return r.doc; });
        if (docs.length === 0) {
            localStorage.setItem(RXDB_MIGRATED_KEY, '1');
            return false;
        }

        var profileDocs = [], entryDocs = [], metaDocs = [];
        for (var i = 0; i < docs.length; i++) {
            var doc = docs[i];
            if (doc.type === 'profile') {
                profileDocs.push({ id: doc.name, name: doc.name, profileJson: JSON.stringify(doc.profile || {}) });
            } else if (doc.type === 'entry') {
                entryDocs.push({
                    id: doc.profileName + '_' + doc.date,
                    profileName: doc.profileName,
                    date: doc.date,
                    weight: doc.weight,
                    entryId: doc.entryId || Date.now()
                });
            } else if (doc.type === 'meta' && doc._id === 'meta_active') {
                metaDocs.push({ key: 'active', value: doc.value || '' });
            }
        }

        var promises = [];
        if (profileDocs.length > 0) promises.push(getDb().profiles.bulkUpsert(profileDocs));
        if (entryDocs.length > 0)   promises.push(getDb().entries.bulkUpsert(entryDocs));
        if (metaDocs.length > 0)    promises.push(getDb().meta.bulkUpsert(metaDocs));

        return Promise.all(promises).then(function () {
            localStorage.setItem(RXDB_MIGRATED_KEY, '1');
            return true;
        });
    }).catch(function () {
        localStorage.setItem(RXDB_MIGRATED_KEY, '1');
        return false;
    });
    }); // end pouchReady.then
}

export function loadAllProfilesFromDB() {
    return getDb().profiles.find().exec().then(function (profileDocs) {
        var profiles = {};
        var names = [];
        for (var i = 0; i < profileDocs.length; i++) {
            var doc = profileDocs[i].toJSON();
            var profile = {};
            try { profile = JSON.parse(doc.profileJson || '{}'); } catch (e) {}
            profiles[doc.name] = { profile: profile };
            names.push(doc.name);
        }
        return getDb().entries.find().exec().then(function (entryDocs) {
            for (var j = 0; j < entryDocs.length; j++) {
                var e = entryDocs[j].toJSON();
                if (profiles[e.profileName]) {
                    if (!profiles[e.profileName].weightHistory) profiles[e.profileName].weightHistory = [];
                    profiles[e.profileName].weightHistory.push({ date: e.date, weight: e.weight, id: e.entryId || Date.now() + j });
                }
            }
            for (var k = 0; k < names.length; k++) {
                var wh = profiles[names[k]].weightHistory || [];
                wh.sort(function (a, b) { return a.date.localeCompare(b.date); });
                profiles[names[k]].weightHistory = wh;
            }
            return profiles;
        });
    });
}

export function getActiveProfileFromDB() {
    return getDb().meta.findOne('active').exec().then(function (doc) {
        return doc ? doc.toJSON().value || '' : '';
    });
}

export function setActiveProfileInDB(name) {
    return getDb().meta.upsert({ key: 'active', value: name || '' });
}

export function saveProfileToDB(name, profileData) {
    return getDb().profiles.upsert({ id: name, name: name, profileJson: JSON.stringify(profileData) });
}

export function persistWeightHistoryToDB(profileName, weightHistory) {
    return getDb().entries.find({ selector: { profileName: profileName } }).exec()
        .then(function (existingDocs) {
            var existingByDate = {};
            var rxDocByDate = {};
            for (var i = 0; i < existingDocs.length; i++) {
                var e = existingDocs[i].toJSON();
                existingByDate[e.date] = e;
                rxDocByDate[e.date] = existingDocs[i];
            }

            var toUpsert = [];
            var currentDates = {};

            for (var j = 0; j < weightHistory.length; j++) {
                var entry = weightHistory[j];
                currentDates[entry.date] = true;
                var existing = existingByDate[entry.date];
                if (!existing || existing.weight !== entry.weight || existing.entryId !== entry.id) {
                    toUpsert.push({
                        id: profileName + '_' + entry.date,
                        profileName: profileName,
                        date: entry.date,
                        weight: entry.weight,
                        entryId: entry.id || Date.now()
                    });
                }
            }

            var ops = [];
            var existingDates = Object.keys(existingByDate);
            for (var k = 0; k < existingDates.length; k++) {
                if (!currentDates[existingDates[k]]) {
                    ops.push(rxDocByDate[existingDates[k]].remove());
                }
            }
            if (toUpsert.length > 0) ops.push(getDb().entries.bulkUpsert(toUpsert));
            if (ops.length > 0) return Promise.all(ops);
        });
}

export function deleteProfileFromDB(name) {
    return Promise.all([
        getDb().profiles.findOne(name).exec().then(function (doc) { return doc ? doc.remove() : null; }),
        getDb().entries.find({ selector: { profileName: name } }).exec().then(function (docs) {
            return Promise.all(docs.map(function (d) { return d.remove(); }));
        })
    ]);
}

// Shared helper to build an exportable data object from RxDB
export function buildExportData() {
    return Promise.all([
        getDb().profiles.find().exec(),
        getDb().entries.find().exec()
    ]).then(function (results) {
        var profileDocs = results[0].map(function (d) { return d.toJSON(); });
        var entryDocs   = results[1].map(function (d) { return d.toJSON(); });

        var profiles = {};
        for (var i = 0; i < profileDocs.length; i++) {
            var doc = profileDocs[i];
            var profile = {};
            try { profile = JSON.parse(doc.profileJson || '{}'); } catch (e) {}
            profiles[doc.name] = { profile: profile };
        }
        var entries = [];
        for (var j = 0; j < entryDocs.length; j++) {
            var e = entryDocs[j];
            entries.push({ profileName: e.profileName, date: e.date, weight: e.weight, entryId: e.entryId });
            if (profiles[e.profileName]) {
                if (!profiles[e.profileName].weightHistory) profiles[e.profileName].weightHistory = [];
                profiles[e.profileName].weightHistory.push({ date: e.date, weight: e.weight, id: e.entryId });
            }
        }
        return {
            version: 1,
            exportedAt: new Date().toISOString(),
            profiles: profiles,
            entries: entries
        };
    });
}
