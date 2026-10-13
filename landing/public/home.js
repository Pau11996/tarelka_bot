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
})();
