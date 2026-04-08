// Diäthelfer - Macros Module
'use strict';

(function () {
    // ===== Makro-Profile =====
    var PROFILES = {
        'balanced': {
            name: 'Ausgewogen',
            protein: 0.30,
            carbs: 0.40,
            fat: 0.30
        },
        'low-carb': {
            name: 'Low-Carb',
            protein: 0.35,
            carbs: 0.20,
            fat: 0.45
        },
        'high-protein': {
            name: 'High-Protein',
            protein: 0.40,
            carbs: 0.35,
            fat: 0.25
        }
    };

    // Kalorien pro Gramm
    var KCAL_PER_GRAM = {
        protein: 4,
        carbs: 4,
        fat: 9
    };

    // Farben (CSS-Variablen)
    var COLORS = {
        protein: '#e74c3c',
        carbs: '#f39c12',
        fat: '#3498db'
    };

    var currentProfile = 'balanced';
    var currentCalories = 0;

    // ===== Makro-Berechnung =====

    /**
     * Berechnet Gramm-Werte aus Kalorien und Profil.
     * @param {number} calories - Ziel-Kalorien
     * @param {string} profileKey - Profil-Schlüssel
     * @returns {object} { protein: {g, kcal, pct}, carbs: {...}, fat: {...} }
     */
    function calculateMacros(calories, profileKey) {
        var profile = PROFILES[profileKey] || PROFILES['balanced'];
        return {
            protein: {
                grams: Math.round((calories * profile.protein) / KCAL_PER_GRAM.protein),
                kcal: Math.round(calories * profile.protein),
                percent: Math.round(profile.protein * 100)
            },
            carbs: {
                grams: Math.round((calories * profile.carbs) / KCAL_PER_GRAM.carbs),
                kcal: Math.round(calories * profile.carbs),
                percent: Math.round(profile.carbs * 100)
            },
            fat: {
                grams: Math.round((calories * profile.fat) / KCAL_PER_GRAM.fat),
                kcal: Math.round(calories * profile.fat),
                percent: Math.round(profile.fat * 100)
            }
        };
    }

    // ===== SVG Kreisdiagramm =====

    /**
     * Zeichnet ein Donut-Kreisdiagramm als SVG.
     * @param {object} macros - Berechnete Makros
     */
    function drawPieChart(macros) {
        var svg = document.getElementById('macroChart');
        if (!svg) return;

        var cx = 100;
        var cy = 100;
        var radius = 80;
        var circumference = 2 * Math.PI * radius;

        // SVG leeren
        svg.innerHTML = '';

        // Hintergrund-Kreis
        var bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bgCircle.setAttribute('cx', cx);
        bgCircle.setAttribute('cy', cy);
        bgCircle.setAttribute('r', radius);
        bgCircle.setAttribute('fill', 'none');
        bgCircle.setAttribute('stroke', '#f0f0f0');
        bgCircle.setAttribute('stroke-width', '30');
        svg.appendChild(bgCircle);

        var segments = [
            { key: 'protein', percent: macros.protein.percent, color: COLORS.protein },
            { key: 'carbs', percent: macros.carbs.percent, color: COLORS.carbs },
            { key: 'fat', percent: macros.fat.percent, color: COLORS.fat }
        ];

        var offset = 0;
        segments.forEach(function (seg) {
            var segLength = (seg.percent / 100) * circumference;
            var gapLength = circumference - segLength;

            var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', cx);
            circle.setAttribute('cy', cy);
            circle.setAttribute('r', radius);
            circle.setAttribute('fill', 'none');
            circle.setAttribute('stroke', seg.color);
            circle.setAttribute('stroke-width', '30');
            circle.setAttribute('stroke-dasharray', segLength + ' ' + gapLength);
            circle.setAttribute('stroke-dashoffset', -offset);
            // Rotate -90deg so chart starts at top
            circle.setAttribute('transform', 'rotate(-90 ' + cx + ' ' + cy + ')');
            circle.style.transition = 'stroke-dasharray 0.6s ease, stroke-dashoffset 0.6s ease';

            svg.appendChild(circle);

            offset += segLength;
        });

        // Zentral-Text
        var totalKcal = macros.protein.kcal + macros.carbs.kcal + macros.fat.kcal;
        var textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        textEl.setAttribute('x', cx);
        textEl.setAttribute('y', cy - 5);
        textEl.setAttribute('text-anchor', 'middle');
        textEl.setAttribute('font-size', '18');
        textEl.setAttribute('font-weight', 'bold');
        textEl.setAttribute('fill', '#2c3e50');
        textEl.textContent = totalKcal.toLocaleString('de-DE');
        svg.appendChild(textEl);

        var unitEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        unitEl.setAttribute('x', cx);
        unitEl.setAttribute('y', cy + 15);
        unitEl.setAttribute('text-anchor', 'middle');
        unitEl.setAttribute('font-size', '11');
        unitEl.setAttribute('fill', '#7f8c8d');
        unitEl.textContent = 'kcal';
        svg.appendChild(unitEl);

        // Legende aktualisieren
        updateLegend(macros);
    }

    /**
     * Aktualisiert die Chart-Legende.
     */
    function updateLegend(macros) {
        var legend = document.getElementById('macroChartLegend');
        if (!legend) return;

        legend.innerHTML =
            '<div class="legend-item"><span class="legend-color" style="background:' + COLORS.protein + '"></span>Protein: ' + macros.protein.percent + '% (' + macros.protein.grams + 'g)</div>' +
            '<div class="legend-item"><span class="legend-color" style="background:' + COLORS.carbs + '"></span>Kohlenhydrate: ' + macros.carbs.percent + '% (' + macros.carbs.grams + 'g)</div>' +
            '<div class="legend-item"><span class="legend-color" style="background:' + COLORS.fat + '"></span>Fett: ' + macros.fat.percent + '% (' + macros.fat.grams + 'g)</div>';
    }

    // ===== UI-Aktualisierung =====

    // Cached DOM references (initialized in init)
    var domCache = {};

    function cacheDomElements() {
        domCache.proteinGrams = document.getElementById('proteinGrams');
        domCache.proteinBar = document.getElementById('proteinBar');
        domCache.proteinPercent = document.getElementById('proteinPercent');
        domCache.carbsGrams = document.getElementById('carbsGrams');
        domCache.carbsBar = document.getElementById('carbsBar');
        domCache.carbsPercent = document.getElementById('carbsPercent');
        domCache.fatGrams = document.getElementById('fatGrams');
        domCache.fatBar = document.getElementById('fatBar');
        domCache.fatPercent = document.getElementById('fatPercent');
    }

    /**
     * Aktualisiert die Makro-Karten und Balken.
     * @param {object} macros
     */
    function updateMacroCards(macros) {
        if (domCache.proteinGrams) domCache.proteinGrams.textContent = macros.protein.grams;
        if (domCache.proteinBar) domCache.proteinBar.style.width = macros.protein.percent + '%';
        if (domCache.proteinPercent) domCache.proteinPercent.textContent = macros.protein.percent + '%';

        if (domCache.carbsGrams) domCache.carbsGrams.textContent = macros.carbs.grams;
        if (domCache.carbsBar) domCache.carbsBar.style.width = macros.carbs.percent + '%';
        if (domCache.carbsPercent) domCache.carbsPercent.textContent = macros.carbs.percent + '%';

        if (domCache.fatGrams) domCache.fatGrams.textContent = macros.fat.grams;
        if (domCache.fatBar) domCache.fatBar.style.width = macros.fat.percent + '%';
        if (domCache.fatPercent) domCache.fatPercent.textContent = macros.fat.percent + '%';
    }

    /**
     * Aktualisiert die gesamte Makro-Anzeige.
     */
    function updateDisplay() {
        if (currentCalories <= 0) return;

        var macros = calculateMacros(currentCalories, currentProfile);
        updateMacroCards(macros);
        drawPieChart(macros);
    }

    // ===== Initialisierung =====

    function init() {
        var macrosSection = document.getElementById('macros');
        if (!macrosSection) return;

        // Cache DOM elements for performance
        cacheDomElements();

        // Profil-Buttons
        var profileBtns = macrosSection.querySelectorAll('.macro-profile-btn');
        profileBtns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                profileBtns.forEach(function (b) { b.classList.remove('macro-profile-btn--active'); });
                btn.classList.add('macro-profile-btn--active');
                currentProfile = btn.getAttribute('data-profile');
                updateDisplay();
            });
        });

        // Auf Diätziel-Änderungen reagieren
        document.addEventListener('dietGoalChanged', function (e) {
            var detail = e.detail;
            currentCalories = detail.calories;
            macrosSection.classList.remove('hidden');
            updateDisplay();
        });
    }

    // Globale API
    window.Macros = {
        calculateMacros: calculateMacros,
        init: init
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
