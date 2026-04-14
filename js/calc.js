// Pure calculation functions - no DOM, no side effects
'use strict';

var Calc = {
    harrisBenedict: function (w, h, a, sex) {
        if (sex === 'm') return 66.47 + (13.7 * w) + (5.0 * h) - (6.8 * a);
        return 655.1 + (9.6 * w) + (1.8 * h) - (4.7 * a);
    },

    mifflinStJeor: function (w, h, a, sex) {
        if (sex === 'm') return (10 * w) + (6.25 * h) - (5 * a) + 5;
        return (10 * w) + (6.25 * h) - (5 * a) - 161;
    },

    brocaAdjust: function (w, h) {
        var bmi = w / ((h / 100) * (h / 100));
        if (bmi >= 30) {
            var ideal = h - 100;
            return ideal + 0.4 * (w - ideal);
        }
        return w;
    },

    grundumsatz: function (w, h, a, sex, formel, anpassung) {
        if (!w || !h || !a) return 0;
        var g = anpassung === 'j' ? Calc.brocaAdjust(w, h) : w;
        if (formel === 'harris') return Math.round(Calc.harrisBenedict(g, h, a, sex));
        if (formel === 'mifflin') return Math.round(Calc.mifflinStJeor(g, h, a, sex));
        return Math.round((Calc.harrisBenedict(g, h, a, sex) + Calc.mifflinStJeor(g, h, a, sex)) / 2);
    },

    bmi: function (w, h) {
        if (!w || !h) return null;
        return w / ((h / 100) * (h / 100));
    },

    bmiInfo: function (bmi) {
        if (bmi === null) return { text: '-', icon: '', cls: '', label: '' };
        var v = bmi.toFixed(1);
        if (bmi < 18.5) return { text: v, icon: '\u25B2', cls: 'bmi-low', label: 'Untergewicht' };
        if (bmi < 25) return { text: v, icon: '\u2713', cls: 'bmi-ok', label: 'Normal' };
        if (bmi < 30) return { text: v, icon: '\u25BC', cls: 'bmi-overweight', label: '\u00dcbergewicht' };
        if (bmi < 35) return { text: v, icon: '\u25BC', cls: 'bmi-obese1', label: 'Adipositas I' };
        return { text: v, icon: '\u25BC', cls: 'bmi-obese2', label: 'Adipositas II' };
    },

    parseZeit: function (zeit) {
        var h = 0;
        zeit = String(zeit).trim();
        if (zeit.indexOf(':') >= 0) {
            h = parseInt(zeit, 10) || 0;
            var rest = zeit.substr(zeit.indexOf(':') + 1);
            if (rest.length > 0) h += parseFloat(rest) / 60;
        } else {
            zeit = zeit.replace(/,/g, '.');
            if (zeit.indexOf('.') >= 0) h = parseFloat(zeit) || 0;
            else h = (parseInt(zeit, 10) || 0) / 60;
        }
        return Math.max(0, Math.min(24, h));
    },

    formatZeit: function (h) {
        h = Math.max(0, Math.min(24, h));
        var stunden = Math.floor(h);
        var minuten = Math.round((h - stunden) * 60);
        if (minuten >= 60) { stunden++; minuten = 0; }
        return stunden + ':' + (minuten < 10 ? '0' : '') + minuten;
    },

    macroProfiles: {
        balanced:       { name: 'Ausgewogen',    protein: 0.30, carbs: 0.40, fat: 0.30 },
        'low-carb':     { name: 'Low-Carb',      protein: 0.35, carbs: 0.20, fat: 0.45 },
        'high-protein': { name: 'High-Protein',   protein: 0.40, carbs: 0.35, fat: 0.25 }
    },

    macros: function (calories, profileKey) {
        var p = Calc.macroProfiles[profileKey] || Calc.macroProfiles.balanced;
        return {
            protein: { g: Math.round((calories * p.protein) / 4), pct: Math.round(p.protein * 100) },
            carbs:   { g: Math.round((calories * p.carbs) / 4),   pct: Math.round(p.carbs * 100) },
            fat:     { g: Math.round((calories * p.fat) / 9),     pct: Math.round(p.fat * 100) }
        };
    }
};
