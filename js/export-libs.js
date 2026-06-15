// Lazy loaders for heavy export libraries (jsPDF / html2canvas).
// Loaded on demand so they are NOT fetched at app startup.
'use strict';

const _loaded = {};

function loadScriptOnce(url) {
    if (_loaded[url]) return _loaded[url];
    _loaded[url] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url; s.async = true;
        s.onload = resolve;
        s.onerror = () => reject(new Error('Script load failed: ' + url));
        document.head.appendChild(s);
    });
    return _loaded[url];
}

export function loadJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
    return loadScriptOnce('https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js');
}

export function loadHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve();
    return loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
}
