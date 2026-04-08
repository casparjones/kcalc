// Diäthelfer - Calculator Module
// Basierend auf diaethelfer.com Berechnungslogik
'use strict';

(function () {
    // ===== Berechnungsklasse =====

    var gewicht = 0;
    var groesse = 0;
    var alter = 0;
    var geschlecht = 'm';

    function setGewicht(val) {
        val = parseFloat(val);
        if (isNaN(val) || val <= 0) return false;
        gewicht = val;
        return true;
    }

    function setGroesse(val) {
        val = parseFloat(val);
        if (isNaN(val) || val <= 0) return false;
        groesse = val;
        return true;
    }

    function setAlter(val) {
        val = parseInt(val, 10);
        if (isNaN(val) || val <= 0) return false;
        alter = val;
        return true;
    }

    function setGeschlecht(val) {
        if (val !== 'm' && val !== 'w') return false;
        geschlecht = val;
        return true;
    }

    // Harris-Benedict Formel
    function harrisBenedict(g, gr, a, s) {
        if (s === 'm') {
            return 66.47 + (13.7 * g) + (5.003 * gr) - (6.755 * a);
        } else {
            return 655.1 + (9.563 * g) + (1.85 * gr) - (4.676 * a);
        }
    }

    // Mifflin-St.Jeor Formel
    function mifflinStJeor(g, gr, a, s) {
        if (s === 'm') {
            return (10 * g) + (6.25 * gr) - (5 * a) + 5;
        } else {
            return (10 * g) + (6.25 * gr) - (5 * a) - 161;
        }
    }

    // Broca-Index Anpassung: Angepasstes Gewicht bei BMI > 30
    function brocaAnpassung(g, gr) {
        var bmi = g / ((gr / 100) * (gr / 100));
        if (bmi >= 30) {
            var idealGewicht = gr - 100;
            return idealGewicht + 0.4 * (g - idealGewicht);
        }
        return g;
    }

    function getGrundumsatz(formel, anpassung) {
        if (gewicht <= 0 || groesse <= 0 || alter <= 0) return 0;

        var g = gewicht;
        if (anpassung === 'j') {
            g = brocaAnpassung(gewicht, groesse);
        }

        var gu = 0;
        if (formel === 'harris') {
            gu = harrisBenedict(g, groesse, alter, geschlecht);
        } else if (formel === 'mifflin') {
            gu = mifflinStJeor(g, groesse, alter, geschlecht);
        } else if (formel === 'mittelwert') {
            var h = harrisBenedict(g, groesse, alter, geschlecht);
            var m = mifflinStJeor(g, groesse, alter, geschlecht);
            gu = (h + m) / 2;
        }

        return Math.round(gu);
    }

    // ===== PAL-System =====

    function parseZeit(zeit) {
        var h = 0;
        zeit = String(zeit).trim();
        if (zeit.indexOf(':') >= 0) {
            h = parseInt(zeit, 10) || 0;
            var rest = zeit.substr(zeit.indexOf(':') + 1);
            if (rest.length > 0) {
                h += parseFloat(rest) / 60;
            }
        } else {
            zeit = zeit.replace(/,/g, '.');
            if (zeit.indexOf('.') >= 0) {
                h = parseFloat(zeit) || 0;
            } else {
                h = (parseInt(zeit, 10) || 0) / 60;
            }
        }
        if (h < 0) h = 0;
        if (h > 24) h = 24;
        return h;
    }

    function formatZeit(h) {
        if (h < 0) h = 0;
        if (h > 24) h = 24;
        var stunden = Math.floor(h);
        var minuten = Math.round((h - stunden) * 60);
        if (minuten >= 60) { stunden++; minuten = 0; }
        return stunden + ':' + (minuten < 10 ? '0' : '') + minuten;
    }

    function addTaetigkeit(stunden) {
        var tbody = document.getElementById('pal-body');
        if (!tbody) return;

        var firstRow = tbody.querySelector('.pal-row');
        if (!firstRow) return;

        var newRow = firstRow.cloneNode(true);
        var inputs = newRow.querySelectorAll('input');
        inputs.forEach(function (inp) {
            if (inp.classList.contains('pal-zeit')) {
                inp.value = formatZeit(stunden || 0);
            } else {
                inp.value = '';
            }
        });

        // Standard auf "Schreibtischtätigkeit" setzen
        var select = newRow.querySelector('.pal-tat');
        if (select) select.selectedIndex = 2;

        tbody.appendChild(newRow);
        bindRowEvents(newRow);
        berechnepal();
    }

    function berechnepal() {
        var rows = document.querySelectorAll('.pal-row');
        var pal24 = 0;
        var tag = 0;
        var leerIndex = -1;

        rows.forEach(function (row, i) {
            var tatSelect = row.querySelector('.pal-tat');
            var zeitInput = row.querySelector('.pal-zeit');
            var faktorInput = row.querySelector('.pal-faktor');
            var sumInput = row.querySelector('.pal-sum');

            if (!tatSelect || !zeitInput || !faktorInput || !sumInput) return;

            var tatValue = parseFloat(tatSelect.value);

            // Faktor setzen
            if (tatValue > 0) {
                faktorInput.value = tatValue.toFixed(2);
                faktorInput.readOnly = true;
            } else {
                faktorInput.readOnly = false;
                var f = parseFloat(faktorInput.value);
                if (isNaN(f) || f < 1.2) {
                    faktorInput.value = '1.20';
                } else if (f > 3.0) {
                    faktorInput.value = '3.00';
                } else {
                    faktorInput.value = f.toFixed(2);
                }
            }

            var h = parseZeit(zeitInput.value);
            tag += h;
            if (tag > 24) {
                h = h - (tag - 24);
                if (h < 0) h = 0;
                tag = 24;
            }
            zeitInput.value = formatZeit(h);

            var faktor = parseFloat(faktorInput.value) || 0;
            sumInput.value = (h * faktor).toFixed(2);
            pal24 += h * faktor;

            if (h === 0 && tatValue > 0) {
                leerIndex = i;
            }
        });

        // Fehlende Stunden auffüllen
        if (tag < 24) {
            if (leerIndex >= 0) {
                var leerRow = rows[leerIndex];
                var leerZeit = leerRow.querySelector('.pal-zeit');
                var leerFaktor = leerRow.querySelector('.pal-faktor');
                var leerSum = leerRow.querySelector('.pal-sum');
                var fehlend = 24 - tag;
                var altH = parseZeit(leerZeit.value);
                var neuH = altH + fehlend;
                leerZeit.value = formatZeit(neuH);
                var fk = parseFloat(leerFaktor.value) || 0;
                leerSum.value = (neuH * fk).toFixed(2);
                pal24 += fehlend * fk;
                tag = 24;
            } else {
                addTaetigkeit(24 - tag);
                return; // addTaetigkeit ruft berechnepal() erneut auf
            }
        }

        // Summen aktualisieren
        var summe24El = document.getElementById('summe24');
        var palEl = document.getElementById('pal');
        if (summe24El) summe24El.value = pal24.toFixed(2);
        if (palEl) palEl.value = (pal24 / 24).toFixed(2);

        berechneGesamtumsatz();
    }

    function berechneGesamtumsatz() {
        var gu = parseFloat(document.getElementById('grundumsatz').value);
        var pal = parseFloat(document.getElementById('pal').value);
        var luEl = document.getElementById('leistungsumsatz');
        var guEl = document.getElementById('gesamtumsatz');

        if (isNaN(gu) || isNaN(pal) || gu <= 0) {
            if (luEl) luEl.value = '';
            if (guEl) guEl.value = '';
            return;
        }

        var gesamtumsatz = Math.round(gu * pal);
        var leistungsumsatz = gesamtumsatz - Math.round(gu);

        if (luEl) luEl.value = leistungsumsatz;
        if (guEl) guEl.value = gesamtumsatz;

        // Diätziel und Makros aktualisieren
        if (gesamtumsatz > 0) {
            displayDietGoals(gesamtumsatz);
        }
    }

    // ===== Diätziel =====

    function displayDietGoals(tdee) {
        var dietSection = document.getElementById('diet-goal');
        if (!dietSection) return;
        dietSection.classList.remove('hidden');

        var loseCalories = tdee - 500;
        var maintainCalories = tdee;
        var gainCalories = tdee + 500;

        document.getElementById('loseCalories').textContent = loseCalories.toLocaleString('de-DE');
        document.getElementById('maintainCalories').textContent = maintainCalories.toLocaleString('de-DE');
        document.getElementById('gainCalories').textContent = gainCalories.toLocaleString('de-DE');

        // Drucken-Button anzeigen
        var printContainer = document.getElementById('printBtnContainer');
        if (printContainer) printContainer.classList.remove('hidden');

        // Klick-Handler für Ziel-Karten
        var goalCards = dietSection.querySelectorAll('.goal-card');
        goalCards.forEach(function (card) {
            // Event-Handler neu setzen
            var newCard = card.cloneNode(true);
            card.parentNode.replaceChild(newCard, card);

            newCard.addEventListener('click', function () {
                dietSection.querySelectorAll('.goal-card').forEach(function (c) {
                    c.classList.remove('goal-card--active');
                });
                newCard.classList.add('goal-card--active');

                var goal = newCard.getAttribute('data-goal');
                var targetCalories = goal === 'lose' ? loseCalories : goal === 'gain' ? gainCalories : maintainCalories;

                document.dispatchEvent(new CustomEvent('dietGoalChanged', {
                    detail: { goal: goal, calories: targetCalories, tdee: tdee }
                }));
            });
        });

        // Standard: Gewicht halten
        document.dispatchEvent(new CustomEvent('dietGoalChanged', {
            detail: { goal: 'maintain', calories: maintainCalories, tdee: tdee }
        }));
    }

    // ===== Grundumsatz-Ausgabe =====

    function ausgabe() {
        var formel = document.getElementById('formel').value;
        var anpassung = document.getElementById('anpassung').value;
        var guEl = document.getElementById('grundumsatz');

        var gu = getGrundumsatz(formel, anpassung);
        if (gu > 0) {
            guEl.value = gu;
        } else {
            guEl.value = '-';
        }
        berechneGesamtumsatz();
    }

    // ===== Event-Binding für PAL-Zeilen =====

    function bindRowEvents(row) {
        var tatSelect = row.querySelector('.pal-tat');
        var zeitInput = row.querySelector('.pal-zeit');
        var faktorInput = row.querySelector('.pal-faktor');

        if (tatSelect) {
            tatSelect.addEventListener('change', function () {
                berechnepal();
            });
        }
        if (zeitInput) {
            zeitInput.addEventListener('change', function () {
                berechnepal();
            });
        }
        if (faktorInput) {
            faktorInput.addEventListener('change', function () {
                berechnepal();
            });
        }
    }

    // ===== Initialisierung =====

    function init() {
        // Grundumsatz-Eingaben binden
        var gewichtEl = document.getElementById('gewicht');
        var groesseEl = document.getElementById('groesse');
        var alterEl = document.getElementById('alter');
        var geschlechtEl = document.getElementById('geschlecht');
        var formelEl = document.getElementById('formel');
        var anpassungEl = document.getElementById('anpassung');

        if (gewichtEl) {
            gewichtEl.addEventListener('change', function () {
                setGewicht(this.value);
                ausgabe();
            });
            gewichtEl.addEventListener('input', function () {
                setGewicht(this.value);
                ausgabe();
            });
        }
        if (groesseEl) {
            groesseEl.addEventListener('change', function () {
                setGroesse(this.value);
                ausgabe();
            });
            groesseEl.addEventListener('input', function () {
                setGroesse(this.value);
                ausgabe();
            });
        }
        if (alterEl) {
            alterEl.addEventListener('change', function () {
                setAlter(this.value);
                ausgabe();
            });
            alterEl.addEventListener('input', function () {
                setAlter(this.value);
                ausgabe();
            });
        }
        if (geschlechtEl) {
            geschlechtEl.addEventListener('change', function () {
                setGeschlecht(this.value);
                ausgabe();
            });
        }
        if (formelEl) {
            formelEl.addEventListener('change', function () {
                ausgabe();
            });
        }
        if (anpassungEl) {
            anpassungEl.addEventListener('change', function () {
                ausgabe();
            });
        }

        // PAL-System initialisieren
        var firstRow = document.querySelector('.pal-row');
        if (firstRow) {
            bindRowEvents(firstRow);
        }

        var addBtn = document.getElementById('addTatBtn');
        if (addBtn) {
            addBtn.addEventListener('click', function () {
                addTaetigkeit(0);
            });
        }

        // Initiale PAL-Berechnung
        berechnepal();
    }

    // Globale API
    window.Calculator = {
        getGrundumsatz: getGrundumsatz,
        init: init
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
