// Diäthelfer - Storage Module (localStorage, Multi-Profil)
'use strict';

(function () {
    var STORAGE_KEY = 'diaethelfer_profiles';
    var ACTIVE_KEY = 'diaethelfer_active';
    var isTemporary = false; // true wenn geteilte Daten ohne lokalen Speicher

    // ===== Toast =====
    function toast(msg, type) {
        if (typeof Toastify === 'undefined') return;
        var bg = {
            success: 'linear-gradient(to right, #27ae60, #2ecc71)',
            error: 'linear-gradient(to right, #e74c3c, #c0392b)',
            info: 'linear-gradient(to right, #3498db, #2980b9)',
            warn: 'linear-gradient(to right, #f39c12, #e67e22)'
        };
        Toastify({ text: msg, duration: 3000, gravity: 'bottom', position: 'right',
            style: { background: bg[type] || bg.info }, stopOnFocus: true }).showToast();
    }

    function confirmToast(msg, onConfirm) {
        if (typeof Toastify === 'undefined') { if (confirm(msg)) onConfirm(); return; }
        var t = Toastify({ text: ' ', duration: -1, gravity: 'top', position: 'center',
            className: 'confirm-toast',
            style: { background: 'linear-gradient(to right, #2c3e50, #34495e)', maxWidth: '400px', padding: '0', borderRadius: '10px', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' },
            stopOnFocus: true, close: false });
        t.showToast();
        var el = t.toastElement; if (!el) return;
        el.innerHTML = '<div style="padding:16px 20px;text-align:center;">' +
            '<p style="margin:0 0 14px;font-size:14px;line-height:1.4;color:#fff;">' + msg + '</p>' +
            '<div style="display:flex;gap:10px;justify-content:center;">' +
            '<button class="cy" style="padding:8px 24px;background:#e74c3c;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">Ja, löschen</button>' +
            '<button class="cn" style="padding:8px 24px;background:#95a5a6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">Abbrechen</button>' +
            '</div></div>';
        el.querySelector('.cy').addEventListener('click', function () { t.hideToast(); onConfirm(); });
        el.querySelector('.cn').addEventListener('click', function () { t.hideToast(); });
    }

    // ===== Storage =====
    function loadAllProfiles() {
        try { var r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : {}; }
        catch (e) { return {}; }
    }
    function saveAllProfiles(p) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); return true; }
        catch (e) { toast('Fehler beim Speichern', 'error'); return false; }
    }
    function getActive() { return localStorage.getItem(ACTIVE_KEY) || ''; }
    function setActive(n) { localStorage.setItem(ACTIVE_KEY, n); }
    function loadData() { var n = getActive(); if (!n) return null; return loadAllProfiles()[n] || null; }
    function getNames() { return Object.keys(loadAllProfiles()); }

    function deleteProfile(name) {
        var all = loadAllProfiles(); delete all[name]; saveAllProfiles(all);
        if (getActive() === name) {
            var r = Object.keys(all);
            r.length > 0 ? setActive(r[0]) : localStorage.removeItem(ACTIVE_KEY);
        }
    }

    // ===== Nav =====
    function updateNav() {
        var saved = !!getActive() && (!!loadData() || isTemporary);
        var html = saved
            ? '<li><a href="#saved-summary">Deine Daten</a></li><li><a href="#weight-tracker">Gewichtsverlauf</a></li><li><a href="#diet-goal">Diätziel</a></li><li><a href="#macros">Makros</a></li>'
            : '<li><a href="#grundumsatz-section">Grundumsatz</a></li><li><a href="#leistungsumsatz-section">Leistungsumsatz</a></li><li><a href="#diet-goal">Diätziel</a></li><li><a href="#macros">Makros</a></li>';
        // Desktop nav
        var desktopUl = document.getElementById('navLinksDesktop');
        if (desktopUl) desktopUl.innerHTML = html;
        // Mobile nav
        var mobileUl = document.getElementById('mobileNavLinks');
        if (mobileUl) mobileUl.innerHTML = html;
    }

    // ===== Profile Dropdown =====
    function updateDropdown() {
        var dd = document.getElementById('profileDropdown');
        var nameEl = document.getElementById('profileNameDisplay');
        var avatarEl = document.getElementById('profileAvatar');
        var switchList = document.getElementById('profileSwitchList');
        if (!dd) return;

        var names = getNames();
        var active = getActive();

        if (!active && !isTemporary) { dd.classList.add('hidden'); return; }
        dd.classList.remove('hidden');
        if (nameEl) nameEl.textContent = active || 'Geteilt';
        if (avatarEl) avatarEl.textContent = (active || 'G').charAt(0).toUpperCase();

        if (switchList) {
            switchList.innerHTML = '';
            // Temp-user save banner
            if (isTemporary) {
                var saveBanner = document.createElement('button');
                saveBanner.className = 'profile-save-banner';
                saveBanner.innerHTML = '&#128190; Lokal speichern';
                saveBanner.addEventListener('click', function () { closeDD(); saveTemporary(); });
                switchList.appendChild(saveBanner);
            }
            if (names.length > 1) {
                names.forEach(function (n) {
                    if (n === active && !isTemporary) return;
                    var btn = document.createElement('button');
                    btn.className = 'profile-dropdown-item';
                    btn.textContent = n;
                    btn.addEventListener('click', function () { closeDD(); activateProfile(n); });
                    switchList.appendChild(btn);
                });
            }
        }
    }

    function closeDD() { var d = document.getElementById('profileDropdown'); if (d) d.classList.remove('open'); }

    // ===== Form =====
    function collectFormData() {
        var palRows = [];
        document.querySelectorAll('.pal-row').forEach(function (row) {
            var t = row.querySelector('.pal-tat'), z = row.querySelector('.pal-zeit'), f = row.querySelector('.pal-faktor');
            if (t && z && f) palRows.push({ tat: t.value, tatText: t.options[t.selectedIndex].text, zeit: z.value, faktor: f.value });
        });
        return {
            gewicht: document.getElementById('gewicht').value,
            groesse: document.getElementById('groesse').value,
            alter: document.getElementById('alter').value,
            geschlecht: document.getElementById('geschlecht').value,
            formel: document.getElementById('formel').value,
            anpassung: document.getElementById('anpassung').value,
            palRows: palRows,
            grundumsatz: document.getElementById('grundumsatz').value,
            pal: document.getElementById('pal').value,
            leistungsumsatz: document.getElementById('leistungsumsatz').value,
            gesamtumsatz: document.getElementById('gesamtumsatz').value,
            savedAt: new Date().toISOString()
        };
    }

    function restoreFormData(data) {
        if (!data) return;
        ['gewicht', 'groesse', 'alter', 'geschlecht', 'formel', 'anpassung'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el && data[id] !== undefined) { el.value = data[id]; el.dispatchEvent(new Event('change')); }
        });
    }

    // ===== Summary =====
    function fmtDate(iso) {
        if (!iso) return '-';
        try { return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
        catch (e) { return iso; }
    }

    function calcBmi(gewicht, groesse) {
        var w = parseFloat(gewicht);
        var h = parseFloat(groesse);
        if (!w || !h || h <= 0) return null;
        return w / ((h / 100) * (h / 100));
    }

    function bmiIndicator(bmi) {
        if (bmi === null) return { text: '-', icon: '', cls: '' };
        var val = bmi.toFixed(1);
        if (bmi < 18.5) return { text: val, icon: '<span class="bmi-arrow bmi-low">&#9650;</span>', cls: 'bmi-low' };  // rot pfeil nach oben = zu niedrig
        if (bmi < 25) return { text: val, icon: '<span class="bmi-ok">&#10003;</span>', cls: 'bmi-ok' };  // grüner haken
        if (bmi < 30) return { text: val, icon: '<span class="bmi-arrow bmi-high">&#9660;</span>', cls: 'bmi-high' };  // rot pfeil nach unten = zu hoch
        return { text: val, icon: '<span class="bmi-arrow bmi-high">&#9660;</span>', cls: 'bmi-high' };  // adipös
    }

    function showSummary(data, name) {
        var el = document.getElementById('summaryContent');
        var sec = document.getElementById('saved-summary');
        if (!el || !sec || !data) return;

        var g = data.geschlecht === 'm' ? 'M' : 'W';
        var f = { harris: 'Harris-Benedict', mifflin: 'Mifflin-St.Jeor', mittelwert: 'Mittelwert' }[data.formel] || data.formel;
        var titleEl = document.getElementById('summaryTitle');
        if (titleEl) titleEl.textContent = name || getActive() || 'Deine Daten';

        var bmi = calcBmi(data.gewicht, data.groesse);
        var bi = bmiIndicator(bmi);

        el.innerHTML =
            '<div class="summary-item"><span class="summary-label">Gewicht</span><span class="summary-val">' + data.gewicht + ' kg</span></div>' +
            '<div class="summary-item"><span class="summary-label">Größe</span><span class="summary-val">' + data.groesse + ' cm</span></div>' +
            '<div class="summary-item"><span class="summary-label">Alter</span><span class="summary-val">' + data.alter + ' J.</span></div>' +
            '<div class="summary-item"><span class="summary-label">Geschlecht</span><span class="summary-val">' + g + '</span></div>' +
            '<div class="summary-item"><span class="summary-label">Formel</span><span class="summary-val">' + f + '</span></div>' +
            '<div class="summary-item"><span class="summary-label">Broca</span><span class="summary-val">' + (data.anpassung === 'j' ? 'Ja' : 'Nein') + '</span></div>' +
            '<div class="summary-item"><span class="summary-label">PAL</span><span class="summary-val">' + (data.pal || '-') + '</span></div>' +
            '<div class="summary-item"><span class="summary-label">Erstellt</span><span class="summary-val">' + fmtDate(data.savedAt) + '</span></div>' +
            '<div class="summary-item ' + bi.cls + '"><span class="summary-label">BMI</span><span class="summary-val">' + bi.text + ' ' + bi.icon + '</span></div>' +
            '<div class="summary-item summary-item--highlight"><span class="summary-label">Grundumsatz</span><span class="summary-val">' + (data.grundumsatz || '-') + ' kcal</span></div>' +
            '<div class="summary-item summary-item--highlight"><span class="summary-label">Leistungsumsatz</span><span class="summary-val">' + (data.leistungsumsatz || '-') + ' kcal</span></div>' +
            '<div class="summary-item summary-item--highlight"><span class="summary-label">Gesamtumsatz</span><span class="summary-val">' + (data.gesamtumsatz || '-') + ' kcal</span></div>';

        sec.classList.remove('hidden');
        document.getElementById('grundumsatz-section').classList.add('hidden');
        document.getElementById('leistungsumsatz-section').classList.add('hidden');
        updateNav();
    }

    function showEditMode() {
        document.getElementById('grundumsatz-section').classList.remove('hidden');
        document.getElementById('leistungsumsatz-section').classList.remove('hidden');
        document.getElementById('saved-summary').classList.add('hidden');
        var n = document.getElementById('saveName');
        if (n && getActive()) n.value = getActive();
        updateNav();
    }

    // ===== Profil aktivieren =====
    function activateProfile(name) {
        isTemporary = false;
        setActive(name);
        var all = loadAllProfiles();
        var pd = all[name]; if (!pd) return;
        restoreFormData(pd.profile);
        setTimeout(function () {
            var fresh = collectFormData();
            showSummary(fresh, name);
            document.dispatchEvent(new CustomEvent('dataSaved', { detail: pd }));
            // Diätziel + Makros einblenden wenn Gesamtumsatz vorhanden
            var ge = parseFloat(fresh.gesamtumsatz);
            if (ge > 0 && window.Calculator && window.Calculator.displayDietGoals) {
                window.Calculator.displayDietGoals(ge);
            }
            updateDropdown(); updateNav();
        }, 300);
    }

    // ===== Temp-User speichern =====
    var tempData = null;
    function saveTemporary() {
        if (!tempData) return;
        var name = tempData.name || 'Geteilt';
        var wh = (tempData.weightHistory || []).map(function (e, i) {
            return { date: e.date, weight: e.weight, id: Date.now() + i };
        });
        wh.sort(function (a, b) { return a.date.localeCompare(b.date); });
        var all = loadAllProfiles();
        all[name] = { profile: tempData.profile || {}, weightHistory: wh };
        saveAllProfiles(all); setActive(name);
        isTemporary = false; tempData = null;
        toast('"' + name + '" lokal gespeichert', 'success');
        updateDropdown(); updateNav();
    }

    // ===== Share =====
    function generateShareUrl() {
        var data = loadData(); var name = getActive();
        if (!data) { toast('Keine Daten zum Teilen', 'warn'); return ''; }
        var p = data.profile ? {
            g: data.profile.gewicht, gr: data.profile.groesse, a: data.profile.alter,
            s: data.profile.geschlecht, f: data.profile.formel, an: data.profile.anpassung,
            gu: data.profile.grundumsatz, pl: data.profile.pal,
            lu: data.profile.leistungsumsatz, ge: data.profile.gesamtumsatz, sa: data.profile.savedAt
        } : null;
        var payload = { n: name, p: p,
            w: (data.weightHistory || []).map(function (e) { return { d: e.date, w: e.weight }; })
        };
        return window.location.origin + window.location.pathname + '?d=' + btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    }

    function loadFromShareUrl() {
        var enc = new URLSearchParams(window.location.search).get('d');
        if (!enc) return null;
        try {
            var raw = JSON.parse(decodeURIComponent(escape(atob(enc))));
            var r = { name: raw.n || '', weightHistory: [] };
            if (raw.p) {
                r.profile = { gewicht: raw.p.g, groesse: raw.p.gr, alter: raw.p.a,
                    geschlecht: raw.p.s, formel: raw.p.f, anpassung: raw.p.an,
                    grundumsatz: raw.p.gu, pal: raw.p.pl, leistungsumsatz: raw.p.lu,
                    gesamtumsatz: raw.p.ge, savedAt: raw.p.sa };
            }
            if (raw.w) r.weightHistory = raw.w.map(function (e, i) { return { date: e.d, weight: e.w, id: i + 1 }; });
            return r;
        } catch (e) { return null; }
    }

    function openShareOverlay() {
        var url = generateShareUrl();
        if (!url) return;
        var overlay = document.getElementById('shareOverlay');
        var urlInput = document.getElementById('shareUrl');
        if (urlInput) urlInput.value = url;
        if (overlay) overlay.classList.remove('hidden');
    }

    // ===== Init =====
    function init() {
        var saveBtn = document.getElementById('saveLocalBtn');
        var editBtn = document.getElementById('editDataBtn');
        var resaveBtn = document.getElementById('resaveBtn');
        var profileToggle = document.getElementById('profileToggle');
        var deleteBtn = document.getElementById('deleteProfileBtn');
        var newProfileBtn = document.getElementById('newProfileBtn');
        var shareBtn = document.getElementById('shareProfileBtn');
        var shareClose = document.getElementById('shareOverlayClose');
        var copyBtn = document.getElementById('copyShareBtn');
        var overlay = document.getElementById('shareOverlay');

        // Dropdown toggle
        if (profileToggle) {
            profileToggle.addEventListener('click', function (e) { e.stopPropagation();
                document.getElementById('profileDropdown').classList.toggle('open'); });
            document.addEventListener('click', closeDD);
            document.getElementById('profileMenu').addEventListener('click', function (e) { e.stopPropagation(); });
        }

        // Delete profile
        if (deleteBtn) {
            deleteBtn.addEventListener('click', function () { closeDD();
                var name = getActive(); if (!name) return;
                confirmToast('Profil "' + name + '" wirklich löschen?', function () {
                    deleteProfile(name); toast('"' + name + '" gelöscht', 'error');
                    var r = getNames();
                    if (r.length > 0) { activateProfile(r[0]); }
                    else {
                        showEditMode();
                        document.getElementById('weight-tracker').classList.add('hidden');
                        document.getElementById('diet-goal').classList.add('hidden');
                        document.getElementById('macros').classList.add('hidden');
                        updateDropdown(); updateNav();
                    }
                });
            });
        }

        // Neues Profil anlegen
        if (newProfileBtn) {
            newProfileBtn.addEventListener('click', function () {
                closeDD();
                // Formular leeren
                ['gewicht', 'groesse', 'alter'].forEach(function (id) {
                    var el = document.getElementById(id);
                    if (el) el.value = '';
                });
                document.getElementById('geschlecht').value = 'm';
                document.getElementById('formel').value = 'harris';
                document.getElementById('anpassung').value = 'n';
                document.getElementById('grundumsatz').value = '';
                document.getElementById('pal').value = '';
                document.getElementById('leistungsumsatz').value = '';
                document.getElementById('gesamtumsatz').value = '';
                var nameInput = document.getElementById('saveName');
                if (nameInput) nameInput.value = '';
                // Gewichtsverlauf + Diätziel + Makros ausblenden
                document.getElementById('weight-tracker').classList.add('hidden');
                document.getElementById('diet-goal').classList.add('hidden');
                document.getElementById('macros').classList.add('hidden');
                showEditMode();
            });
        }

        // Share button in dropdown
        if (shareBtn) { shareBtn.addEventListener('click', function () { closeDD(); openShareOverlay(); }); }

        // Share overlay close
        if (shareClose) { shareClose.addEventListener('click', function () { overlay.classList.add('hidden'); }); }
        if (overlay) { overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.classList.add('hidden'); }); }

        // Copy share link
        if (copyBtn) {
            copyBtn.addEventListener('click', function () {
                var urlInput = document.getElementById('shareUrl');
                if (!urlInput) return;
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(urlInput.value).then(function () { toast('Link kopiert!', 'success'); });
                } else { urlInput.select(); document.execCommand('copy'); toast('Link kopiert!', 'success'); }
            });
        }

        // Save (new profile)
        if (saveBtn) {
            saveBtn.addEventListener('click', function () {
                var nameInput = document.getElementById('saveName');
                var name = (nameInput ? nameInput.value.trim() : '');
                if (!name) { toast('Bitte einen Namen eingeben', 'warn'); if (nameInput) nameInput.focus(); return; }
                var formData = collectFormData();
                var all = loadAllProfiles(); var prev = all[name] || {};
                var entry = { profile: formData, weightHistory: prev.weightHistory || [] };
                if (entry.weightHistory.length === 0 && formData.gewicht) {
                    entry.weightHistory.push({ date: new Date().toISOString().split('T')[0], weight: parseFloat(formData.gewicht), id: Date.now() });
                }
                all[name] = entry;
                if (saveAllProfiles(all)) {
                    isTemporary = false; tempData = null;
                    setActive(name);
                    toast('"' + name + '" gespeichert', 'success');
                    showSummary(formData, name); updateDropdown(); updateNav();
                    document.dispatchEvent(new CustomEvent('dataSaved', { detail: entry }));
                }
            });
        }

        // Edit
        if (editBtn) { editBtn.addEventListener('click', showEditMode); }

        // Resave
        if (resaveBtn) {
            resaveBtn.addEventListener('click', function () {
                var name = getActive(); if (!name) return;
                var all = loadAllProfiles(); var prev = all[name] || {};
                var formData = !document.getElementById('grundumsatz-section').classList.contains('hidden') ? collectFormData() : (prev.profile || {});
                all[name] = { profile: formData, weightHistory: prev.weightHistory || [] };
                if (saveAllProfiles(all)) {
                    toast('"' + name + '" gespeichert', 'success');
                    showSummary(formData, name);
                    document.dispatchEvent(new CustomEvent('dataSaved', { detail: all[name] }));
                }
            });
        }

        // ===== Load =====
        var shared = loadFromShareUrl();
        var names = getNames();
        var activeName = getActive();

        if (shared && (shared.weightHistory.length > 0 || shared.profile)) {
            var localAll = loadAllProfiles();
            var localProfile = localAll[shared.name];

            if (localProfile) {
                // User exists locally - check if shared data is newer or has more weight entries
                var localWh = localProfile.weightHistory || [];
                var sharedWh = shared.weightHistory || [];
                var localDate = localProfile.profile && localProfile.profile.savedAt ? new Date(localProfile.profile.savedAt) : new Date(0);
                var sharedDate = shared.profile && shared.profile.savedAt ? new Date(shared.profile.savedAt) : new Date(0);

                // Neuestes Gewichtsdatum ermitteln
                var localLastWeight = localWh.length > 0 ? localWh[localWh.length - 1].date : '';
                var sharedLastWeight = sharedWh.length > 0 ? sharedWh[sharedWh.length - 1].date : '';

                var profileNewer = sharedDate > localDate;
                var moreEntries = sharedWh.length > localWh.length;
                var newerEntries = sharedLastWeight > localLastWeight;

                if (profileNewer || moreEntries || newerEntries) {
                    // Geteilte Daten sind neuer/umfangreicher -> lokal aktualisieren
                    var wh = sharedWh.map(function (e, i) {
                        return { date: e.date, weight: e.weight, id: Date.now() + i };
                    });
                    wh.sort(function (a, b) { return a.date.localeCompare(b.date); });
                    // Profil nur aktualisieren wenn neuer, sonst lokales behalten
                    var mergedProfile = profileNewer ? shared.profile : localProfile.profile;
                    localAll[shared.name] = { profile: mergedProfile, weightHistory: wh };
                    saveAllProfiles(localAll);
                    var reasons = [];
                    if (profileNewer) reasons.push('Profil aktualisiert');
                    if (moreEntries) reasons.push(sharedWh.length - localWh.length + ' neue Einträge');
                    if (newerEntries && !moreEntries) reasons.push('neuere Gewichtsdaten');
                    toast('"' + shared.name + '" aktualisiert: ' + reasons.join(', '), 'success');
                } else {
                    toast('Lokale Daten von "' + shared.name + '" sind aktuell', 'info');
                }
                activateProfile(shared.name);
            } else {
                // User does NOT exist locally -> temp view
                isTemporary = true;
                tempData = shared;
                setActive(shared.name || 'Geteilt');
                toast('Geteilter Verlauf von "' + (shared.name || 'Unbekannt') + '"', 'info');
                if (shared.profile) {
                    showSummary(shared.profile, shared.name);
                }
                updateDropdown();
                // Verzögert feuern damit weight-tracker.js seinen Listener registriert hat
                setTimeout(function () {
                    document.dispatchEvent(new CustomEvent('dataSaved', { detail: shared }));
                    if (shared.profile) {
                        var ge = parseFloat(shared.profile.gesamtumsatz);
                        if (ge > 0 && window.Calculator && window.Calculator.displayDietGoals) {
                            window.Calculator.displayDietGoals(ge);
                        }
                    }
                }, 100);
            }
        } else if (activeName && names.indexOf(activeName) >= 0) {
            activateProfile(activeName);
        } else if (names.length > 0) {
            activateProfile(names[0]);
        } else {
            // Kein Profil -> Formulare anzeigen
            showEditMode();
        }

        updateDropdown();
    }

    window.Storage = {
        load: loadData,
        save: function (data) { var n = getActive(); if (!n) return false; var a = loadAllProfiles(); a[n] = data; return saveAllProfiles(a); },
        toast: toast, confirmToast: confirmToast, init: init
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
