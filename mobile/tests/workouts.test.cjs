const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('typescript');
const clone = value => JSON.parse(JSON.stringify(value));
const modules = new Map();
function load(file) {
  const full = path.resolve(__dirname, '../src/workouts', file);
  if (modules.has(full)) return modules.get(full);
  const context = { exports: {}, Date, Intl, Set, Map, JSON, Math, Object, Number, Promise, Error, AbortController, performance,
    require(name) { if (!name.startsWith('.')) throw Error(`Unexpected dependency ${name}`); return load(path.relative(path.resolve(__dirname, '../src/workouts'), path.resolve(path.dirname(full), name + '.ts'))); } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  modules.set(full, context.exports); return context.exports;
}
const engine = load('engine.ts');
const { WorkoutStore, supportedCatalogue } = load('store.ts');
const catalogue = { version: 1, exercises: [{ id: 'march', animation: 'march' }, { id: 'squat', animation: 'squat' }], workouts: [{ id: 'test', title: 'Test', steps: [
  { id: '1', exercise_id: 'march', duration_seconds: 10, repetitions: null, expected_seconds: 10, rest_seconds: 5 },
  { id: '2', exercise_id: 'squat', duration_seconds: null, repetitions: 3, expected_seconds: 12, rest_seconds: 0 },
] }] };
const wall = ms => new Date(Date.parse('2026-10-30T10:00:00Z') + ms).toISOString();
const draft = () => engine.createDraft('id', catalogue.workouts[0], catalogue, { auto_log: false, sound: true }, 'Europe/Minsk', 0, wall(0));

test('timer finishes only the current phase, counts rest separately and requires rep confirmation', () => {
  let d = engine.tick(draft(), 20000, wall(20000));
  assert.equal(d.phase, 'rest'); assert.equal(d.index, 0); assert.equal(d.results[0].active_seconds, 10);
  d = engine.tick(d, 25000, wall(25000));
  assert.equal(d.phase, 'exercise'); assert.equal(d.index, 1); assert.equal(d.results[0].rest_seconds, 5);
  d = engine.tick(d, 30000, wall(30000));
  assert.equal(d.phase, 'exercise'); assert.equal(d.results[1].completed, false);
  d = engine.act(d, 'complete_reps', 30000, wall(30000));
  assert.equal(d.phase, 'finished'); assert.equal(d.status, 'completed');
  const payload = engine.sessionInput(d);
  assert.equal(payload.steps.reduce((sum, s) => sum + s.active_seconds, 0), 15);
  assert.equal(payload.steps.reduce((sum, s) => sum + s.rest_seconds, 0), 5);
});

test('pause, process restart and resume never count time spent outside the workout', () => {
  let d = engine.act(draft(), 'pause', 3000, wall(3000));
  d = engine.tick(d, 500000, wall(500000));
  assert.equal(d.results[0].active_seconds, 3);
  d = engine.restoreDraft(d, 2);
  assert.equal(d.paused, true);
  d = engine.act(d, 'resume', 10, wall(500000));
  d = engine.tick(d, 1010, wall(501000));
  assert.equal(d.results[0].active_seconds, 4);
});

test('extra rest and skip do not add exercise calories or falsely complete skipped steps', () => {
  let d = engine.tick(draft(), 10000, wall(10000));
  d = engine.act(d, 'more_rest', 11000, wall(11000));
  assert.equal(d.rest_target, 20); assert.equal(d.results[0].rest_seconds, 1);
  d = engine.act(d, 'skip', 15000, wall(15000));
  assert.equal(d.index, 1); assert.equal(d.results[0].active_seconds, 10); assert.equal(d.results[0].rest_seconds, 5);
  d = engine.act(d, 'skip', 17000, wall(17000));
  assert.equal(d.results[1].completed, false); assert.equal(d.results[1].active_seconds, 2);
});

test('skipping every exercise produces interrupted result and a timer/tap race cannot skip the next step', () => {
  let d = engine.act(draft(), 'skip', 0, wall(0));
  d = engine.act(d, 'skip', 0, wall(0));
  d = engine.act(d, 'skip', 0, wall(0));
  assert.equal(d.status, 'interrupted');
  const boundary = engine.act(draft(), 'skip', 10000, wall(10000));
  assert.equal(boundary.phase, 'rest'); assert.equal(boundary.results[0].completed, true);
});

test('repetition time has a cap and stopping a partial step preserves actual seconds', () => {
  let d = engine.act(engine.tick(draft(), 10000, wall(10000)), 'skip', 10000, wall(10000));
  d = engine.tick(d, 1000000, wall(1000000));
  assert.equal(d.paused, true); assert.equal(d.results[1].active_seconds, 48); assert.equal(d.results[1].completed, false);
  d = engine.act(d, 'stop', 1000001, wall(1000001));
  assert.equal(engine.sessionInput(d).status, 'interrupted');
});

test('namespace survives renewed tokens but separates accounts and revoked sessions', () => {
  const token = body => 'header.' + Buffer.from(JSON.stringify(body)).toString('base64url') + '.signature';
  assert.equal(engine.workoutAccount(token({ sub: '7', ver: 0, iat: 1 })), engine.workoutAccount(token({ sub: '7', ver: 0, iat: 2 })));
  assert.notEqual(engine.workoutAccount(token({ sub: '7', ver: 0 })), engine.workoutAccount(token({ sub: '8', ver: 0 })));
  assert.notEqual(engine.workoutAccount(token({ sub: '7', ver: 0 })), engine.workoutAccount(token({ sub: '7', ver: 1 })));
  assert.throws(() => engine.workoutAccount('invalid'));
});

test('offline result date uses the account timezone across midnight and DST', () => {
  assert.equal(engine.sessionDate('2026-10-30T22:15:00Z', 'Europe/Minsk'), '2026-10-31');
  assert.equal(engine.sessionDate('2026-03-28T23:50:00Z', 'Europe/Berlin'), '2026-03-29');
});

function fixture() {
  let ms = 0, serial = 0, saved = { catalogue, settings: { auto_log: false, sound: true }, settings_dirty: false, timezone: 'Europe/Minsk', draft: null, records: [] };
  const remote = new Map(), requests = [];
  const config = { offline: false, loseAck: false, diskFull: false, serverSettings: { auto_log: false, sound: true } };
  const deps = {
    read: async () => clone(saved),
    write: async value => { if (config.diskFull) throw Error('disk full'); saved = clone(value); },
    remove: async () => { saved = null; }, uuid: () => `id-${++serial}`, now: () => ms, wall: () => wall(ms), updated() {},
    async request(url, options) {
      requests.push([url, clone({ ...options, signal: undefined })]);
      if (config.offline) throw Object.assign(Error('offline'), { status: 0 });
      if (url === '/v1/workouts/catalogue') return clone(catalogue);
      if (url === '/v1/me') return { timezone: 'Europe/Minsk' };
      if (url === '/v1/settings/workouts') { if (options.method === 'PUT') config.serverSettings = options.json; return clone(config.serverSettings); }
      if (url.startsWith('/v1/workouts/history')) return { items: [...remote.values()], next_offset: null };
      if (options.method === 'PUT') {
        const id = url.split('/').at(-1), p = options.json;
        if (!remote.has(id)) remote.set(id, { ...clone(p), id, title: 'Test', local_date: p.started_at.slice(0,10), active_seconds: p.steps.reduce((sum,s) => sum + s.active_seconds,0), calories: 3, completed_steps: p.steps.filter(s => s.completed).length, diary_added: p.auto_log && p.status === 'completed', diary_entry_id: p.auto_log && p.status === 'completed' ? 1 : null });
        if (config.loseAck) { config.loseAck = false; throw Object.assign(Error('ack lost'), { status: 0 }); }
        return clone(remote.get(id));
      }
      if (options.method === 'POST') { const id = url.split('/').at(-2); const row = remote.get(id); row.diary_added = true; row.diary_entry_id = 12; return clone(row); }
      throw Error(`Unexpected ${url}`);
    },
  };
  return { deps, config, remote, requests, get saved() { return saved; }, advance(value) { ms += value; } };
}
async function initialize(f) { const store = new WorkoutStore(f.deps); await store.initialize(); await store.refresh(); return store; }
async function complete(store, f) { await store.start('test'); f.advance(10000); store.tick(); await store.action('skip'); f.advance(12000); await store.action('complete_reps'); await store.refresh(); }

test('offline completion is durable and a restarted store safely retries a lost response', async () => {
  const f = fixture(); f.config.offline = true;
  const store = await initialize(f);
  await complete(store, f);
  assert.equal(f.saved.records.length, 1); assert.equal(f.saved.draft, null); assert.equal(f.saved.records[0].server, undefined);
  const original = clone(f.saved.records[0].payload);
  await store.close(); f.config.offline = false; f.config.loseAck = true;
  const retry = await initialize(f);
  assert.equal(f.remote.size, 1); assert.equal(f.saved.records[0].server, undefined);
  await retry.refresh();
  assert.equal(f.remote.size, 1); assert.ok(f.saved.records[0].server);
  assert.deepEqual(f.saved.records[0].payload, original);
  await retry.close();
});

test('draft restores paused with settings frozen at its start; subsequent settings affect the next workout', async () => {
  const f = fixture(), store = await initialize(f);
  await store.start('test'); f.advance(2000); store.tick();
  await store.setSettings({ auto_log: true, sound: false }); await store.refresh();
  assert.equal(store.getSnapshot().draft.auto_log, false);
  await store.close(); f.advance(60000);
  const restored = await initialize(f);
  assert.equal(restored.getSnapshot().draft.paused, true); assert.equal(restored.getSnapshot().draft.results[0].active_seconds, 2);
  await restored.action('stop'); await restored.refresh();
  await restored.start('test'); assert.equal(restored.getSnapshot().draft.auto_log, true);
  await restored.close();
});

test('disk errors pause the player and cannot silently start or discard a workout', async () => {
  const f = fixture(), store = await initialize(f); f.config.diskFull = true;
  await assert.rejects(store.start('test'));
  assert.equal(store.getSnapshot().draft.paused, true);
  assert.equal(store.getSnapshot().storage_error, true);
  await assert.rejects(store.action('resume'));
  f.config.diskFull = false;
  await store.action('resume'); f.advance(1000); store.tick();
  assert.equal(store.getSnapshot().storage_error, false);
  assert.equal(store.getSnapshot().draft.results[0].active_seconds, 1);
  await store.close();
});

test('a diary request made during a history refresh is uploaded before refresh finishes', async () => {
  const f = fixture(), store = await initialize(f); await complete(store, f);
  let release; const request = f.deps.request;
  f.deps.request = async (url, options) => {
    if (url === '/v1/me') { f.deps.request = request; await new Promise(resolve => { release = resolve; }); }
    return request(url, options);
  };
  const pending = store.refresh();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const adding = store.addToDiary(store.getSnapshot().records[0].id);
  // Let the durable mutation queue its follow-up upload pass.
  await new Promise(resolve => setImmediate(resolve));
  release(); await Promise.all([pending, adding]);
  assert.equal(f.saved.records[0].diary_requested, false);
  assert.equal(f.saved.records[0].server.diary_entry_id, 12);
  await store.close();
});

test('failure writing the final result keeps it in memory and exposes an unsaved status until retry', async () => {
  const f = fixture(), store = await initialize(f);
  await store.start('test'); f.advance(2000); f.config.diskFull = true;
  await assert.rejects(store.action('stop'));
  assert.equal(store.getSnapshot().records.length, 1);
  assert.equal(store.getSnapshot().storage_error, true);
  assert.equal(f.saved.records.length, 0);
  f.config.diskFull = false; await store.retry();
  assert.equal(store.getSnapshot().storage_error, false);
  assert.equal(f.saved.records.length, 1);
  assert.ok(f.saved.records[0].server);
  await store.close();
});

test('manual diary request survives offline restart and does not resend an acknowledged session', async () => {
  const f = fixture(), store = await initialize(f); await complete(store, f);
  const id = store.getSnapshot().records[0].id;
  const before = f.requests.filter(([,o]) => o.method === 'PUT').length;
  f.config.offline = true; await store.addToDiary(id); await store.close();
  assert.equal(f.saved.records[0].diary_requested, true);
  f.config.offline = false; const restored = await initialize(f);
  assert.equal(f.saved.records[0].server.diary_entry_id, 12); assert.equal(f.saved.records[0].diary_requested, false);
  assert.equal(f.requests.filter(([,o]) => o.method === 'PUT').length, before);
  await restored.close();
});

test('closing a session during an in-flight request prevents late responses from altering its data', async () => {
  const f = fixture(), store = await initialize(f);
  let release; const request = f.deps.request;
  f.deps.request = async (url, options) => { if (url === '/v1/me') await new Promise(resolve => { release = resolve; }); return request(url, options); };
  const pending = store.refresh();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await store.close(); const before = clone(f.saved); release(); await pending;
  assert.deepEqual(f.saved, before);
});

test('unsupported catalogue versions or missing animation assets are rejected before starting', () => {
  assert.equal(supportedCatalogue(catalogue), true);
  assert.equal(supportedCatalogue({ ...catalogue, version: 2 }), false);
  assert.equal(supportedCatalogue({ ...catalogue, exercises: [{ id: 'march', animation: 'unknown' }] }), false);
});

test('every authored animation has finite, exercise-specific motion', () => {
  const { exercisePose } = load('poses.ts');
  const names = ['march','side_step','shoulders','arm_raise','squat','wall_push','calf_raise','leg_side','chest','side_bend','calf_stretch'];
  const signatures = new Set();
  for (const name of names) {
    const poses = [0, .125, .25, .5, .75].map(t => exercisePose(name,t));
    assert.ok(poses.flatMap(p => Object.values(p).flat()).every(Number.isFinite));
    assert.notEqual(JSON.stringify(poses[0]), JSON.stringify(poses[2]), name);
    signatures.add(JSON.stringify(poses));
  }
  assert.equal(signatures.size, names.length);
});
