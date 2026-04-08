// Diäthelfer - Main Script
'use strict';

(function () {
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

    // ===== Fade-In on Scroll =====
    if ('IntersectionObserver' in window) {
        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                }
            });
        }, { threshold: 0.05 });

        document.querySelectorAll('.section').forEach(function (sec) {
            observer.observe(sec);
        });

        // Auch dynamisch sichtbar gemachte Sections beobachten
        var mo = new MutationObserver(function () {
            document.querySelectorAll('.section:not(.hidden):not(.visible)').forEach(function (sec) {
                observer.observe(sec);
                // Sofort sichtbar wenn schon im Viewport
                var rect = sec.getBoundingClientRect();
                if (rect.top < window.innerHeight) {
                    sec.classList.add('visible');
                }
            });
        });
        mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    } else {
        // Fallback: alles sofort sichtbar
        document.querySelectorAll('.section').forEach(function (s) { s.classList.add('visible'); });
    }

    // ===== Footer einblenden nach Content-Load =====
    setTimeout(function () {
        var footer = document.querySelector('.site-footer');
        if (footer) footer.classList.add('visible');
    }, 400);

    // ===== Burger Menu =====
    var burgerBtn = document.getElementById('burgerBtn');
    var mobileNav = document.getElementById('mobileNav');
    var mobileNavClose = document.getElementById('mobileNavClose');
    var mobileNavBackdrop = document.getElementById('mobileNavBackdrop');

    function openMobileNav() {
        if (mobileNav) mobileNav.classList.add('open');
    }

    function closeMobileNav() {
        if (mobileNav) mobileNav.classList.remove('open');
    }

    if (burgerBtn) burgerBtn.addEventListener('click', openMobileNav);
    if (mobileNavClose) mobileNavClose.addEventListener('click', closeMobileNav);
    if (mobileNavBackdrop) mobileNavBackdrop.addEventListener('click', closeMobileNav);

    // Close on link click
    if (mobileNav) {
        mobileNav.addEventListener('click', function (e) {
            if (e.target.tagName === 'A') closeMobileNav();
        });
    }
})();
