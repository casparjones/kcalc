// Alpine.js App - Reactive state & UI logic
// Storage: PouchDB (IndexedDB) with localStorage migration
'use strict';

document.addEventListener('alpine:init', function () {

    Alpine.data('app', function () {
        var STORAGE_KEY = 'diaethelfer_profiles';
        var ACTIVE_KEY = 'diaethelfer_active';
        var MIGRATED_KEY = 'diaethelfer_pouchdb_migrated';
        var macroColors = { protein: '#e74c3c', carbs: '#f39c12', fat: '#3498db' };

        var db = new PouchDB('kcalc');
        var SYNC_KEY = 'kcalc_couchdb_url';
        var syncHandler = null;

        // ===== CouchDB Sync Functions =====
        function getSyncUrl() {
            return localStorage.getItem(SYNC_KEY) || '';
        }

        function setSyncUrl(url) {
            if (url) localStorage.setItem(SYNC_KEY, url);
            else localStorage.removeItem(SYNC_KEY);
        }

        function startSync(url, callbacks) {
            if (syncHandler) { syncHandler.cancel(); syncHandler = null; }
            if (!url) return null;
            var remoteDB = new PouchDB(url);
            var handler = db.sync(remoteDB, { live: true, retry: true });
            handler.on('change', function (info) { if (callbacks.onChange) callbacks.onChange(info); });
            handler.on('paused', function (err) { if (callbacks.onPaused) callbacks.onPaused(err); });
            handler.on('active', function () { if (callbacks.onActive) callbacks.onActive(); });
            handler.on('denied', function (err) { if (callbacks.onError) callbacks.onError(err); });
            handler.on('error', function (err) { if (callbacks.onError) callbacks.onError(err); });
            handler.on('complete', function (info) { if (callbacks.onComplete) callbacks.onComplete(info); });
            syncHandler = handler;
            return handler;
        }

        function stopSync() {
            if (syncHandler) { syncHandler.cancel(); syncHandler = null; }
        }

        // ===== PouchDB Helper Functions =====
        function dbGet(id) {
            return db.get(id).catch(function () { return null; });
        }

        function dbPut(doc) {
            return db.get(doc._id).then(function (existing) {
                doc._rev = existing._rev;
                return db.put(doc);
            }).catch(function () {
                return db.put(doc);
            });
        }

        function dbRemove(id) {
            return db.get(id).then(function (doc) {
                return db.remove(doc);
            }).catch(function () { /* not found */ });
        }

        function dbRange(startkey, endkey) {
            return db.allDocs({ include_docs: true, startkey: startkey, endkey: endkey }).then(function (result) {
                return result.rows.map(function (row) { return row.doc; });
            });
        }

        function migrateFromLocalStorage() {
            if (localStorage.getItem(MIGRATED_KEY)) return Promise.resolve(false);

            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) { localStorage.setItem(MIGRATED_KEY, '1'); return Promise.resolve(false); }

            var allProfiles;
            try { allProfiles = JSON.parse(raw); } catch (e) { localStorage.setItem(MIGRATED_KEY, '1'); return Promise.resolve(false); }

            var names = Object.keys(allProfiles);
            if (names.length === 0) { localStorage.setItem(MIGRATED_KEY, '1'); return Promise.resolve(false); }

            var docs = [];
            for (var i = 0; i < names.length; i++) {
                var name = names[i];
                var data = allProfiles[name];
                docs.push({ _id: 'profile_' + name, type: 'profile', name: name, profile: data.profile || {} });

                var wh = data.weightHistory || [];
                for (var j = 0; j < wh.length; j++) {
                    docs.push({
                        _id: 'entry_' + name + '_' + wh[j].date,
                        type: 'entry',
                        profileName: name,
                        date: wh[j].date,
                        weight: wh[j].weight,
                        entryId: wh[j].id || Date.now() + j
                    });
                }
            }

            var active = localStorage.getItem(ACTIVE_KEY) || '';
            if (active) docs.push({ _id: 'meta_active', type: 'meta', value: active });

            return db.bulkDocs(docs).then(function () {
                localStorage.setItem(MIGRATED_KEY, '1');
                return true;
            }).catch(function (err) {
                // If some docs already exist (409), mark as migrated anyway
                localStorage.setItem(MIGRATED_KEY, '1');
                return true;
            });
        }

        function loadAllProfilesFromDB() {
            return dbRange('profile_', 'profile_\uffff').then(function (profileDocs) {
                var profiles = {};
                var names = [];
                for (var i = 0; i < profileDocs.length; i++) {
                    var doc = profileDocs[i];
                    profiles[doc.name] = { profile: doc.profile || {} };
                    names.push(doc.name);
                }
                // Load weight entries for all profiles
                return dbRange('entry_', 'entry_\uffff').then(function (entryDocs) {
                    for (var j = 0; j < entryDocs.length; j++) {
                        var e = entryDocs[j];
                        if (profiles[e.profileName]) {
                            if (!profiles[e.profileName].weightHistory) profiles[e.profileName].weightHistory = [];
                            profiles[e.profileName].weightHistory.push({ date: e.date, weight: e.weight, id: e.entryId || Date.now() + j });
                        }
                    }
                    // Sort weight histories
                    for (var k = 0; k < names.length; k++) {
                        var wh = profiles[names[k]].weightHistory || [];
                        wh.sort(function (a, b) { return a.date.localeCompare(b.date); });
                        profiles[names[k]].weightHistory = wh;
                    }
                    return profiles;
                });
            });
        }

        function getActiveProfileFromDB() {
            return dbGet('meta_active').then(function (doc) {
                return doc ? doc.value || '' : '';
            });
        }

        function setActiveProfileInDB(name) {
            return dbPut({ _id: 'meta_active', type: 'meta', value: name });
        }

        function saveProfileToDB(name, profileData) {
            return dbPut({ _id: 'profile_' + name, type: 'profile', name: name, profile: profileData });
        }

        function persistWeightHistoryToDB(profileName, weightHistory) {
            var prefix = 'entry_' + profileName + '_';
            return dbRange(prefix, prefix + '\uffff').then(function (existingDocs) {
                var existingByDate = {};
                for (var i = 0; i < existingDocs.length; i++) {
                    existingByDate[existingDocs[i].date] = existingDocs[i];
                }

                var ops = [];
                var currentDates = {};

                for (var j = 0; j < weightHistory.length; j++) {
                    var entry = weightHistory[j];
                    currentDates[entry.date] = true;
                    var docId = 'entry_' + profileName + '_' + entry.date;

                    if (existingByDate[entry.date]) {
                        var ex = existingByDate[entry.date];
                        if (ex.weight !== entry.weight || ex.entryId !== entry.id) {
                            ex.weight = entry.weight;
                            ex.entryId = entry.id;
                            ops.push(ex);
                        }
                    } else {
                        ops.push({
                            _id: docId, type: 'entry', profileName: profileName,
                            date: entry.date, weight: entry.weight, entryId: entry.id
                        });
                    }
                }

                // Delete removed entries
                var existingKeys = Object.keys(existingByDate);
                for (var k = 0; k < existingKeys.length; k++) {
                    if (!currentDates[existingKeys[k]]) {
                        var toDelete = existingByDate[existingKeys[k]];
                        toDelete._deleted = true;
                        ops.push(toDelete);
                    }
                }

                if (ops.length > 0) return db.bulkDocs(ops);
            });
        }

        function deleteProfileFromDB(name) {
            var prefix = 'entry_' + name + '_';
            return Promise.all([
                dbRemove('profile_' + name),
                dbRange(prefix, prefix + '\uffff').then(function (docs) {
                    var toDelete = docs.map(function (d) { return { _id: d._id, _rev: d._rev, _deleted: true }; });
                    if (toDelete.length > 0) return db.bulkDocs(toDelete);
                })
            ]);
        }

        return {
            // ===== State =====
            view: 'form',  // 'form' or 'saved'
            form: { name: '', gewicht: '', groesse: '', alter: '', geschlecht: 'm', formel: 'harris', anpassung: 'n' },
            palRows: [{ tat: '0.95', zeit: '8:00', faktor: '0.95', sum: '0.00', readonly: true }],
            grundumsatz: 0,
            summe24: '0.00',
            palValue: '0.00',
            leistungsumsatz: 0,
            gesamtumsatz: 0,

            profiles: {},
            activeProfile: '',
            isTemporary: false,
            tempData: null,

            tempo: 1000,
            activeGoal: 'maintain',
            macroProfile: 'balanced',

            weightHistory: [],
            editingId: null,
            newDate: '',
            newWeight: '',

            dropdownOpen: false,
            burgerOpen: false,
            shareOverlay: false,
            shareUrl: '',

            // ===== Sync State =====
            settingsOpen: false,
            syncUrl: '',
            syncStatus: 'disconnected', // 'disconnected', 'active', 'paused', 'error'
            syncError: '',

            // ===== Google Drive Sync State =====
            isChrome: /Chrome/.test(navigator.userAgent) && !/Edg/.test(navigator.userAgent),
            gdriveToken: localStorage.getItem('kcalc_gdrive_token') || '',
            gdriveTokenExpires: parseInt(localStorage.getItem('kcalc_gdrive_token_expires') || '0', 10),
            gdriveTokenClient: null,
            gdriveSyncing: false,
            gdriveLastSync: localStorage.getItem('kcalc_gdrive_last_sync') || '',

            // ===== Lifecycle =====
            init: function () {
                var self = this;
                this.newDate = this.todayStr();

                // Migrate localStorage data, then load from PouchDB
                migrateFromLocalStorage().then(function () {
                    return Promise.all([loadAllProfilesFromDB(), getActiveProfileFromDB()]);
                }).then(function (results) {
                    self.profiles = results[0];
                    self.activeProfile = results[1];

                    var shared = self.loadShareUrl();
                    if (shared && (shared.weightHistory.length > 0 || shared.profile)) {
                        self.handleSharedData(shared);
                    } else if (self.activeProfile && self.profiles[self.activeProfile]) {
                        self.activateProfile(self.activeProfile);
                    } else {
                        var names = Object.keys(self.profiles);
                        if (names.length > 0) self.activateProfile(names[0]);
                        else self.view = 'form';
                    }
                }).catch(function (err) {
                    console.error('PouchDB init error:', err);
                    self.view = 'form';
                });

                // Start CouchDB sync if URL is configured
                this.syncUrl = getSyncUrl();
                if (this.syncUrl) this.startCouchSync();

                // Google Drive: auto-load on startup if token is present
                if (this.gdriveToken && this.isChrome) {
                    this.gdriveSyncDown();
                }

                // Resize chart
                var timer;
                window.addEventListener('resize', function () {
                    clearTimeout(timer);
                    timer = setTimeout(function () { self.drawChart(); }, 200);
                });

                // Footer fade
                setTimeout(function () {
                    var f = document.querySelector('.site-footer');
                    if (f) f.classList.add('visible');
                }, 400);
            },

            // ===== Calculations (reactive via x-effect) =====
            recalculate: function () {
                var w = parseFloat(this.form.gewicht) || 0;
                var h = parseFloat(this.form.groesse) || 0;
                var a = parseInt(this.form.alter) || 0;
                this.grundumsatz = Calc.grundumsatz(w, h, a, this.form.geschlecht, this.form.formel, this.form.anpassung);
                this.recalcPal();
            },

            recalcPal: function () {
                var tag = 0, pal24 = 0;
                for (var i = 0; i < this.palRows.length; i++) {
                    var row = this.palRows[i];
                    var tatVal = parseFloat(row.tat);
                    if (tatVal > 0) {
                        row.faktor = tatVal.toFixed(2);
                        row.readonly = true;
                    } else {
                        row.readonly = false;
                        var f = parseFloat(row.faktor);
                        if (isNaN(f) || f < 1.2) row.faktor = '1.20';
                        else if (f > 3.0) row.faktor = '3.00';
                        else row.faktor = f.toFixed(2);
                    }
                    var h = Calc.parseZeit(row.zeit);
                    tag += h;
                    if (tag > 24) { h -= (tag - 24); if (h < 0) h = 0; tag = 24; }
                    row.zeit = Calc.formatZeit(h);
                    var fk = parseFloat(row.faktor) || 0;
                    row.sum = (h * fk).toFixed(2);
                    pal24 += h * fk;
                }
                if (tag < 24) {
                    this.addPalRow(24 - tag);
                    return;
                }
                this.summe24 = pal24.toFixed(2);
                this.palValue = (pal24 / 24).toFixed(2);
                var gu = this.grundumsatz;
                var pal = parseFloat(this.palValue);
                if (gu > 0 && !isNaN(pal)) {
                    this.gesamtumsatz = Math.round(gu * pal);
                    this.leistungsumsatz = this.gesamtumsatz - gu;
                } else {
                    this.gesamtumsatz = 0;
                    this.leistungsumsatz = 0;
                }
            },

            addPalRow: function (stunden) {
                this.palRows.push({ tat: '1.45', zeit: Calc.formatZeit(stunden || 0), faktor: '1.45', sum: '0.00', readonly: true });
                this.$nextTick(function () { this.recalcPal(); }.bind(this));
            },

            removePalRow: function (idx) {
                if (this.palRows.length > 1) {
                    this.palRows.splice(idx, 1);
                    this.recalcPal();
                }
            },

            // ===== BMI =====
            get bmi() {
                return Calc.bmi(parseFloat(this.form.gewicht), parseFloat(this.form.groesse));
            },
            get bmiInfo() { return Calc.bmiInfo(this.bmi); },

            // ===== Diet Goals =====
            get loseCalories() { return this.gesamtumsatz - this.tempo; },
            get maintainCalories() { return this.gesamtumsatz; },
            get gainCalories() { return this.gesamtumsatz + this.tempo; },
            get targetCalories() {
                if (this.activeGoal === 'lose') return this.loseCalories;
                if (this.activeGoal === 'gain') return this.gainCalories;
                return this.maintainCalories;
            },
            get kgPerWeek() { return (this.tempo * 7 / 7700).toFixed(1).replace('.', ','); },
            get kgPerMonth() { return (this.tempo * 30 / 7700).toFixed(1).replace('.', ','); },

            // ===== Macros =====
            get macros() { return Calc.macros(this.targetCalories, this.macroProfile); },

            drawMacroPie: function () {
                this.$nextTick(function () {
                    WeightChart.drawMacroPie('macroChart', this.macros, macroColors);
                }.bind(this));
            },

            // ===== Weight History =====
            get sortedWeightDesc() {
                return this.weightHistory.slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
            },
            get startWeight() {
                var sorted = this.weightHistory.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
                return sorted.length > 0 ? sorted[0].weight : 0;
            },

            weightDiff: function (entry) {
                var diff = entry.weight - this.startWeight;
                return (diff >= 0 ? '+' : '') + diff.toFixed(1);
            },
            weightDiffClass: function (entry) {
                var diff = entry.weight - this.startWeight;
                return diff < 0 ? 'diff-negative' : diff > 0 ? 'diff-positive' : 'diff-neutral';
            },
            isStartEntry: function (entry) {
                var sorted = this.weightHistory.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
                return sorted.length > 0 && sorted[0].id === entry.id;
            },

            get canAddWeight() { return parseFloat(this.newWeight) > 0; },

            addWeightEntry: function () {
                if (!this.newDate) { this.toast('Bitte Datum eingeben', 'warn'); return; }
                if (!this.canAddWeight) { this.toast('Bitte gültiges Gewicht eingeben', 'warn'); return; }
                var self = this;
                var existing = this.weightHistory.find(function (e) { return e.date === self.newDate; });
                if (existing) {
                    var parts = existing.date.split('-');
                    this.confirmToast(parts[2] + '.' + parts[1] + '.' + parts[0] + ': ' + existing.weight.toFixed(1) + ' kg überschreiben mit ' + parseFloat(this.newWeight).toFixed(1) + ' kg?', function () {
                        existing.weight = parseFloat(self.newWeight);
                        self.toast('Gewicht aktualisiert', 'info');
                        self.newWeight = '';
                        self.newDate = self.todayStr();
                        self.persistWeightHistory();
                        self.drawChart();
                    });
                    return;
                }
                this.weightHistory.push({ date: this.newDate, weight: parseFloat(this.newWeight), id: Date.now() });
                this.toast('Gewicht hinzugefügt', 'success');
                this.newWeight = '';
                this.newDate = this.todayStr();
                this.persistWeightHistory();
                this.drawChart();
            },

            startEdit: function (id) { this.editingId = id; },
            cancelEdit: function () { this.editingId = null; },

            saveEdit: function (entry) {
                this.editingId = null;
                this.weightHistory.sort(function (a, b) { return a.date.localeCompare(b.date); });
                this.persistWeightHistory();
                this.drawChart();
                this.toast('Aktualisiert', 'success');
            },

            deleteEntry: function (entry) {
                var self = this;
                var parts = entry.date.split('-');
                var msg = parts[2] + '.' + parts[1] + '.' + parts[0] + ' (' + entry.weight.toFixed(1) + ' kg) löschen?';
                this.confirmToast(msg, function () {
                    self.weightHistory = self.weightHistory.filter(function (e) { return e.id !== entry.id; });
                    self.editingId = null;
                    self.persistWeightHistory();
                    self.drawChart();
                    self.toast('Gelöscht', 'error');
                });
            },

            persistWeightHistory: function () {
                if (this.isTemporary) return;
                if (this.profiles[this.activeProfile]) {
                    this.profiles[this.activeProfile].weightHistory = this.weightHistory;
                }
                persistWeightHistoryToDB(this.activeProfile, this.weightHistory).catch(function (err) {
                    console.error('Error persisting weight history:', err);
                });
            },

            drawChart: function () {
                this.$nextTick(function () { WeightChart.draw('weightChart', this.weightHistory); }.bind(this));
            },

            // ===== Profile Storage =====
            loadProfiles: function () {
                // No-op: profiles are loaded async from PouchDB in init()
            },

            loadAllProfiles: function () {
                // Returns deep copy of in-memory profiles (already loaded from PouchDB)
                return JSON.parse(JSON.stringify(this.profiles));
            },

            saveAllProfiles: function (p) {
                this.profiles = p;
                var names = Object.keys(p);
                var promises = names.map(function (name) {
                    var data = p[name];
                    return saveProfileToDB(name, data.profile || {}).then(function () {
                        if (data.weightHistory) {
                            return persistWeightHistoryToDB(name, data.weightHistory);
                        }
                    });
                });
                Promise.all(promises).catch(function (err) {
                    console.error('Error saving profiles:', err);
                });
                return true;
            },

            get profileNames() { return Object.keys(this.profiles); },
            get hasProfiles() { return this.profileNames.length > 0 || this.isTemporary; },

            activateProfile: function (name) {
                this.isTemporary = false;
                this.activeProfile = name;
                setActiveProfileInDB(name);
                var pd = this.profiles[name];
                if (!pd) return;
                if (pd.profile) {
                    this.form.name = name;
                    this.form.gewicht = pd.profile.gewicht || '';
                    this.form.groesse = pd.profile.groesse || '';
                    this.form.alter = pd.profile.alter || '';
                    this.form.geschlecht = pd.profile.geschlecht || 'm';
                    this.form.formel = pd.profile.formel || 'harris';
                    this.form.anpassung = pd.profile.anpassung || 'n';
                    this.form.savedAt = pd.profile.savedAt || '';
                }
                this.weightHistory = pd.weightHistory || [];
                this.recalculate();
                this.view = 'saved';
                this.dropdownOpen = false;
                var self = this;
                this.$nextTick(function () { self.drawChart(); self.drawMacroPie(); });
            },

            saveProfile: function () {
                var name = this.form.name.trim();
                if (!name) { this.toast('Bitte einen Namen eingeben', 'warn'); return; }
                var all = this.loadAllProfiles();
                var prev = all[name] || {};
                var profileData = {
                    gewicht: this.form.gewicht, groesse: this.form.groesse, alter: this.form.alter,
                    geschlecht: this.form.geschlecht, formel: this.form.formel, anpassung: this.form.anpassung,
                    grundumsatz: String(this.grundumsatz), pal: this.palValue,
                    leistungsumsatz: String(this.leistungsumsatz), gesamtumsatz: String(this.gesamtumsatz),
                    savedAt: new Date().toISOString()
                };
                var wh = prev.weightHistory || this.weightHistory || [];
                if (wh.length === 0 && this.form.gewicht) {
                    wh.push({ date: this.todayStr(), weight: parseFloat(this.form.gewicht), id: Date.now() });
                }
                all[name] = { profile: profileData, weightHistory: wh };
                if (this.saveAllProfiles(all)) {
                    this.isTemporary = false;
                    this.tempData = null;
                    this.activeProfile = name;
                    this.weightHistory = wh;
                    this.form.savedAt = profileData.savedAt;
                    setActiveProfileInDB(name);
                    this.toast('"' + name + '" gespeichert', 'success');
                    this.view = 'saved';
                    var self = this;
                    this.$nextTick(function () { self.drawChart(); self.drawMacroPie(); });
                }
            },

            resave: function () {
                var name = this.activeProfile;
                if (!name) return;
                var all = this.loadAllProfiles();
                var prev = all[name] || {};
                prev.weightHistory = this.weightHistory;
                all[name] = prev;
                this.saveAllProfiles(all);
                this.toast('"' + name + '" gespeichert', 'success');
            },

            editProfile: function () {
                this.view = 'form';
            },

            newProfile: function () {
                this.dropdownOpen = false;
                this.form = { name: '', gewicht: '', groesse: '', alter: '', geschlecht: 'm', formel: 'harris', anpassung: 'n' };
                this.palRows = [{ tat: '0.95', zeit: '8:00', faktor: '0.95', sum: '0.00', readonly: true }];
                this.grundumsatz = 0; this.gesamtumsatz = 0; this.leistungsumsatz = 0;
                this.weightHistory = [];
                this.view = 'form';
            },

            deleteProfile: function () {
                var self = this;
                var name = this.activeProfile;
                if (!name) return;
                this.dropdownOpen = false;
                this.confirmToast('Profil "' + name + '" wirklich löschen?', function () {
                    deleteProfileFromDB(name).then(function () {
                        delete self.profiles[name];
                        self.toast('"' + name + '" gelöscht', 'error');
                        var remaining = Object.keys(self.profiles);
                        if (remaining.length > 0) { self.activateProfile(remaining[0]); }
                        else {
                            self.activeProfile = '';
                            setActiveProfileInDB('');
                            self.weightHistory = [];
                            self.view = 'form';
                        }
                    }).catch(function (err) {
                        console.error('Error deleting profile:', err);
                        self.toast('Fehler beim Löschen', 'error');
                    });
                });
            },

            // ===== Sharing =====
            shareLimit: 30,

            get shareLimitExceeded() {
                var data = this.profiles[this.activeProfile];
                if (!data) return false;
                return (data.weightHistory || []).length > this.shareLimit;
            },

            generateShareUrl: function () {
                var data = this.profiles[this.activeProfile];
                if (!data) { this.toast('Keine Daten', 'warn'); return ''; }
                var p = data.profile || {};
                var wh = (data.weightHistory || []).slice().sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, this.shareLimit);
                var payload = {
                    n: this.activeProfile,
                    p: { g: p.gewicht, gr: p.groesse, a: p.alter, s: p.geschlecht, f: p.formel, an: p.anpassung, gu: p.grundumsatz, pl: p.pal, lu: p.leistungsumsatz, ge: p.gesamtumsatz, sa: p.savedAt },
                    w: wh.map(function (e) { return { d: e.date, w: e.weight }; })
                };
                return window.location.origin + window.location.pathname + '?d=' + btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
            },

            openShare: function () {
                this.dropdownOpen = false;
                this.shareUrl = this.generateShareUrl();
                if (this.shareUrl) this.shareOverlay = true;
            },

            copyShareUrl: function () {
                var url = this.shareUrl;
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(url).then(function () { this.toast('Link kopiert!', 'success'); }.bind(this));
                } else {
                    var el = document.getElementById('shareUrl');
                    if (el) { el.select(); document.execCommand('copy'); }
                    this.toast('Link kopiert!', 'success');
                }
            },

            loadShareUrl: function () {
                var enc = new URLSearchParams(window.location.search).get('d');
                if (!enc) return null;
                try {
                    var raw = JSON.parse(decodeURIComponent(escape(atob(enc))));
                    var r = { name: raw.n || '', weightHistory: [] };
                    if (raw.p) r.profile = { gewicht: raw.p.g, groesse: raw.p.gr, alter: raw.p.a, geschlecht: raw.p.s, formel: raw.p.f, anpassung: raw.p.an, grundumsatz: raw.p.gu, pal: raw.p.pl, leistungsumsatz: raw.p.lu, gesamtumsatz: raw.p.ge, savedAt: raw.p.sa };
                    if (raw.w) r.weightHistory = raw.w.map(function (e, i) { return { date: e.d, weight: e.w, id: i + 1 }; });
                    return r;
                } catch (e) { return null; }
            },

            handleSharedData: function (shared) {
                var local = this.profiles[shared.name];
                var self = this;

                if (local) {
                    var localWh = local.weightHistory || [];
                    var sharedWh = shared.weightHistory || [];
                    var localDate = local.profile && local.profile.savedAt ? new Date(local.profile.savedAt) : new Date(0);
                    var sharedDate = shared.profile && shared.profile.savedAt ? new Date(shared.profile.savedAt) : new Date(0);

                    // Merge: lokale Eintraege behalten, neue aus Share hinzufuegen
                    var localDates = {};
                    for (var i = 0; i < localWh.length; i++) {
                        localDates[localWh[i].date] = true;
                    }
                    var merged = localWh.slice();
                    var added = 0;
                    for (var j = 0; j < sharedWh.length; j++) {
                        if (!localDates[sharedWh[j].date]) {
                            merged.push({ date: sharedWh[j].date, weight: sharedWh[j].weight, id: Date.now() + j });
                            added++;
                        }
                    }
                    merged.sort(function (a, b) { return a.date.localeCompare(b.date); });
                    var all = this.loadAllProfiles();
                    all[shared.name] = { profile: sharedDate > localDate ? shared.profile : local.profile, weightHistory: merged };
                    this.saveAllProfiles(all);
                    if (added > 0) {
                        this.toast(added + ' neue Einträge zu "' + shared.name + '" hinzugefügt', 'success');
                    } else {
                        this.toast('Lokale Daten von "' + shared.name + '" sind aktuell', 'info');
                    }
                    this.activateProfile(shared.name);
                } else {
                    this.isTemporary = true;
                    this.tempData = shared;
                    this.activeProfile = shared.name || 'Geteilt';
                    this.weightHistory = shared.weightHistory || [];
                    if (shared.profile) {
                        this.form.name = shared.name;
                        this.form.gewicht = shared.profile.gewicht || '';
                        this.form.groesse = shared.profile.groesse || '';
                        this.form.alter = shared.profile.alter || '';
                        this.form.geschlecht = shared.profile.geschlecht || 'm';
                        this.form.formel = shared.profile.formel || 'harris';
                        this.form.anpassung = shared.profile.anpassung || 'n';
                        this.form.savedAt = shared.profile.savedAt || '';
                        this.grundumsatz = parseInt(shared.profile.grundumsatz) || 0;
                        this.gesamtumsatz = parseInt(shared.profile.gesamtumsatz) || 0;
                        this.leistungsumsatz = parseInt(shared.profile.leistungsumsatz) || 0;
                        this.palValue = shared.profile.pal || '0';
                    }
                    this.toast('Geteilter Verlauf von "' + (shared.name || 'Unbekannt') + '"', 'info');
                    this.view = 'saved';
                    this.$nextTick(function () { self.drawChart(); self.drawMacroPie(); });
                }
            },

            saveTemporary: function () {
                if (!this.tempData) return;
                var name = this.tempData.name || 'Geteilt';
                var wh = (this.tempData.weightHistory || []).map(function (e, i) { return { date: e.date, weight: e.weight, id: Date.now() + i }; });
                wh.sort(function (a, b) { return a.date.localeCompare(b.date); });
                var all = this.loadAllProfiles();
                all[name] = { profile: this.tempData.profile || {}, weightHistory: wh };
                this.saveAllProfiles(all);
                this.activeProfile = name;
                setActiveProfileInDB(name);
                this.isTemporary = false;
                this.tempData = null;
                this.weightHistory = wh;
                this.toast('"' + name + '" lokal gespeichert', 'success');
            },

            // ===== Backup Export / Import =====
            exportData: function () {
                this.dropdownOpen = false;
                var self = this;
                Promise.all([
                    dbRange('profile_', 'profile_\uffff'),
                    dbRange('entry_', 'entry_\uffff')
                ]).then(function (results) {
                    var profileDocs = results[0];
                    var entryDocs = results[1];
                    var profiles = {};
                    for (var i = 0; i < profileDocs.length; i++) {
                        var doc = profileDocs[i];
                        profiles[doc.name] = { profile: doc.profile || {} };
                    }
                    var entries = [];
                    for (var j = 0; j < entryDocs.length; j++) {
                        var e = entryDocs[j];
                        entries.push({
                            profileName: e.profileName,
                            date: e.date,
                            weight: e.weight,
                            entryId: e.entryId
                        });
                        if (profiles[e.profileName]) {
                            if (!profiles[e.profileName].weightHistory) profiles[e.profileName].weightHistory = [];
                            profiles[e.profileName].weightHistory.push({ date: e.date, weight: e.weight, id: e.entryId });
                        }
                    }
                    var backup = {
                        version: 1,
                        exportedAt: new Date().toISOString(),
                        profiles: profiles,
                        entries: entries
                    };
                    var blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
                    var url = URL.createObjectURL(blob);
                    var a = document.createElement('a');
                    a.href = url;
                    a.download = 'kcalc-backup-' + new Date().toISOString().split('T')[0] + '.json';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    self.toast('Backup exportiert', 'success');
                }).catch(function (err) {
                    console.error('Export error:', err);
                    self.toast('Fehler beim Export', 'error');
                });
            },

            triggerImport: function () {
                this.dropdownOpen = false;
                var input = document.getElementById('backupFileInput');
                if (input) input.click();
            },

            handleImportFile: function (event) {
                var self = this;
                var file = event.target.files && event.target.files[0];
                if (!file) return;
                var reader = new FileReader();
                reader.onload = function (e) {
                    try {
                        var data = JSON.parse(e.target.result);
                        // Validate structure
                        if (!data || typeof data.version !== 'number' || !data.profiles || typeof data.profiles !== 'object') {
                            self.toast('Ungueltige Backup-Datei: kein gueltiges kcalc-Format', 'error');
                            event.target.value = '';
                            return;
                        }
                        var profileNames = Object.keys(data.profiles);
                        var entryCount = (data.entries && data.entries.length) || 0;
                        var msg = profileNames.length + ' Profil(e) und ' + entryCount + ' Gewichtseintraege importieren? Bestehende Daten werden ueberschrieben.';
                        self.confirmImport(msg, function () {
                            self.executeImport(data);
                        });
                    } catch (err) {
                        self.toast('Datei konnte nicht gelesen werden: ungueltiges JSON', 'error');
                    }
                    event.target.value = '';
                };
                reader.readAsText(file);
            },

            confirmImport: function (msg, onConfirm) {
                if (typeof Toastify === 'undefined') { if (confirm(msg)) onConfirm(); return; }
                var t = Toastify({ text: ' ', duration: -1, gravity: 'top', position: 'center', className: 'confirm-toast', style: { background: 'linear-gradient(to right, #2c3e50, #34495e)', maxWidth: '440px', padding: '0', borderRadius: '10px', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }, stopOnFocus: true, close: false });
                t.showToast();
                var el = t.toastElement; if (!el) return;
                el.innerHTML = '<div style="padding:16px 20px;text-align:center;"><p style="margin:0 0 14px;font-size:14px;line-height:1.4;color:#fff;">' + msg + '</p><div style="display:flex;gap:10px;justify-content:center;"><button class="cy" style="padding:8px 24px;background:#e74c3c;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">Ja, importieren</button><button class="cn" style="padding:8px 24px;background:#95a5a6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">Abbrechen</button></div></div>';
                el.querySelector('.cy').addEventListener('click', function () { t.hideToast(); onConfirm(); });
                el.querySelector('.cn').addEventListener('click', function () { t.hideToast(); });
            },

            executeImport: function (data) {
                var self = this;
                var profileNames = Object.keys(data.profiles);
                var docs = [];

                // Build profile documents
                for (var i = 0; i < profileNames.length; i++) {
                    var name = profileNames[i];
                    var pData = data.profiles[name];
                    docs.push({
                        _id: 'profile_' + name,
                        type: 'profile',
                        name: name,
                        profile: pData.profile || {}
                    });
                }

                // Build entry documents from the entries array (preferred) or from profiles' weightHistory
                if (data.entries && data.entries.length > 0) {
                    for (var j = 0; j < data.entries.length; j++) {
                        var entry = data.entries[j];
                        docs.push({
                            _id: 'entry_' + entry.profileName + '_' + entry.date,
                            type: 'entry',
                            profileName: entry.profileName,
                            date: entry.date,
                            weight: entry.weight,
                            entryId: entry.entryId || Date.now() + j
                        });
                    }
                } else {
                    // Fallback: build entries from profiles' weightHistory
                    for (var k = 0; k < profileNames.length; k++) {
                        var pName = profileNames[k];
                        var wh = data.profiles[pName].weightHistory || [];
                        for (var l = 0; l < wh.length; l++) {
                            docs.push({
                                _id: 'entry_' + pName + '_' + wh[l].date,
                                type: 'entry',
                                profileName: pName,
                                date: wh[l].date,
                                weight: wh[l].weight,
                                entryId: wh[l].id || Date.now() + l
                            });
                        }
                    }
                }

                // Use dbPut for each doc so _rev conflicts are handled
                var putPromises = docs.map(function (doc) { return dbPut(doc); });
                Promise.all(putPromises).then(function () {
                    // Reload all data from PouchDB
                    return Promise.all([loadAllProfilesFromDB(), getActiveProfileFromDB()]);
                }).then(function (results) {
                    self.profiles = results[0];
                    var active = results[1];
                    var names = Object.keys(self.profiles);
                    if (active && self.profiles[active]) {
                        self.activateProfile(active);
                    } else if (names.length > 0) {
                        self.activateProfile(names[0]);
                    } else {
                        self.view = 'form';
                    }
                    self.toast('Backup erfolgreich importiert', 'success');
                }).catch(function (err) {
                    console.error('Import error:', err);
                    self.toast('Fehler beim Import', 'error');
                });
            },

            // ===== CouchDB Sync =====
            openSettings: function () {
                this.dropdownOpen = false;
                this.settingsOpen = true;
            },

            startCouchSync: function () {
                var self = this;
                var url = this.syncUrl.trim();
                if (!url) return;
                setSyncUrl(url);
                this.syncStatus = 'active';
                this.syncError = '';
                startSync(url, {
                    onChange: function (info) {
                        self.syncStatus = 'active';
                        // Reload data from PouchDB after remote changes
                        if (info.direction === 'pull' && info.change && info.change.docs && info.change.docs.length > 0) {
                            self.reloadFromDB();
                        }
                    },
                    onPaused: function (err) {
                        self.syncStatus = err ? 'error' : 'paused';
                        if (err) self.syncError = err.message || 'Verbindungsproblem';
                    },
                    onActive: function () {
                        self.syncStatus = 'active';
                        self.syncError = '';
                    },
                    onError: function (err) {
                        self.syncStatus = 'error';
                        self.syncError = (err && err.message) || 'Sync-Fehler';
                        console.error('CouchDB sync error:', err);
                    },
                    onComplete: function () {
                        self.syncStatus = 'disconnected';
                    }
                });
                this.toast('Sync gestartet', 'success');
            },

            disconnectSync: function () {
                stopSync();
                setSyncUrl('');
                this.syncUrl = '';
                this.syncStatus = 'disconnected';
                this.syncError = '';
                this.toast('Sync getrennt', 'info');
            },

            reloadFromDB: function () {
                var self = this;
                loadAllProfilesFromDB().then(function (profiles) {
                    self.profiles = profiles;
                    if (self.activeProfile && profiles[self.activeProfile]) {
                        var pd = profiles[self.activeProfile];
                        self.weightHistory = pd.weightHistory || [];
                        if (pd.profile) {
                            self.form.gewicht = pd.profile.gewicht || self.form.gewicht;
                            self.form.groesse = pd.profile.groesse || self.form.groesse;
                            self.form.alter = pd.profile.alter || self.form.alter;
                            self.form.geschlecht = pd.profile.geschlecht || self.form.geschlecht;
                            self.form.formel = pd.profile.formel || self.form.formel;
                            self.form.anpassung = pd.profile.anpassung || self.form.anpassung;
                            self.form.savedAt = pd.profile.savedAt || self.form.savedAt;
                        }
                        self.recalculate();
                        self.drawChart();
                    }
                });
            },

            get syncStatusText() {
                var labels = { disconnected: 'Nicht verbunden', active: 'Synchronisiert...', paused: 'Verbunden', error: 'Fehler' };
                return labels[this.syncStatus] || 'Nicht verbunden';
            },

            get syncStatusColor() {
                var colors = { disconnected: 'gray', active: 'green', paused: 'green', error: 'red' };
                return colors[this.syncStatus] || 'gray';
            },

            // ===== Google Drive Sync =====
            gdriveInitTokenClient: function (callback) {
                var self = this;
                if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
                    return null;
                }
                return google.accounts.oauth2.initTokenClient({
                    client_id: '188307962475-cjrfkut3vsu067uc3n0pc5fpbjpi94cn.apps.googleusercontent.com',
                    scope: 'https://www.googleapis.com/auth/drive.appdata',
                    callback: function (response) {
                        if (response.error) {
                            if (callback) callback(response.error_description || response.error);
                            return;
                        }
                        self.gdriveToken = response.access_token;
                        var expiresAt = Date.now() + (response.expires_in || 3600) * 1000;
                        self.gdriveTokenExpires = expiresAt;
                        localStorage.setItem('kcalc_gdrive_token', response.access_token);
                        localStorage.setItem('kcalc_gdrive_token_expires', String(expiresAt));
                        if (callback) callback(null);
                    }
                });
            },

            gdriveConnect: function () {
                var self = this;
                if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
                    this.toast('Google Identity Services nicht geladen. Bitte Seite neu laden.', 'error');
                    return;
                }
                this.gdriveTokenClient = this.gdriveInitTokenClient(function (err) {
                    if (err) {
                        self.toast('Google-Anmeldung fehlgeschlagen: ' + err, 'error');
                    } else {
                        self.toast('Mit Google verbunden', 'success');
                    }
                });
                this.gdriveTokenClient.requestAccessToken();
            },

            gdriveDisconnect: function () {
                if (this.gdriveToken) {
                    google.accounts.oauth2.revoke(this.gdriveToken, function () {});
                }
                this.gdriveToken = '';
                this.gdriveTokenExpires = 0;
                this.gdriveTokenClient = null;
                this.gdriveLastSync = '';
                localStorage.removeItem('kcalc_gdrive_token');
                localStorage.removeItem('kcalc_gdrive_token_expires');
                localStorage.removeItem('kcalc_gdrive_last_sync');
                this.toast('Google getrennt', 'info');
            },

            gdriveFindFile: function (token) {
                return fetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name%3D%27kcalc-data.json%27&fields=files(id,name,modifiedTime)', {
                    headers: { Authorization: 'Bearer ' + token }
                }).then(function (res) {
                    if (res.status === 401) throw new Error('TOKEN_EXPIRED');
                    if (!res.ok) throw new Error('Drive API Fehler: ' + res.status);
                    return res.json();
                }).then(function (data) {
                    return (data.files && data.files.length > 0) ? data.files[0].id : null;
                });
            },

            gdriveUploadFile: function (token, fileId, content) {
                var metadata = { name: 'kcalc-data.json' };
                if (!fileId) metadata.parents = ['appDataFolder'];

                var boundary = '----kcalcboundary' + Date.now();
                var body = '--' + boundary + '\r\n' +
                    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
                    JSON.stringify(metadata) + '\r\n' +
                    '--' + boundary + '\r\n' +
                    'Content-Type: application/json\r\n\r\n' +
                    JSON.stringify(content) + '\r\n' +
                    '--' + boundary + '--';

                var url = fileId
                    ? 'https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=multipart'
                    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
                var method = fileId ? 'PATCH' : 'POST';

                return fetch(url, {
                    method: method,
                    headers: {
                        Authorization: 'Bearer ' + token,
                        'Content-Type': 'multipart/related; boundary=' + boundary
                    },
                    body: body
                }).then(function (res) {
                    if (res.status === 401) throw new Error('TOKEN_EXPIRED');
                    if (!res.ok) throw new Error('Upload Fehler: ' + res.status);
                    return res.json();
                });
            },

            gdriveDownloadFile: function (token, fileId) {
                return fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media', {
                    headers: { Authorization: 'Bearer ' + token }
                }).then(function (res) {
                    if (res.status === 401) throw new Error('TOKEN_EXPIRED');
                    if (!res.ok) throw new Error('Download Fehler: ' + res.status);
                    return res.json();
                });
            },

            gdriveRefreshToken: function () {
                var self = this;
                return new Promise(function (resolve, reject) {
                    if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
                        reject(new Error('REAUTH_REQUIRED'));
                        return;
                    }
                    if (!self.gdriveTokenClient) {
                        self.gdriveTokenClient = self.gdriveInitTokenClient(function (err) {
                            if (err) reject(new Error('REAUTH_REQUIRED'));
                            else resolve(self.gdriveToken);
                        });
                    } else {
                        // Update the callback for this refresh attempt
                        self.gdriveTokenClient = self.gdriveInitTokenClient(function (err) {
                            if (err) reject(new Error('REAUTH_REQUIRED'));
                            else resolve(self.gdriveToken);
                        });
                    }
                    self.gdriveTokenClient.requestAccessToken({ prompt: '' });
                });
            },

            gdriveEnsureToken: function () {
                var self = this;
                // Token still valid (with 60s buffer)
                if (this.gdriveToken && this.gdriveTokenExpires > Date.now() + 60000) {
                    return Promise.resolve(this.gdriveToken);
                }
                // Try silent refresh
                return this.gdriveRefreshToken().catch(function () {
                    self.gdriveToken = '';
                    self.gdriveTokenExpires = 0;
                    localStorage.removeItem('kcalc_gdrive_token');
                    localStorage.removeItem('kcalc_gdrive_token_expires');
                    self.toast('Google-Token abgelaufen. Bitte erneut verbinden.', 'warn');
                    return Promise.reject(new Error('TOKEN_EXPIRED'));
                });
            },

            gdriveExportData: function () {
                var self = this;
                return Promise.all([
                    dbRange('profile_', 'profile_\uffff'),
                    dbRange('entry_', 'entry_\uffff')
                ]).then(function (results) {
                    var profileDocs = results[0];
                    var entryDocs = results[1];
                    var profiles = {};
                    for (var i = 0; i < profileDocs.length; i++) {
                        var doc = profileDocs[i];
                        profiles[doc.name] = { profile: doc.profile || {} };
                    }
                    var entries = [];
                    for (var j = 0; j < entryDocs.length; j++) {
                        var e = entryDocs[j];
                        entries.push({
                            profileName: e.profileName,
                            date: e.date,
                            weight: e.weight,
                            entryId: e.entryId
                        });
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
            },

            gdriveSyncUp: function () {
                var self = this;
                if (!this.gdriveToken) { this.toast('Nicht mit Google verbunden', 'warn'); return; }
                this.gdriveSyncing = true;

                this.gdriveEnsureToken().then(function (token) {
                    return self.gdriveExportData().then(function (data) {
                        return self.gdriveFindFile(token).then(function (fileId) {
                            return self.gdriveUploadFile(token, fileId, data);
                        });
                    });
                }).then(function () {
                    var now = new Date().toISOString();
                    self.gdriveLastSync = now;
                    localStorage.setItem('kcalc_gdrive_last_sync', now);
                    self.toast('Daten zu Google Drive hochgeladen', 'success');
                }).catch(function (err) {
                    if (err.message !== 'TOKEN_EXPIRED') {
                        console.error('Google Drive upload error:', err);
                        self.toast('Upload-Fehler: ' + err.message, 'error');
                    }
                }).finally(function () {
                    self.gdriveSyncing = false;
                });
            },

            gdriveSyncDown: function () {
                var self = this;
                if (!this.gdriveToken) { this.toast('Nicht mit Google verbunden', 'warn'); return; }
                this.gdriveSyncing = true;

                this.gdriveEnsureToken().then(function (token) {
                    return self.gdriveFindFile(token).then(function (fileId) {
                        if (!fileId) {
                            self.toast('Keine Daten in Google Drive gefunden', 'info');
                            return null;
                        }
                        return self.gdriveDownloadFile(token, fileId);
                    });
                }).then(function (data) {
                    if (!data) return;
                    if (!data.version || !data.profiles) {
                        self.toast('Ungueltige Daten in Google Drive', 'error');
                        return;
                    }
                    self.executeImport(data);
                    var now = new Date().toISOString();
                    self.gdriveLastSync = now;
                    localStorage.setItem('kcalc_gdrive_last_sync', now);
                    self.toast('Daten von Google Drive geladen', 'success');
                }).catch(function (err) {
                    if (err.message !== 'TOKEN_EXPIRED') {
                        console.error('Google Drive download error:', err);
                        self.toast('Download-Fehler: ' + err.message, 'error');
                    }
                }).finally(function () {
                    self.gdriveSyncing = false;
                });
            },

            get gdriveStatusText() {
                if (this.gdriveSyncing) return 'Synchronisiere...';
                if (this.gdriveToken) return 'Verbunden';
                return 'Nicht verbunden';
            },

            get gdriveStatusColor() {
                if (this.gdriveSyncing) return 'green';
                if (this.gdriveToken) return 'green';
                return 'gray';
            },

            // ===== Navigation =====
            get navLinks() {
                if (this.view === 'saved') return [
                    { href: '#saved-summary', label: 'Deine Daten' },
                    { href: '#weight-tracker', label: 'Gewichtsverlauf' },
                    { href: '#diet-goal', label: 'Diätziel' },
                    { href: '#macros', label: 'Makros' }
                ];
                return [
                    { href: '#grundumsatz-section', label: 'Grundumsatz' },
                    { href: '#leistungsumsatz-section', label: 'Leistungsumsatz' }
                ];
            },

            // ===== Helpers =====
            todayStr: function () { return new Date().toISOString().split('T')[0]; },

            fmtDate: function (iso) {
                if (!iso) return '-';
                try { return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
                catch (e) { return iso; }
            },

            fmtWeightDate: function (d) { var p = d.split('-'); return p[2] + '.' + p[1] + '.' + p[0]; },

            formelText: function () {
                return { harris: 'Harris-Benedict', mifflin: 'Mifflin-St.Jeor', mittelwert: 'Mittelwert' }[this.form.formel] || this.form.formel;
            },

            // ===== Toast =====
            toast: function (msg, type) {
                if (typeof Toastify === 'undefined') return;
                var bg = { success: 'linear-gradient(to right, #27ae60, #2ecc71)', error: 'linear-gradient(to right, #e74c3c, #c0392b)', info: 'linear-gradient(to right, #3498db, #2980b9)', warn: 'linear-gradient(to right, #f39c12, #e67e22)' };
                Toastify({ text: msg, duration: 3000, gravity: 'bottom', position: 'right', style: { background: bg[type] || bg.info }, stopOnFocus: true }).showToast();
            },

            confirmToast: function (msg, onConfirm) {
                if (typeof Toastify === 'undefined') { if (confirm(msg)) onConfirm(); return; }
                var t = Toastify({ text: ' ', duration: -1, gravity: 'top', position: 'center', className: 'confirm-toast', style: { background: 'linear-gradient(to right, #2c3e50, #34495e)', maxWidth: '400px', padding: '0', borderRadius: '10px', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }, stopOnFocus: true, close: false });
                t.showToast();
                var el = t.toastElement; if (!el) return;
                el.innerHTML = '<div style="padding:16px 20px;text-align:center;"><p style="margin:0 0 14px;font-size:14px;line-height:1.4;color:#fff;">' + msg + '</p><div style="display:flex;gap:10px;justify-content:center;"><button class="cy" style="padding:8px 24px;background:#e74c3c;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">Ja, löschen</button><button class="cn" style="padding:8px 24px;background:#95a5a6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">Abbrechen</button></div></div>';
                el.querySelector('.cy').addEventListener('click', function () { t.hideToast(); onConfirm(); });
                el.querySelector('.cn').addEventListener('click', function () { t.hideToast(); });
            }
        };
    });
});
