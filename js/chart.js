// Weight chart - Canvas drawing (imperative, called from Alpine)
'use strict';

var WeightChart = {
    draw: function (canvasId, history) {
        var canvas = document.getElementById(canvasId);
        if (!canvas || !canvas.getContext) return;
        var ctx = canvas.getContext('2d');
        var dpr = window.devicePixelRatio || 1;
        var rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = 300 * dpr;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = '300px';
        ctx.scale(dpr, dpr);
        var w = rect.width, h = 300;
        var pad = { top: 30, right: 30, bottom: 50, left: 60 };

        ctx.clearRect(0, 0, w, h);

        if (!history || history.length < 1) {
            ctx.fillStyle = '#95a5a6';
            ctx.font = '14px "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Noch keine Daten', w / 2, h / 2);
            return;
        }

        var data = history.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
        var weights = data.map(function (e) { return e.weight; });
        var trend = null;
        if (data.length > 1) {
            var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
            data.forEach(function (e, idx) {
                sumX += idx;
                sumY += e.weight;
                sumXY += idx * e.weight;
                sumX2 += idx * idx;
            });
            var n = data.length;
            var denominator = n * sumX2 - sumX * sumX;
            if (denominator !== 0) {
                var slope = (n * sumXY - sumX * sumY) / denominator;
                var intercept = (sumY - slope * sumX) / n;
                trend = data.map(function (e, idx) { return slope * idx + intercept; });
            }
        }
        var scaleWeights = trend ? weights.concat(trend) : weights;
        var minW = Math.floor(Math.min.apply(null, scaleWeights) - 2);
        var maxW = Math.ceil(Math.max.apply(null, scaleWeights) + 2);
        if (minW === maxW) { minW -= 2; maxW += 2; }
        var chartW = w - pad.left - pad.right;
        var chartH = h - pad.top - pad.bottom;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);

        // Grid
        ctx.strokeStyle = '#f0f0f0';
        ctx.lineWidth = 1;
        for (var i = 0; i <= 5; i++) {
            var y = pad.top + (chartH / 5) * i;
            ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
            ctx.fillStyle = '#7f8c8d';
            ctx.font = '11px "Segoe UI", sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText((maxW - ((maxW - minW) / 5) * i).toFixed(1) + ' kg', pad.left - 8, y + 4);
        }

        function xPos(idx) { return data.length === 1 ? pad.left + chartW / 2 : pad.left + (chartW / (data.length - 1)) * idx; }
        function yPos(wt) { return pad.top + chartH - ((wt - minW) / (maxW - minW)) * chartH; }

        // Area
        if (data.length > 1) {
            ctx.beginPath(); ctx.moveTo(xPos(0), yPos(data[0].weight));
            for (var j = 1; j < data.length; j++) ctx.lineTo(xPos(j), yPos(data[j].weight));
            ctx.lineTo(xPos(data.length - 1), pad.top + chartH);
            ctx.lineTo(xPos(0), pad.top + chartH);
            ctx.closePath();
            var grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
            grad.addColorStop(0, 'rgba(46, 204, 113, 0.3)');
            grad.addColorStop(1, 'rgba(46, 204, 113, 0.02)');
            ctx.fillStyle = grad; ctx.fill();
        }

        // Line
        ctx.strokeStyle = '#27ae60'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
        ctx.beginPath();
        data.forEach(function (e, idx) {
            var x = xPos(idx), yp = yPos(e.weight);
            idx === 0 ? ctx.moveTo(x, yp) : ctx.lineTo(x, yp);
        });
        ctx.stroke();

        // Linear regression trend line
        if (trend) {
            ctx.save();
            ctx.strokeStyle = '#b8c2cc';
            ctx.lineWidth = 2;
            ctx.setLineDash([7, 5]);
            ctx.lineCap = 'round';
            ctx.beginPath();
            trend.forEach(function (wt, idx) {
                var x = xPos(idx), yp = yPos(wt);
                idx === 0 ? ctx.moveTo(x, yp) : ctx.lineTo(x, yp);
            });
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = '#9aa6b2';
            ctx.font = '11px "Segoe UI", sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText('Trend', w - pad.right, pad.top - 10);
            ctx.restore();
        }

        // Points + labels
        data.forEach(function (e, idx) {
            var x = xPos(idx), yp = yPos(e.weight);
            ctx.beginPath(); ctx.arc(x, yp, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#27ae60'; ctx.fill();
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();

            ctx.save(); ctx.translate(x, h - pad.bottom + 12);
            ctx.rotate(-Math.PI / 4);
            ctx.fillStyle = '#7f8c8d'; ctx.font = '10px "Segoe UI", sans-serif';
            ctx.textAlign = 'right';
            var parts = e.date.split('-');
            ctx.fillText(parts[2] + '.' + parts[1] + '.' + parts[0], 0, 0);
            ctx.restore();

            ctx.fillStyle = '#2c3e50'; ctx.font = 'bold 11px "Segoe UI", sans-serif';
            ctx.textAlign = 'center'; ctx.fillText(e.weight.toFixed(1), x, yp - 12);
        });
    },

    drawMacroPie: function (svgId, macros, colors) {
        var svg = document.getElementById(svgId);
        if (!svg) return;
        var cx = 100, cy = 100, r = 80, circ = 2 * Math.PI * r;
        svg.innerHTML = '';

        // Background
        var bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bg.setAttribute('cx', cx); bg.setAttribute('cy', cy); bg.setAttribute('r', r);
        bg.setAttribute('fill', 'none'); bg.setAttribute('stroke', '#f0f0f0'); bg.setAttribute('stroke-width', '30');
        svg.appendChild(bg);

        var segs = [
            { pct: macros.protein.pct, color: colors.protein },
            { pct: macros.carbs.pct, color: colors.carbs },
            { pct: macros.fat.pct, color: colors.fat }
        ];
        var offset = 0;
        segs.forEach(function (s) {
            var len = (s.pct / 100) * circ;
            var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r);
            c.setAttribute('fill', 'none'); c.setAttribute('stroke', s.color); c.setAttribute('stroke-width', '30');
            c.setAttribute('stroke-dasharray', len + ' ' + (circ - len));
            c.setAttribute('stroke-dashoffset', -offset);
            c.setAttribute('transform', 'rotate(-90 ' + cx + ' ' + cy + ')');
            c.style.transition = 'stroke-dasharray 0.6s ease, stroke-dashoffset 0.6s ease';
            svg.appendChild(c);
            offset += len;
        });

        // Center text
        var total = macros.protein.g * 4 + macros.carbs.g * 4 + macros.fat.g * 9;
        var t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', cx); t.setAttribute('y', cy - 5); t.setAttribute('text-anchor', 'middle');
        t.setAttribute('font-size', '18'); t.setAttribute('font-weight', 'bold'); t.setAttribute('fill', '#2c3e50');
        t.textContent = total.toLocaleString('de-DE');
        svg.appendChild(t);
        var u = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        u.setAttribute('x', cx); u.setAttribute('y', cy + 15); u.setAttribute('text-anchor', 'middle');
        u.setAttribute('font-size', '11'); u.setAttribute('fill', '#7f8c8d');
        u.textContent = 'kcal';
        svg.appendChild(u);
    }
};
