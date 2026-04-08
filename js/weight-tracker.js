// Diäthelfer - Weight Tracker Module (CRUD + Chart)
'use strict';

(function () {
    var weightHistory = [];
    var editingId = null;

    function toast(msg, type) {
        if (window.Storage && window.Storage.toast) {
            window.Storage.toast(msg, type);
        }
    }

    // ===== CRUD =====

    function addWeight(date, weight) {
        var entry = {
            date: date,
            weight: parseFloat(weight),
            id: Date.now()
        };
        // Prüfen ob Datum schon existiert
        var existing = weightHistory.find(function (e) { return e.date === date; });
        if (existing) {
            existing.weight = entry.weight;
            toast('Gewicht für ' + formatDate(date) + ' aktualisiert', 'info');
        } else {
            weightHistory.push(entry);
            toast('Gewicht hinzugefügt: ' + weight + ' kg am ' + formatDate(date), 'success');
        }
        sortHistory();
        persist();
        render();
    }

    function updateWeight(id, newWeight) {
        var entry = weightHistory.find(function (e) { return e.id === id; });
        if (entry) {
            entry.weight = parseFloat(newWeight);
            toast('Gewicht aktualisiert auf ' + newWeight + ' kg', 'info');
            persist();
            render();
        }
    }

    function updateDate(id, newDate) {
        var entry = weightHistory.find(function (e) { return e.id === id; });
        if (entry) {
            entry.date = newDate;
            toast('Datum geändert auf ' + formatDate(newDate), 'info');
            sortHistory();
            persist();
            render();
        }
    }

    function deleteWeight(id) {
        var entry = weightHistory.find(function (e) { return e.id === id; });
        if (!entry) return;
        weightHistory = weightHistory.filter(function (e) { return e.id !== id; });
        toast('Eintrag vom ' + formatDate(entry.date) + ' gelöscht', 'error');
        persist();
        render();
    }

    function sortHistory() {
        weightHistory.sort(function (a, b) {
            return a.date.localeCompare(b.date);
        });
    }

    function persist() {
        var data = window.Storage.load() || {};
        data.weightHistory = weightHistory;
        window.Storage.save(data);
    }

    // ===== Formatierung =====

    function formatDate(dateStr) {
        var parts = dateStr.split('-');
        return parts[2] + '.' + parts[1] + '.' + parts[0];
    }

    function todayStr() {
        return new Date().toISOString().split('T')[0];
    }

    // ===== Tabelle rendern =====

    function renderList() {
        var tbody = document.getElementById('weightListBody');
        if (!tbody) return;

        var startWeight = weightHistory.length > 0 ? weightHistory[0].weight : 0;

        // Eingabezeile oben
        var html = '<tr class="weight-row weight-row--add">' +
            '<td><input type="date" id="weightDate" class="inline-input" value="' + todayStr() + '"></td>' +
            '<td><input type="number" id="weightValue" class="inline-input" min="1" max="400" step="0.1" placeholder="kg"></td>' +
            '<td colspan="2"><button class="btn-add-new" id="addWeightBtn" disabled>+ Neu</button></td>' +
            '</tr>';

        // Daten-Zeilen absteigend (neueste oben)
        for (var i = weightHistory.length - 1; i >= 0; i--) {
            var entry = weightHistory[i];
            var diff = entry.weight - startWeight;
            var diffStr = (diff >= 0 ? '+' : '') + diff.toFixed(1);
            var diffClass = diff < 0 ? 'diff-negative' : diff > 0 ? 'diff-positive' : 'diff-neutral';

            if (editingId === entry.id) {
                html += '<tr class="weight-row weight-row--editing">' +
                    '<td><input type="date" class="edit-date inline-input" value="' + entry.date + '" data-id="' + entry.id + '"></td>' +
                    '<td><input type="number" class="edit-weight inline-input" value="' + entry.weight + '" step="0.1" min="1" max="400" data-id="' + entry.id + '"></td>' +
                    '<td colspan="2" class="edit-actions-cell">' +
                        '<button class="btn-icon btn-delete-edit" data-id="' + entry.id + '" title="Löschen">&#128465;</button>' +
                        '<button class="btn-icon btn-cancel-edit" title="Abbrechen">&#10007;</button>' +
                        '<button class="btn-icon btn-save-edit" data-id="' + entry.id + '" title="Speichern">&#10003;</button>' +
                    '</td></tr>';
            } else {
                html += '<tr class="weight-row" data-id="' + entry.id + '">' +
                    '<td>' + formatDate(entry.date) + '</td>' +
                    '<td class="weight-clickable" data-id="' + entry.id + '"><strong>' + entry.weight.toFixed(1) + '</strong></td>' +
                    '<td class="' + diffClass + '">' + (i === 0 ? 'Start' : diffStr) + '</td>' +
                    '<td></td>' +
                    '</tr>';
            }
        }

        tbody.innerHTML = html;
        bindListEvents(tbody);
    }

    function bindListEvents(tbody) {
        // "Neu"-Button: aktivieren wenn Gewicht eingegeben
        var addBtn = document.getElementById('addWeightBtn');
        var weightInput = document.getElementById('weightValue');
        var dateInput = document.getElementById('weightDate');

        function checkAddEnabled() {
            if (addBtn && weightInput) {
                var v = parseFloat(weightInput.value);
                addBtn.disabled = !(v > 0);
            }
        }

        if (weightInput) {
            weightInput.addEventListener('input', checkAddEnabled);
            weightInput.addEventListener('change', checkAddEnabled);
        }

        if (addBtn) {
            addBtn.addEventListener('click', function () {
                var date = dateInput ? dateInput.value : '';
                var weight = weightInput ? weightInput.value : '';
                if (!date) { toast('Bitte Datum eingeben', 'warn'); return; }
                if (!weight || parseFloat(weight) <= 0) { toast('Bitte gültiges Gewicht eingeben', 'warn'); return; }
                addWeight(date, weight);
            });
        }

        // Klick auf kg-Wert -> Edit-Modus
        tbody.querySelectorAll('.weight-clickable').forEach(function (td) {
            td.addEventListener('click', function () {
                editingId = parseInt(td.getAttribute('data-id'), 10);
                renderList();
            });
        });

        // Save edit
        tbody.querySelectorAll('.btn-save-edit').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = parseInt(btn.getAttribute('data-id'), 10);
                var dateEl = tbody.querySelector('.edit-date[data-id="' + id + '"]');
                var weightEl = tbody.querySelector('.edit-weight[data-id="' + id + '"]');
                if (dateEl && weightEl) {
                    var entry = weightHistory.find(function (e) { return e.id === id; });
                    if (entry) {
                        entry.date = dateEl.value;
                        entry.weight = parseFloat(weightEl.value);
                        sortHistory();
                        persist();
                        toast('Aktualisiert', 'success');
                    }
                }
                editingId = null;
                render();
            });
        });

        // Delete from edit form
        tbody.querySelectorAll('.btn-delete-edit').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = parseInt(btn.getAttribute('data-id'), 10);
                var entry = weightHistory.find(function (e) { return e.id === id; });
                var msg = entry
                    ? formatDate(entry.date) + ' (' + entry.weight.toFixed(1) + ' kg) löschen?'
                    : 'Eintrag löschen?';
                if (window.Storage && window.Storage.confirmToast) {
                    window.Storage.confirmToast(msg, function () { deleteWeight(id); });
                } else { deleteWeight(id); }
            });
        });

        // Cancel edit
        tbody.querySelectorAll('.btn-cancel-edit').forEach(function (btn) {
            btn.addEventListener('click', function () {
                editingId = null;
                renderList();
            });
        });
    }

    // ===== Chart zeichnen =====

    function drawChart() {
        var canvas = document.getElementById('weightChart');
        if (!canvas || !canvas.getContext) return;
        var ctx = canvas.getContext('2d');

        // High-DPI
        var dpr = window.devicePixelRatio || 1;
        var rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = 300 * dpr;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = '300px';
        ctx.scale(dpr, dpr);

        var w = rect.width;
        var h = 300;
        var pad = { top: 30, right: 30, bottom: 50, left: 60 };

        // Clear
        ctx.clearRect(0, 0, w, h);

        if (weightHistory.length < 1) {
            ctx.fillStyle = '#95a5a6';
            ctx.font = '14px "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Noch keine Daten für den Verlauf', w / 2, h / 2);
            return;
        }

        var data = weightHistory.slice();
        var weights = data.map(function (e) { return e.weight; });
        var minW = Math.floor(Math.min.apply(null, weights) - 2);
        var maxW = Math.ceil(Math.max.apply(null, weights) + 2);
        if (minW === maxW) { minW -= 2; maxW += 2; }

        var chartW = w - pad.left - pad.right;
        var chartH = h - pad.top - pad.bottom;

        // Hintergrund
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);

        // Grid
        ctx.strokeStyle = '#f0f0f0';
        ctx.lineWidth = 1;
        var gridSteps = 5;
        for (var i = 0; i <= gridSteps; i++) {
            var y = pad.top + (chartH / gridSteps) * i;
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(w - pad.right, y);
            ctx.stroke();

            // Y-Labels
            var val = maxW - ((maxW - minW) / gridSteps) * i;
            ctx.fillStyle = '#7f8c8d';
            ctx.font = '11px "Segoe UI", sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(val.toFixed(1) + ' kg', pad.left - 8, y + 4);
        }

        // X scale
        function xPos(idx) {
            if (data.length === 1) return pad.left + chartW / 2;
            return pad.left + (chartW / (data.length - 1)) * idx;
        }
        function yPos(weight) {
            return pad.top + chartH - ((weight - minW) / (maxW - minW)) * chartH;
        }

        // Fläche unter der Linie
        if (data.length > 1) {
            ctx.beginPath();
            ctx.moveTo(xPos(0), yPos(data[0].weight));
            for (var j = 1; j < data.length; j++) {
                ctx.lineTo(xPos(j), yPos(data[j].weight));
            }
            ctx.lineTo(xPos(data.length - 1), pad.top + chartH);
            ctx.lineTo(xPos(0), pad.top + chartH);
            ctx.closePath();
            var gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
            gradient.addColorStop(0, 'rgba(46, 204, 113, 0.3)');
            gradient.addColorStop(1, 'rgba(46, 204, 113, 0.02)');
            ctx.fillStyle = gradient;
            ctx.fill();
        }

        // Linie
        ctx.strokeStyle = '#27ae60';
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        data.forEach(function (entry, idx) {
            var x = xPos(idx);
            var yp = yPos(entry.weight);
            if (idx === 0) ctx.moveTo(x, yp);
            else ctx.lineTo(x, yp);
        });
        ctx.stroke();

        // Punkte + X-Labels
        data.forEach(function (entry, idx) {
            var x = xPos(idx);
            var yp = yPos(entry.weight);

            // Punkt
            ctx.beginPath();
            ctx.arc(x, yp, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#27ae60';
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();

            // X-Label (Datum)
            ctx.save();
            ctx.translate(x, h - pad.bottom + 12);
            ctx.rotate(-Math.PI / 4);
            ctx.fillStyle = '#7f8c8d';
            ctx.font = '10px "Segoe UI", sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(formatDate(entry.date), 0, 0);
            ctx.restore();

            // Wert über Punkt
            ctx.fillStyle = '#2c3e50';
            ctx.font = 'bold 11px "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(entry.weight.toFixed(1), x, yp - 12);
        });
    }

    // ===== Gesamtes Rendering =====

    function render() {
        renderList();
        drawChart();
    }

    // ===== Initialisierung =====

    function init() {
        var section = document.getElementById('weight-tracker');

        // Auf gespeicherte Daten reagieren
        document.addEventListener('dataSaved', function (e) {
            var data = e.detail;
            if (data && data.weightHistory) {
                weightHistory = data.weightHistory;
                sortHistory();
            }
            if (section) section.classList.remove('hidden');
            render();
        });

        // Chart bei Resize neu zeichnen
        var resizeTimer;
        window.addEventListener('resize', function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(drawChart, 200);
        });
    }

    window.WeightTracker = { init: init };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
