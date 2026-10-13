(() => {
    'use strict';

    const config = document.currentScript?.dataset;
    if (!config || !/^G-[A-Z0-9]+$/.test(config.measurementId)) return;
    const id = config.measurementId;
    const site = new URL(config.siteOrigin);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    const debug = new URLSearchParams(location.search).get('analytics_debug') === '1';
    // Preview traffic must not enter the production stream accidentally.
    if (local ? !debug : location.hostname !== site.hostname) return;
    if (/^\/admin(?:[/.]|$)/.test(location.pathname)) return;

    const consentKey = 'tarelka:analytics-consent:v1';
    const lifetime = 180 * 24 * 60 * 60 * 1000;
    let choice = null;
    try {
        const saved = JSON.parse(localStorage.getItem(consentKey));
        if (saved && ['granted', 'denied'].includes(saved.value)
            && saved.expires > Date.now()) choice = saved.value;
    } catch { /* A storage restriction must not break the website. */ }

    let started = false;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    const gtag = window.gtag;
    gtag('consent', 'default', {
        analytics_storage: 'denied', ad_storage: 'denied',
        ad_user_data: 'denied', ad_personalization: 'denied',
    });

    const pageType = location.pathname === '/' ? 'home'
        : /^\/blog\/[^/]+\/$/.test(location.pathname) ? 'article'
        : location.pathname === '/blog/' ? 'blog' : 'other';

    function safeLocation() {
        const clean = new URL(location.origin + location.pathname);
        const incoming = new URLSearchParams(location.search);
        // Retain campaign attribution; omit arbitrary form/search/query contents.
        for (const name of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id']) {
            const value = incoming.get(name);
            if (value) clean.searchParams.set(name, value.slice(0, 100));
        }
        return clean.href;
    }

    function safeReferrer() {
        try {
            const url = new URL(document.referrer);
            return url.origin + (url.origin === location.origin ? url.pathname : '/');
        } catch { return ''; }
    }

    function start() {
        if (started) return;
        started = true;
        window[`ga-disable-${id}`] = false;
        gtag('consent', 'update', { analytics_storage: 'granted' });
        gtag('set', 'ads_data_redaction', true);
        gtag('js', new Date());
        gtag('config', id, {
            page_location: safeLocation(), page_referrer: safeReferrer(),
            allow_google_signals: false, allow_ad_personalization_signals: false,
            cookie_expires: lifetime / 1000,
            ...(debug ? { debug_mode: true } : {}),
        });
        const tag = document.createElement('script');
        tag.async = true;
        tag.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
        if (debug) {
            tag.addEventListener('load', () => console.info('[analytics] Google tag loaded'));
            tag.addEventListener('error', () => console.warn('[analytics] Google tag could not load'));
        }
        document.head.append(tag);
    }

    function track(name, parameters = {}) {
        if (choice !== 'granted' || !started) return;
        const details = { page_type: pageType, page_path: location.pathname, ...parameters };
        gtag('event', name, { ...details, send_to: id, ...(debug ? { debug_mode: true } : {}) });
        if (debug) console.info('[analytics] Queued ' + name, details);
    }

    function clearCookies() {
        const names = ['_ga', `_ga_${id.slice(2)}`];
        const domains = ['', location.hostname];
        const parts = location.hostname.split('.');
        while (parts.length > 1) { domains.push('.' + parts.join('.')); parts.shift(); }
        for (const name of names) {
            for (const domain of domains) {
                document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${domain ? '; Domain=' + domain : ''}`;
            }
        }
    }

    const notice = document.createElement('section');
    notice.className = 'analytics-consent';
    notice.setAttribute('aria-label', 'Аналитика сайта');
    notice.setAttribute('role', 'region');
    notice.hidden = choice !== null;
    notice.innerHTML = '<h2>Аналитика сайта</h2>'
        + '<p>С вашего согласия Google Analytics поможет понять, какие страницы и функции полезны. '
        + 'Сайт работает и без аналитики. <a href="/privacy.html">Подробнее о данных</a></p>'
        + '<div class="analytics-consent-actions"><button type="button" data-consent="granted">Разрешить</button>'
        + '<button type="button" data-consent="denied">Отклонить</button></div>';
    document.body.append(notice);

    const settings = document.createElement('button');
    settings.type = 'button';
    settings.className = 'analytics-settings';
    settings.textContent = 'Настройки аналитики';
    settings.setAttribute('aria-expanded', String(!notice.hidden));
    (document.querySelector('.lp-footer-bottom') || document.querySelector('.legal-shell') || document.body).append(settings);
    settings.addEventListener('click', () => {
        notice.hidden = false;
        settings.setAttribute('aria-expanded', 'true');
        notice.querySelector('[data-consent="denied"]').focus();
    });

    function choose(value) {
        choice = value;
        try { localStorage.setItem(consentKey, JSON.stringify({ value, expires: Date.now() + lifetime })); }
        catch { /* Respect the choice for this page even without persistent storage. */ }
        notice.hidden = true;
        settings.setAttribute('aria-expanded', 'false');
        settings.focus({ preventScroll: true });
        if (value === 'granted') {
            start();
        } else {
            window[`ga-disable-${id}`] = true;
            clearCookies();
            // Unload automatic listeners as well as our event listeners after revocation.
            if (started) location.reload();
        }
    }
    notice.addEventListener('click', (event) => {
        const button = event.target.closest('[data-consent]');
        if (button) choose(button.dataset.consent);
    });
    window.addEventListener('storage', (event) => {
        if (event.key === consentKey || event.key === null) {
            // Stop this tab too when the choice is withdrawn in another tab.
            window[`ga-disable-${id}`] = true;
            location.reload();
        }
    });
    if (choice === 'granted') start();
    else { window[`ga-disable-${id}`] = true; clearCookies(); }

    function onLink(event) {
        if (event.defaultPrevented || (event.type === 'auxclick' && event.button !== 1)) return;
        const link = event.target.closest('a[href]');
        if (!link) return;
        const url = new URL(link.href, location.href);
        if (url.hostname === 't.me' && url.pathname.toLowerCase() === '/' + config.botUsername.toLowerCase()) {
            const startParam = url.searchParams.get('start') || '';
            const placement = link.closest('header') ? 'header'
                : link.closest('footer') ? 'footer'
                : link.closest('.lp-hero') ? 'hero'
                : link.closest('.article-cta') ? 'article_cta'
                : link.closest('#pricing') ? 'pricing'
                : link.closest('article') ? 'article_body' : 'body';
            track('telegram_click', {
                cta_placement: placement, link_url: url.origin + url.pathname,
                ...( /^[a-z0-9_]{1,40}$/.test(startParam) ? { cta_source: startParam } : {}),
            });
        } else if (url.origin === location.origin && url.pathname === '/downloads/dnevnik-pitaniya.csv') {
            track('diary_template_download', { file_name: 'dnevnik-pitaniya.csv', file_extension: 'csv' });
        }
    }
    document.addEventListener('click', onLink);
    document.addEventListener('auxclick', onLink);
    document.addEventListener('tarelka:recipe-calculated', () => {
        track('calculator_used', { calculator_name: 'recipe_portion' });
    });
})();
