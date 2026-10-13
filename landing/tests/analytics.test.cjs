const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const analytics = fs.readFileSync(path.join(__dirname, '../public/analytics.js'), 'utf8');
const calculator = fs.readFileSync(path.join(__dirname, '../public/recipe-calculator.js'), 'utf8');

class Element {
    constructor() { this.handlers = {}; this.children = []; this.attributes = {}; this.dataset = {}; }
    addEventListener(name, fn) { (this.handlers[name] ||= []).push(fn); }
    dispatchEvent(event) { for (const fn of this.handlers[event.type] || []) fn(event); }
    append(child) { this.children.push(child); }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    focus() {}
    querySelector() { return new Element(); }
}

function page({ url = 'https://tarelkaa.by/', choice, expired = false, blockedStorage = false } = {}) {
    const document = new Element();
    document.head = new Element(); document.body = new Element();
    document.currentScript = { dataset: {
        measurementId: 'G-DBX8MSSJDK', siteOrigin: 'https://tarelkaa.by', botUsername: 'taarelka_bot',
    } };
    document.referrer = 'https://www.google.com/search?q=private+query';
    document.createElement = () => new Element();
    const footer = new Element();
    document.querySelector = () => footer;
    const cookieWrites = [];
    Object.defineProperty(document, 'cookie', { get: () => '', set: value => cookieWrites.push(value) });
    let stored = choice ? JSON.stringify({ value: choice, expires: Date.now() + (expired ? -1000 : 100000) }) : null;
    let reloads = 0;
    const location = new URL(url); location.reload = () => reloads++;
    const window = new Element();
    const context = vm.createContext({
        window, document, location, URL, URLSearchParams, console: { info() {}, warn() {} },
        localStorage: {
            getItem() { if (blockedStorage) throw Error('denied'); return stored; },
            setItem(key, value) { if (blockedStorage) throw Error('denied'); stored = value; },
        },
        CustomEvent: class { constructor(type) { this.type = type; } },
    });
    vm.runInContext(analytics, context);
    const commands = () => (window.dataLayer || []).map(value => Array.from(value));
    return {
        window, document, location, context, commands, cookieWrites,
        configs: () => commands().filter(x => x[0] === 'config'),
        events: () => commands().filter(x => x[0] === 'event'),
        reloads: () => reloads,
        choose(value) {
            document.body.children[0].dispatchEvent({ type: 'click', target: {
                closest: () => ({ dataset: { consent: value } }),
            } });
        },
        click(href, section = '.lp-hero', type = 'click', button = 0) {
            const link = { href, closest: selector => selector === section ? {} : null };
            document.dispatchEvent({ type, button, target: { closest: () => link } });
        },
    };
}

test('no Google script or events before consent, or after refusal; later consent starts once', () => {
    const p = page();
    p.click('https://t.me/taarelka_bot?start=landing_hero');
    assert.equal(p.document.head.children.length, 0);
    assert.equal(p.events().length, 0);
    p.choose('denied');
    assert.equal(p.document.head.children.length, 0);
    p.choose('granted'); p.choose('granted');
    assert.equal(p.document.head.children.length, 1);
    assert.equal(p.configs().length, 1);
    assert.equal(p.events().length, 0, 'past actions must not replay after consent');
    assert.equal(p.configs()[0][1], 'G-DBX8MSSJDK');
    assert.equal(p.configs()[0][2].allow_google_signals, false);
    assert.equal(p.commands()[0][2].ad_user_data, 'denied');
});

test('remembered consent and expiry are respected; blocked storage does not break opt-in', () => {
    assert.equal(page({ choice: 'granted' }).configs().length, 1);
    assert.equal(page({ choice: 'denied' }).configs().length, 0);
    assert.equal(page({ choice: 'granted', expired: true }).configs().length, 0);
    const p = page({ blockedStorage: true });
    p.choose('granted');
    assert.equal(p.configs().length, 1);
});

test('local and unrelated hosts are excluded; explicit loopback debug uses debug_mode', () => {
    for (const url of ['http://127.0.0.1:8080/', 'https://preview.example/', 'https://tarelkaa.by/admin.html']) {
        const p = page({ url, choice: 'granted' });
        assert.equal(p.configs().length, 0, url);
        assert.equal(p.document.body.children.length, 0, url);
    }
    const p = page({ url: 'http://127.0.0.1:8080/?analytics_debug=1', choice: 'granted' });
    assert.equal(p.configs()[0][2].debug_mode, true);
});

test('only the product bot is counted, including middle click; links and source params survive', () => {
    const p = page({ choice: 'granted' });
    p.click('https://t.me/taarelkachat');
    p.click('https://t.me/other_bot?start=landing_hero');
    assert.equal(p.events().length, 0);
    p.click('https://t.me/taarelka_bot?start=landing_hero');
    assert.equal(p.events()[0][1], 'telegram_click');
    assert.equal(p.events()[0][2].cta_placement, 'hero');
    assert.equal(p.events()[0][2].cta_source, 'landing_hero');
    p.click('https://t.me/taarelka_bot?start=blog_recipe', '.article-cta', 'auxclick', 1);
    assert.equal(p.events()[1][2].cta_placement, 'article_cta');
    p.click('https://t.me/taarelka_bot', 'footer', 'auxclick', 2);
    assert.equal(p.events().length, 2, 'right click is not a navigation');
});

test('download clicks record the template without calculator inputs or arbitrary URL data', () => {
    const p = page({ choice: 'granted', url: 'https://tarelkaa.by/?email=private@example.com&utm_source=newsletter#private' });
    p.click('https://tarelkaa.by/downloads/dnevnik-pitaniya.csv');
    assert.equal(p.events()[0][1], 'diary_template_download');
    assert.equal(p.events()[0][2].file_name, 'dnevnik-pitaniya.csv');
    assert.equal(p.configs()[0][2].page_location, 'https://tarelkaa.by/?utm_source=newsletter');
    assert.equal(p.configs()[0][2].page_referrer, 'https://www.google.com/');
    assert.doesNotMatch(JSON.stringify(p.commands()), /private@example|private.query/);
});

test('real calculator handler sends one event on success, none for invalid input', () => {
    const p = page({ choice: 'granted', url: 'https://tarelkaa.by/blog/kalorijnost-gotovogo-blyuda/' });
    const form = new Element();
    const fields = Object.fromEntries(['energy', 'weight', 'portion'].map((name, index) => {
        const field = new Element(); field.valueAsNumber = [1005, 900, 250][index];
        field.validity = { valid: true }; return [name, field];
    }));
    form.elements = { namedItem: name => fields[name] };
    p.document.querySelector = () => form;
    p.document.getElementById = () => new Element();
    vm.runInContext(calculator, p.context);
    form.dispatchEvent({ type: 'submit', preventDefault() {} });
    assert.equal(p.events().length, 1);
    assert.equal(p.events()[0][1], 'calculator_used');
    assert.equal(p.events()[0][2].page_type, 'article');
    assert.doesNotMatch(JSON.stringify(p.events()), /1005|900|250|per100/);
    fields.portion.valueAsNumber = 1000;
    form.dispatchEvent({ type: 'submit', preventDefault() {} });
    assert.equal(p.events().length, 1);
});

test('withdrawal disables collection, removes this stream cookies and reloads; other tabs stop too', () => {
    const p = page({ choice: 'granted' });
    p.choose('denied');
    p.click('https://t.me/taarelka_bot');
    assert.equal(p.events().length, 0);
    assert.equal(p.window['ga-disable-G-DBX8MSSJDK'], true);
    assert.equal(p.reloads(), 1);
    assert.ok(p.cookieWrites.some(x => x.includes('_ga_DBX8MSSJDK=; Max-Age=0')));
    const other = page({ choice: 'granted' });
    other.window.dispatchEvent({ type: 'storage', key: 'tarelka:analytics-consent:v1' });
    assert.equal(other.window['ga-disable-G-DBX8MSSJDK'], true);
    assert.equal(other.reloads(), 1);
});
