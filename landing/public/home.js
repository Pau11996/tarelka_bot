(() => {
    'use strict';

    const menuButton = document.querySelector('.lp-menu-toggle');
    const navigation = document.querySelector('.lp-nav');
    const setMenuOpen = (open) => {
        menuButton.setAttribute('aria-expanded', String(open));
        menuButton.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
        navigation.classList.toggle('is-open', open);
    };

    if (menuButton && navigation) {
        menuButton.addEventListener('click', () => {
            setMenuOpen(menuButton.getAttribute('aria-expanded') !== 'true');
        });
        navigation.addEventListener('click', (event) => {
            if (event.target.closest('a')) setMenuOpen(false);
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
                setMenuOpen(false);
                menuButton.focus();
            }
        });
        document.addEventListener('click', (event) => {
            if (!event.target.closest('.lp-header')) setMenuOpen(false);
        });
        window.matchMedia('(min-width: 761px)').addEventListener('change', (event) => {
            if (event.matches) setMenuOpen(false);
        });
    }

    const featureButtons = document.querySelectorAll('[data-feature]');
    const featurePanels = document.querySelectorAll('[data-panel]');
    featureButtons.forEach((button) => {
        button.addEventListener('click', () => {
            featureButtons.forEach((item) => {
                const active = item === button;
                item.classList.toggle('is-active', active);
                item.setAttribute('aria-pressed', String(active));
            });
            featurePanels.forEach((panel) => {
                panel.hidden = panel.dataset.panel !== button.dataset.feature;
            });
        });
    });

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let smoothScroll = null;
    let revealObserver = null;
    const pendingReveals = new Set();

    const reveal = (element) => {
        element.classList.remove('lp-reveal-pending');
        pendingReveals.delete(element);
        revealObserver?.unobserve(element);
    };

    const updateMotion = () => {
        if (reducedMotion.matches) {
            smoothScroll?.destroy();
            smoothScroll = null;
            pendingReveals.forEach(reveal);
            revealObserver?.disconnect();
            revealObserver = null;
            return;
        }

        if (!smoothScroll && typeof window.Lenis === 'function') {
            smoothScroll = new window.Lenis({
                autoRaf: true,
                lerp: 0.12,
                smoothWheel: true,
                syncTouch: false,
                anchors: true,
                // Leave the horizontal phone gallery to the browser.
                prevent: (node) => node.classList.contains('lp-phone-viewport'),
            });
        }

        if (revealObserver || !('IntersectionObserver' in window)) return;
        revealObserver = new window.IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) reveal(entry.target);
            });
        }, { rootMargin: '0px 0px -24px 0px', threshold: 0 });

        const revealTargets = document.querySelectorAll([
            '.lp-section-heading', '.lp-steps > article', '.lp-feature-layout',
            '.lp-workouts-copy', '.lp-course-card', '.lp-diary-copy', '.lp-weight-preview',
            '.lp-benefit-grid > article', '.lp-price-card', '.journal-card',
            '.lp-faq-heading', '.lp-faq-list', '.lp-final > .lp-container',
        ].join(', '));
        revealTargets.forEach((element) => {
            // Never hide content already on screen or animate a block twice.
            if (element.classList.contains('lp-reveal') || element.getBoundingClientRect().top < window.innerHeight) return;
            revealObserver.observe(element);
            pendingReveals.add(element);
            element.classList.add('lp-reveal', 'lp-reveal-pending');
        });
    };

    document.addEventListener('focusin', (event) => {
        const element = event.target.closest('.lp-reveal-pending');
        if (element) reveal(element);
    });
    reducedMotion.addEventListener('change', updateMotion);
    updateMotion();
})();
