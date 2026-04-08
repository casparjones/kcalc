// Alpine.js App - Reactive state & UI logic
'use strict';

document.addEventListener('alpine:init', function () {

    Alpine.data('app', function () {
        var STORAGE_KEY = 'diaethelfer_profiles';
        var ACTIVE_KEY = 'diaethelfer_active';
        var macroColors = { protein: '#e74c3c', carbs: '#f39c12', fat: '#3498db' };

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

            // ===== Lifecycle =====
            init: function () {
                var self = this;
                this.newDate = this.todayStr();
                this.loadProfiles();

                var shared = this.loadShareUrl();
                if (shared && (shared.weightHistory.length > 0 || shared.profile)) {
                    this.handleSharedData(shared);
                } else if (this.activeProfile && this.profiles[this.activeProfile]) {
                    this.activateProfile(this.activeProfile);
                } else {
                    var names = Object.keys(this.profiles);
                    if (names.length > 0) this.activateProfile(names[0]);
                    else this.view = 'form';
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
                var all = this.loadAllProfiles();
                if (all[this.activeProfile]) {
                    all[this.activeProfile].weightHistory = this.weightHistory;
                    this.saveAllProfiles(all);
                }
            },

            drawChart: function () {
                this.$nextTick(function () { WeightChart.draw('weightChart', this.weightHistory); }.bind(this));
            },

            // ===== Profile Storage =====
            loadProfiles: function () {
                try {
                    var raw = localStorage.getItem(STORAGE_KEY);
                    this.profiles = raw ? JSON.parse(raw) : {};
                } catch (e) { this.profiles = {}; }
                this.activeProfile = localStorage.getItem(ACTIVE_KEY) || '';
            },

            loadAllProfiles: function () {
                try { var r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : {}; }
                catch (e) { return {}; }
            },

            saveAllProfiles: function (p) {
                try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); this.profiles = p; return true; }
                catch (e) { this.toast('Fehler beim Speichern', 'error'); return false; }
            },

            get profileNames() { return Object.keys(this.profiles); },
            get hasProfiles() { return this.profileNames.length > 0 || this.isTemporary; },

            activateProfile: function (name) {
                this.isTemporary = false;
                this.activeProfile = name;
                localStorage.setItem(ACTIVE_KEY, name);
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
                    localStorage.setItem(ACTIVE_KEY, name);
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
                    var all = self.loadAllProfiles();
                    delete all[name];
                    self.saveAllProfiles(all);
                    self.toast('"' + name + '" gelöscht', 'error');
                    var remaining = Object.keys(all);
                    if (remaining.length > 0) { self.activateProfile(remaining[0]); }
                    else {
                        self.activeProfile = '';
                        localStorage.removeItem(ACTIVE_KEY);
                        self.weightHistory = [];
                        self.view = 'form';
                    }
                });
            },

            // ===== Sharing =====
            generateShareUrl: function () {
                var all = this.loadAllProfiles();
                var data = all[this.activeProfile];
                if (!data) { this.toast('Keine Daten', 'warn'); return ''; }
                var p = data.profile || {};
                var payload = {
                    n: this.activeProfile,
                    p: { g: p.gewicht, gr: p.groesse, a: p.alter, s: p.geschlecht, f: p.formel, an: p.anpassung, gu: p.grundumsatz, pl: p.pal, lu: p.leistungsumsatz, ge: p.gesamtumsatz, sa: p.savedAt },
                    w: (data.weightHistory || []).map(function (e) { return { d: e.date, w: e.weight }; })
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
                var localAll = this.loadAllProfiles();
                var local = localAll[shared.name];

                if (local) {
                    var localWh = local.weightHistory || [];
                    var sharedWh = shared.weightHistory || [];
                    var localDate = local.profile && local.profile.savedAt ? new Date(local.profile.savedAt) : new Date(0);
                    var sharedDate = shared.profile && shared.profile.savedAt ? new Date(shared.profile.savedAt) : new Date(0);
                    var localLast = localWh.length > 0 ? localWh[localWh.length - 1].date : '';
                    var sharedLast = sharedWh.length > 0 ? sharedWh[sharedWh.length - 1].date : '';

                    if (sharedDate > localDate || sharedWh.length > localWh.length || sharedLast > localLast) {
                        var wh = sharedWh.map(function (e, i) { return { date: e.date, weight: e.weight, id: Date.now() + i }; });
                        wh.sort(function (a, b) { return a.date.localeCompare(b.date); });
                        localAll[shared.name] = { profile: sharedDate > localDate ? shared.profile : local.profile, weightHistory: wh };
                        this.saveAllProfiles(localAll);
                        this.toast('"' + shared.name + '" aktualisiert', 'success');
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
                    var self = this;
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
                localStorage.setItem(ACTIVE_KEY, name);
                this.isTemporary = false;
                this.tempData = null;
                this.weightHistory = wh;
                this.toast('"' + name + '" lokal gespeichert', 'success');
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
