const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/home.js'), 'utf8');

function block(top) {
    const classes = new Set();
    return {
        classList: {
            add: (...names) => names.forEach(name => classes.add(name)),
            remove: name => classes.delete(name),
            contains: name => classes.has(name),
        },
        getBoundingClientRect: () => ({ top }),
    };
}

function page({ reduced = false, lenis = true, observer = true } = {}) {
    const handlers = {};
    const preference = {
        matches: reduced,
        addEventListener(type, handler) { this.onChange = handler; },
    };
    const blocks = [block(-200), block(400), block(1100), block(1500)];
    const instances = [];
    const observers = [];
    const window = { innerHeight: 800, matchMedia: () => preference };
    if (lenis) window.Lenis = class {
        constructor(options) { this.options = options; this.destroyed = false; instances.push(this); }
        destroy() { this.destroyed = true; }
    };
    if (observer) window.IntersectionObserver = class {
        constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
        observe(element) { this.targets.add(element); }
        unobserve(element) { this.targets.delete(element); }
        disconnect() { this.targets.clear(); this.disconnected = true; }
    };
    vm.runInNewContext(source, {
        window,
        document: {
            querySelector: () => null,
            querySelectorAll: selector => selector.startsWith('[data-') ? [] : blocks,
            addEventListener: (type, handler) => { handlers[type] = handler; },
        },
    });
    return {
        blocks, instances, observers, handlers,
        changeMotion(matches) { preference.matches = matches; preference.onChange(); },
    };
}

const isPending = element => element.classList.contains('lp-reveal-pending');

test('wheel smoothing preserves native touch and the horizontal phone gallery', () => {
    const p = page();
    const options = p.instances[0].options;
    assert.equal(options.syncTouch, false);
    assert.equal(options.anchors, true);
    const gallery = block(0);
    gallery.classList.add('lp-phone-viewport');
    assert.equal(options.prevent(gallery), true);
    assert.equal(options.prevent(block(0)), false);
    p.changeMotion(false);
    assert.equal(p.instances.length, 1, 'preference events must not duplicate scroll engines');
});

test('content above the fold stays visible; below-fold blocks reveal once on entry', () => {
    const p = page();
    assert.deepEqual(p.blocks.map(isPending), [false, false, true, true]);
    const observer = p.observers[0];
    const target = p.blocks[2];
    observer.callback([{ target, isIntersecting: false }]);
    assert.equal(isPending(target), true);
    observer.callback([{ target, isIntersecting: true }]);
    assert.equal(isPending(target), false);
    assert.equal(observer.targets.has(target), false);
});

test('reduced motion removes inertia and reveals all content, including live preference changes', () => {
    const p = page({ reduced: true });
    assert.equal(p.instances.length, 0);
    assert.equal(p.observers.length, 0);
    assert.ok(p.blocks.every(element => !isPending(element)));
    p.changeMotion(false);
    assert.equal(p.instances.length, 1);
    assert.equal(isPending(p.blocks[2]), true);
    p.changeMotion(true);
    assert.equal(p.instances[0].destroyed, true);
    assert.equal(p.observers[0].disconnected, true);
    assert.ok(p.blocks.every(element => !isPending(element)));
    p.changeMotion(false);
    assert.equal(p.instances.length, 2);
    assert.ok(p.blocks.every(element => !isPending(element)), 'revealed content must not disappear again');
});

test('keyboard focus reveals its block immediately and fallback stays readable', () => {
    const p = page();
    const target = p.blocks[2];
    p.handlers.focusin({ target: { closest: () => target } });
    assert.equal(isPending(target), false);
    assert.equal(p.observers[0].targets.has(target), false);
    const fallback = page({ lenis: false, observer: false });
    assert.equal(fallback.instances.length, 0);
    assert.ok(fallback.blocks.every(element => !isPending(element)));
});
