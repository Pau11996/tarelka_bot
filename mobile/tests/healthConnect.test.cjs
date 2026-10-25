const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('typescript');
function modules(mocks = {}) {
  const cache = new Map();
  function load(file) {
    const full = path.resolve(__dirname, '../src', file);
    if (cache.has(full)) return cache.get(full);
    const context = { exports: {}, Date, Intl, Map, Set, AbortController, console, require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (!name.startsWith('.')) throw Error(`Unexpected native dependency: ${name}`);
      return load(path.relative(path.resolve(__dirname, '../src'), path.resolve(path.dirname(full), name + '.ts')));
    }};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
    cache.set(full, context.exports); return context.exports;
  }
  return load;
}
const clone = value => JSON.parse(JSON.stringify(value));
const shift = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') + n * 86400000).toISOString().slice(0,10);
function windows(start, end) {
  const result = [];
  for (let date = start; date <= end; date = shift(date, 1)) result.push({ date, start_at: date + 'T00:00:00Z', end_at: shift(date, 1) + 'T00:00:00Z' });
  return result;
}
function fixture() {
  let saved = null, serial = 0;
  const uploads = [], calls = [];
  const config = { available: true, connected: true, connection_id: 'connection', generation: 'generation', permissions: ['Steps', 'Weight', 'ExerciseSession'], workout_origin: 'chosen.app', timezone: 'UTC', today: '2026-10-23', revision: 0, windows: windows('2026-10-21', '2026-10-23') };
  const reader = {
    async permissions() { return config.permissions; },
    async changes(kind, token) { calls.push(['changes', kind, token]); return { nextChangesToken: `${kind}:new`, hasMore: false, changesTokenExpired: false, upsertionChanges: [], deletionChanges: [] }; },
    async records(kind, from, to) { calls.push(['records', kind, from, to]); return []; },
    async aggregate(kind, window, origin) { calls.push(['aggregate', kind, window.date, origin]); return { value: kind === 'Steps' ? 0 : null, origins: kind === 'Steps' ? ['chosen.app'] : [] }; },
  };
  const deps = {
    reader, uuid: () => `batch-${++serial}`, guard() {},
    async connection(start, end) { return { ...config, windows: windows(start, end) }; },
    async upload(batch) { uploads.push(clone(batch)); },
    async persist(state) { saved = clone(state); },
  };
  return { config, reader, deps, uploads, calls, get saved() { return saved; } };
}
const { runHealthSync } = modules()('health/engine.ts');

test('full import uses native aggregates, keeps recorded zero, and sends only selected workout source', async () => {
  const f = fixture();
  f.reader.records = async kind => kind === 'ExerciseSession' ? ['chosen.app', 'duplicate.app'].map((origin, i) => ({ recordType: kind, metadata: { id: `workout-${i}`, dataOrigin: origin }, startTime: '2026-10-22T10:00:00Z', endTime: '2026-10-22T10:30:00Z' })) : kind === 'Steps' ? [{ recordType: kind, metadata: { id: 'steps-raw', dataOrigin: 'chosen.app' }, startTime: '2026-10-23T10:00:00Z', endTime: '2026-10-23T10:30:00Z', count: 9999 }] : [];
  const state = await runHealthSync(null, f.config, f.deps);
  assert.equal(f.uploads.length, 1);
  assert.equal(f.uploads[0].records.length, 1);
  assert.equal(f.uploads[0].records[0].origin, 'chosen.app');
  assert.equal(f.uploads[0].days[0].steps, 0);
  assert.equal(f.uploads[0].days[0].active_kcal, null);
  assert.equal(state.pending, undefined);
  assert.equal(state.tokens.Steps, 'Steps:new');
  assert.ok(f.calls.filter(c => c[0] === 'aggregate' && c[1] === 'ExerciseSession').every(c => c[3] === 'chosen.app'));
});

test('lost upload acknowledgement retains durable batch and cursors; restart resends identical batch', async () => {
  const f = fixture();
  f.deps.upload = async batch => { f.uploads.push(clone(batch)); throw Error('ACK lost'); };
  await assert.rejects(runHealthSync(null, f.config, f.deps), /ACK lost/);
  assert.equal(f.saved.pending.next, 0);
  assert.deepEqual(f.saved.tokens, {});
  const queued = clone(f.saved.pending.batches[0]);
  const callsBefore = f.calls.length;
  f.deps.upload = async batch => f.uploads.push(clone(batch));
  const state = await runHealthSync(f.saved, { ...f.config, revision: 1 }, f.deps);
  assert.deepEqual(f.uploads[1], queued);
  assert.equal(f.calls.length, callsBefore);
  assert.equal(state.tokens.Weight, 'Weight:new');
  assert.equal(state.pending, undefined);
});

test('multi-batch outbox resumes from first unacknowledged batch and commits cursors only at the end', async () => {
  const f = fixture(); f.config.history_start = '2026-09-01';
  const previous = { generation: f.config.generation, timezone: 'UTC', permissions: 'ExerciseSession,Steps,Weight', tokens: { Steps: 'old', Weight: 'old', ExerciseSession: 'old' }, index: {} };
  f.deps.upload = async batch => { f.uploads.push(clone(batch)); if (f.uploads.length === 2) throw Error('offline'); };
  await assert.rejects(runHealthSync(previous, f.config, f.deps, true), /offline/);
  assert.equal(f.saved.pending.next, 1);
  assert.equal(f.saved.tokens.Steps, 'old');
  f.deps.upload = async batch => f.uploads.push(clone(batch));
  await runHealthSync(f.saved, { ...f.config, revision: 1 }, f.deps);
  assert.equal(f.uploads[2].batch_id, f.uploads[1].batch_id);
  assert.equal(f.uploads[2].base_revision, 1);
});

test('Changes updates and deletions recompute old local days as well as latest window', async () => {
  const f = fixture();
  const previous = { generation: f.config.generation, timezone: 'UTC', permissions: 'ExerciseSession,Steps,Weight', tokens: { Steps: 'old', Weight: 'old', ExerciseSession: 'old' }, index: { 'Weight:weight-old': { start_at: '2026-10-01T10:00:00Z' }, 'ExerciseSession:deleted-workout': { start_at: '2026-10-02T10:00:00Z', end_at: '2026-10-02T11:00:00Z' } } };
  f.reader.changes = async kind => ({ nextChangesToken: 'next', hasMore: false, changesTokenExpired: false, upsertionChanges: kind === 'Weight' ? [{ record: { recordType: kind, metadata: { id: 'weight-old', dataOrigin: 'scale.app' }, time: '2026-10-22T10:00:00Z', weight: { inKilograms: 70 } } }] : [], deletionChanges: kind === 'ExerciseSession' ? [{ recordId: 'deleted-workout' }] : [] });
  const state = await runHealthSync(previous, f.config, f.deps);
  assert.equal(f.uploads[0].start_date, '2026-10-01');
  assert.equal(f.uploads[0].reconcile, false);
  assert.equal(f.uploads[0].records[0].weight_kg, 70);
  assert.equal(f.uploads[0].deleted[0].external_id, 'deleted-workout');
  assert.equal(state.index['ExerciseSession:deleted-workout'], undefined);
});

test('expired cursor or unknown deletion triggers authoritative reconciliation', async () => {
  for (const expired of [true, false]) {
    const f = fixture();
    const previous = { generation: f.config.generation, timezone: 'UTC', permissions: 'ExerciseSession,Steps,Weight', tokens: { Steps: 'old', Weight: 'old', ExerciseSession: 'old' }, index: {} };
    f.reader.changes = async (kind, token) => ({ nextChangesToken: 'fresh', hasMore: false, changesTokenExpired: !!token && expired, upsertionChanges: [], deletionChanges: token && !expired ? [{ recordId: 'unknown-id' }] : [] });
    await runHealthSync(previous, f.config, f.deps);
    assert.equal(f.uploads[0].reconcile, true);
    assert.ok(f.uploads[0].days.length === 3);
  }
});

test('cancellation before a native read completes prevents persisting or uploading account data', async () => {
  const f = fixture(); let stopped = false;
  f.deps.guard = () => { if (stopped) throw Error('signed out'); };
  f.reader.changes = async () => { stopped = true; return { nextChangesToken: 'new' }; };
  await assert.rejects(runHealthSync(null, f.config, f.deps), /signed out/);
  assert.equal(f.saved, null); assert.equal(f.uploads.length, 0);
});

test('permission changes discard outbox containing revoked types', async () => {
  const f = fixture();
  f.deps.upload = async () => { throw Error('offline'); };
  await assert.rejects(runHealthSync(null, f.config, f.deps));
  const previous = f.saved;
  f.config.permissions = ['Steps'];
  f.deps.upload = async batch => f.uploads.push(clone(batch));
  await runHealthSync(previous, f.config, f.deps);
  assert.deepEqual(f.uploads[0].types, ['Steps']);
  assert.notEqual(f.uploads[0].batch_id, previous.pending.batches[0].batch_id);
});

test('date indexing handles DST and intervals ending exactly at midnight', () => {
  const { intervalDates, localDate } = modules()('health/math.ts');
  assert.deepEqual(clone(intervalDates({ start_at: '2026-03-28T23:00:00Z', end_at: '2026-03-29T22:00:00Z' }, 'Europe/Berlin')), ['2026-03-29']);
  assert.equal(localDate('2026-10-23T22:30:00Z', 'Europe/Minsk'), '2026-10-24');
});

test('native module is never loaded on web, iOS or Expo Go; empty aggregates stay unknown', async () => {
  for (const [os, go] of [['web', false], ['ios', false], ['android', true]]) {
    const load = modules({ 'react-native': { Platform: { OS: os } }, expo: { isRunningInExpoGo: () => go } });
    const native = load('health/native.ts');
    assert.equal(native.getHealthModule(), null);
    assert.equal(await native.healthAvailability(), go ? 'expo_go' : 'unsupported');
  }
  let origins = [];
  const native = modules({ 'react-native': { Platform: { OS: 'android' } }, expo: { isRunningInExpoGo: () => false }, 'react-native-health-connect': { initialize: async () => true, aggregateRecord: async () => ({ COUNT_TOTAL: 0, dataOrigins: origins }) } })('health/native.ts');
  const reader = await native.healthReader();
  assert.equal((await reader.aggregate('Steps', windows('2026-10-23', '2026-10-23')[0])).value, null);
  origins = ['watch.app'];
  assert.equal((await reader.aggregate('Steps', windows('2026-10-23', '2026-10-23')[0])).value, 0);
});

test('sign-out blocks queued and resumed syncs; simultaneous foreground events stay serialized', async () => {
  let active = 0, max = 0, uploads = 0, clears = 0;
  const config = { available: true, connected: true, installation_id: 'phone', generation: 'generation', permissions: ['Steps'] };
  const storage = { clearAllHealthStates: async () => { clears++; }, clearHealthState: async () => {}, installationId: async () => 'phone', readHealthState: async () => null, writeHealthState: async () => {} };
  const service = modules({
    '../api': { api: async path => path === '/v1/me' ? { id: 7 } : config, ApiError: class extends Error {} },
    '../config': { API_URL: 'https://api.test' },
    './native': { healthAvailability: async () => 'available', healthReader: async () => ({ permissions: async () => ['Steps'] }) },
    './storage': storage, './events': { healthUpdated() {} }, 'expo-crypto': { randomUUID: () => 'uuid' },
    'react-native': { Platform: { OS: 'android' } }, expo: { isRunningInExpoGo: () => false },
    './engine': { runHealthSync: async (state, config, deps) => { active++; max = Math.max(max, active); await new Promise(resolve => setTimeout(resolve, 5)); deps.guard(); uploads++; active--; } },
  })('health/service.ts');
  service.setHealthSession('old-account');
  await Promise.all([service.syncHealth('old-account'), service.syncHealth('old-account'), service.syncHealth('old-account')]);
  assert.equal(max, 1); assert.equal(uploads, 3);
  const queued = service.syncHealth('old-account');
  await service.pauseHealthSync(true);
  await queued;
  await service.syncHealth('old-account');
  assert.equal(uploads, 3); assert.equal(clears, 1);
  service.setHealthSession('new-account');
  await service.syncHealth('new-account');
  assert.equal(uploads, 4);
});

test('a deletion with lost local metadata still removes the cloud weight during full reconciliation', async () => {
  const f = fixture(); f.config.permissions = ['Weight'];
  const previous = { generation: f.config.generation, timezone: 'UTC', permissions: 'Weight', tokens: { Weight: 'old' }, index: {} };
  f.reader.changes = async (kind, token) => ({ nextChangesToken: 'fresh', hasMore: false, changesTokenExpired: false, upsertionChanges: [], deletionChanges: token ? [{ recordId: 'deleted-old-weight' }] : [] });
  await runHealthSync(previous, f.config, f.deps);
  assert.equal(f.uploads[0].reconcile, true);
  assert.equal(f.uploads[0].deleted[0].external_id, 'deleted-old-weight');
});

test('an expired steps cursor does not discard weight tombstones from another valid cursor', async () => {
  const f = fixture();
  f.config.permissions = ['Steps', 'Weight'];
  const previous = { generation: f.config.generation, timezone: 'UTC', permissions: 'Steps,Weight', tokens: { Steps: 'old', Weight: 'old' }, index: {} };
  f.reader.changes = async (kind, token) => ({ nextChangesToken: 'fresh', hasMore: false, changesTokenExpired: kind === 'Steps' && !!token, upsertionChanges: [], deletionChanges: kind === 'Weight' && token ? [{ recordId: 'deleted-weight' }] : [] });
  await runHealthSync(previous, f.config, f.deps);
  assert.equal(f.uploads[0].deleted[0].external_id, 'deleted-weight');
});

test('workout-only permission asks for a source before reading or uploading workouts', async () => {
  const f = fixture(); f.config.permissions = ['ExerciseSession']; f.config.workout_origin = null;
  await assert.rejects(runHealthSync(null, f.config, f.deps), /Выберите источник тренировок/);
  assert.equal(f.calls.length, 0); assert.equal(f.uploads.length, 0);
});

test('logout waits for an in-flight SQLite write before clearing the outbox', async () => {
  let wrote, finish, cleared = 0;
  const started = new Promise(resolve => { wrote = resolve; });
  const writing = new Promise(resolve => { finish = resolve; });
  const service = modules({
    '../api': { api: async path => path === '/v1/me' ? { id: 7 } : { available: true, connected: true, installation_id: 'phone', generation: 'g', permissions: ['Steps'] }, ApiError: class extends Error {} },
    '../config': { API_URL: 'https://api.test' },
    './native': { healthAvailability: async () => 'available', healthReader: async () => ({ permissions: async () => ['Steps'] }) },
    './storage': { installationId: async () => 'phone', readHealthState: async () => null, writeHealthState: async () => { wrote(); await writing; }, clearAllHealthStates: async () => { cleared++; }, clearHealthState: async () => {} },
    './events': { healthUpdated() {} }, 'expo-crypto': { randomUUID: () => 'id' },
    'react-native': { Platform: { OS: 'android' } }, expo: { isRunningInExpoGo: () => false },
    './engine': { runHealthSync: async (state, config, deps) => { await deps.persist({ pending: { batches: [] } }); } },
  })('health/service.ts');
  service.setHealthSession('account');
  const syncing = service.syncHealth('account').catch(() => undefined);
  await started;
  const logout = service.pauseHealthSync(true);
  assert.equal(cleared, 0);
  finish(); await logout; await syncing;
  assert.equal(cleared, 1);
});

test('revoking every permission refreshes connection status even when no data can sync', async () => {
  let updates = 0, engines = 0, puts = 0;
  const config = { available: true, connected: true, installation_id: 'phone', generation: 'g', permissions: ['Steps'] };
  const service = modules({
    '../api': { api: async (path, options) => { if (path === '/v1/me') return { id: 7 }; if (options.method === 'PUT') { puts++; return { ...config, permissions: [] }; } return config; }, ApiError: class extends Error {} },
    '../config': { API_URL: 'https://api.test' },
    './native': { healthAvailability: async () => 'available', healthReader: async () => ({ permissions: async () => [] }) },
    './storage': { installationId: async () => 'phone', clearHealthState: async () => {} },
    './events': { healthUpdated() { updates++; } },
    './engine': { runHealthSync: async () => { engines++; } },
  })('health/service.ts');
  service.setHealthSession('account'); await service.syncHealth('account');
  assert.equal(puts, 1); assert.equal(updates, 1); assert.equal(engines, 0);
});

test('an empty workout-only source stays connected and waits for data without a sync error', async () => {
  let updates = 0;
  const config = { available: true, connected: true, installation_id: 'phone', generation: 'g', permissions: ['ExerciseSession'], workout_origin: null, windows: windows('2026-10-21', '2026-10-23') };
  const service = modules({
    '../api': { api: async path => path === '/v1/me' ? { id: 7 } : config, ApiError: class extends Error {} },
    '../config': { API_URL: 'https://api.test' },
    './native': { healthAvailability: async () => 'available', healthReader: async () => ({ permissions: async () => ['ExerciseSession'], records: async () => [] }) },
    './storage': { installationId: async () => 'phone' },
    './events': { healthUpdated() { updates++; } },
    './engine': { runHealthSync: async () => { throw Error('should wait for workouts'); } },
  })('health/service.ts');
  service.setHealthSession('account'); await service.syncHealth('account');
  assert.equal(updates, 1);
});
