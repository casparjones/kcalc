// Diäthelfer - Kalorienbedarf Rechner - Main Script
'use strict';

(function () {
    // Performance: Mark page as interactive
    if (window.performance && window.performance.mark) {
        window.performance.mark('app-init');
    }

    // Smooth scroll polyfill for Safari
    if (!('scrollBehavior' in document.documentElement.style)) {
        document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
            anchor.addEventListener('click', function (e) {
                var targetId = this.getAttribute('href').substring(1);
                var target = document.getElementById(targetId);
                if (target) {
                    e.preventDefault();
                    var top = target.getBoundingClientRect().top + window.pageYOffset;
                    window.scrollTo({ top: top, behavior: 'smooth' });
                }
            });
        });
    }
})();
