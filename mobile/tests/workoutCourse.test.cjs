const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), { execFileSync } = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '../src/workouts'), cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const scope = { exports: {}, AbortController, performance, require: name => name.startsWith('.') ? load(path.join(path.dirname(file), name + '.ts')) : require(name) };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, scope);
  cache.set(file, scope.exports); return scope.exports;
}
const { WorkoutStore, supportedCatalogue } = load(path.join(root, 'store.ts'));
const { courseState, courseWorkout } = load(path.join(root, 'course.ts'));
const engine = load(path.join(root, 'engine.ts'));
const { effortSuggestion } = load(path.join(root, 'effort.ts'));
const { availableWorkouts } = load(path.join(root, 'catalogue.ts'));
const catalogue = JSON.parse(execFileSync(path.resolve(__dirname, '../../.venv/bin/python'), ['-c', 'import json; from src.shared.workouts import catalogue; print(json.dumps(catalogue(4)))'], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' }));
const legacyCatalogue = JSON.parse(execFileSync(path.resolve(__dirname, '../../.venv/bin/python'), ['-c', 'import json; from src.shared.workouts import catalogue; print(json.dumps(catalogue(3)))'], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' }));
const clone = value => JSON.parse(JSON.stringify(value));
function fixture(initialCatalogue = catalogue) {
  let elapsed = 0, serial = 0, saved = { catalogue: initialCatalogue, settings: { auto_log: false, sound: true, activity_level: 'medium' }, settings_dirty: false, timezone: 'UTC', records: [], draft: null, course_progress: [], course_queue: [] };
  const config = { offline: true, loseAck: false, diskFull: false }, remote = new Map(), progress = [], calls = [];
  const wall = () => new Date(Date.parse('2026-01-01T10:00:00Z') + elapsed).toISOString();
  function credit(day, time, id) {
    if (progress.some(p => p.day === day)) return;
    if (day !== progress.length + 1 || (progress.length && time.slice(0,10) <= progress.at(-1).local_date)) throw Object.assign(Error('out of order'), { status: 409 });
    progress.push({ day, completed_at: time, local_date: time.slice(0,10), session_id: id });
  }
  const deps = { read: async () => clone(saved), write: async value => { if (config.diskFull) throw Error('disk full'); saved = clone(value); }, remove: async () => { saved = null; }, uuid: () => `id-${++serial}`, now: () => elapsed, wall, updated() {},
    async request(url, options) {
      if (config.offline) throw Object.assign(Error('offline'), { status: 0 });
      if (options.method) calls.push(url);
      if (url.includes('/course/days/')) { credit(Number(url.split('/').at(-1)), options.json.completed_at, null); if (config.loseAck) { config.loseAck = false; throw Object.assign(Error('ack lost'), { status: 0 }); } return clone(progress); }
      if (url.includes('/sessions/')) {
        const id = url.split('/').at(-1), body = options.json;
        if (!remote.has(id)) {
          const definition = catalogue.workouts.find(w => w.id === body.workout_id);
          if (body.status === 'completed') credit(definition.course_day, body.ended_at, id);
          remote.set(id, { ...body, id, title: definition.title });
        }
        if (config.loseAck) { config.loseAck = false; throw Object.assign(Error('ack lost'), { status: 0 }); }
        return { ...clone(remote.get(id)), course_progress: clone(progress) };
      }
      if (url === '/v1/workouts/course/progress') return clone(progress);
      if (url.startsWith('/v1/workouts/catalogue')) return catalogue;
      if (url.startsWith('/v1/workouts/history')) return { items: [...remote.values()], next_offset: null };
      if (url === '/v1/settings/workouts') return saved.settings;
      if (url === '/v1/me') return { timezone: 'UTC' };
      throw Error(url);
    } };
  return { deps, config, calls, progress, remote, advance(ms) { elapsed += ms; }, get saved() { return saved; } };
}
async function initialize(f) { const store = new WorkoutStore(f.deps); await store.initialize(); await store.refresh(); return store; }
async function complete(store, f, day) {
  const workout = courseWorkout(store.getSnapshot(), day);
  await store.start(workout.id);
  await store.action('skip'); // Start immediately instead of waiting through preparation.
  for (const step of workout.steps) {
    if (step.optional) await store.action('skip');
    else { f.advance(step.expected_seconds * 1000); store.tick(); if (step.repetitions) await store.action('complete_reps'); }
    if (store.getSnapshot().draft?.phase === 'rest') await store.action('skip');
  }
  await store.refresh();
}

test('real v4 catalogue is accepted and future/incomplete courses are rejected', () => {
  assert.equal(supportedCatalogue(catalogue), true);
  assert.equal(supportedCatalogue(legacyCatalogue), true);
  assert.equal(supportedCatalogue({ ...catalogue, version: 5 }), false);
  const bad = clone(catalogue); bad.course.days[0].workout_ids.intense = 'missing';
  assert.equal(supportedCatalogue(bad), false);
});

test('only revised workouts are offered; old drafts and queued completions survive the catalogue update', async () => {
  const offered = availableWorkouts(catalogue);
  assert.equal(offered.length, 48);
  assert.ok(offered.every(w => w.curriculum_revision === 2));
  const f = fixture(legacyCatalogue), store = await initialize(f);
  await store.start(courseWorkout(store.getSnapshot(), 1).id);
  const draft = clone(store.getSnapshot().draft);
  f.config.offline = false; await store.refresh();
  assert.equal(store.getSnapshot().catalogue.version, 4);
  assert.deepEqual(clone(store.getSnapshot().draft), draft);
  await store.action('stop');
  await assert.rejects(store.start('fb28_d01_medium'), /обновилась/);
  await store.close();

  const queuedFixture = fixture(legacyCatalogue), queued = await initialize(queuedFixture);
  await complete(queued, queuedFixture, 1);
  assert.equal(queued.getSnapshot().records[0].payload.catalogue_version, 3);
  // Simulate a refreshed catalogue while the old offline completion is still queued.
  const updated = { ...queued.getSnapshot(), catalogue };
  assert.equal(courseState(updated, queuedFixture.deps.wall()).day, 2);
  queuedFixture.config.offline = false; await queued.refresh();
  assert.equal(courseState(queued.getSnapshot(), queuedFixture.deps.wall()).day, 2);
  assert.equal(queuedFixture.progress.length, 1);
  await queued.close();
});

test('effort feedback is durable, stays local after sync and never changes the chosen load automatically', async () => {
  const f = fixture(), store = await initialize(f);
  await complete(store, f, 1);
  let record = store.getSnapshot().records[0];
  await store.rateWorkout(record.id, 'easy');
  record = store.getSnapshot().records[0];
  assert.equal(effortSuggestion(store.getSnapshot(), record).level, 'medium');
  f.advance(86400000); await store.completeCourseDay(2); f.advance(86400000); await complete(store, f, 3);
  const id = store.getSnapshot().records[0].id;
  await store.rateWorkout(id, 'easy');
  record = store.getSnapshot().records[0];
  assert.equal(effortSuggestion(store.getSnapshot(), record).level, 'intense');
  assert.equal(store.getSnapshot().settings.activity_level, 'medium');
  assert.equal(effortSuggestion(store.getSnapshot(), store.getSnapshot().records[1]), null);
  await store.close();
  const restored = await initialize(f);
  assert.equal(restored.getSnapshot().records[0].effort, 'easy');
  f.config.offline = false; await restored.refresh();
  assert.equal(restored.getSnapshot().records[0].effort, 'easy');
  assert.equal(f.remote.get(id).effort, undefined);
  await restored.rateWorkout(id, 'hard');
  assert.equal(effortSuggestion(restored.getSnapshot(), restored.getSnapshot().records[0]).level, 'light');
  assert.equal(restored.getSnapshot().settings.activity_level, 'medium');
  await assert.rejects(restored.rateWorkout(id, 'unknown'));
  await restored.close();
});

test('mobility and interrupted workouts cannot drive load recommendations, and light never drops below light', async () => {
  const f = fixture(), store = await initialize(f);
  await store.setSettings({ ...store.getSnapshot().settings, activity_level: 'light' });
  await complete(store, f, 1);
  await store.rateWorkout(store.getSnapshot().records[0].id, 'hard');
  assert.equal(effortSuggestion(store.getSnapshot(), store.getSnapshot().records[0]).level, 'light');
  f.advance(86400000); await store.completeCourseDay(2); f.advance(86400000); await complete(store, f, 3);
  await store.rateWorkout(store.getSnapshot().records[0].id, 'easy');
  assert.equal(effortSuggestion(store.getSnapshot(), store.getSnapshot().records[0]).level, 'light');
  f.advance(86400000); await complete(store, f, 4);
  await assert.rejects(store.rateWorkout(store.getSnapshot().records[0].id, 'easy'));
  f.advance(86400000); await store.start(courseWorkout(store.getSnapshot(), 5).id); await store.action('stop');
  await assert.rejects(store.rateWorkout(store.getSnapshot().records[0].id, 'easy'));
  await store.close();
});

test('load choice changes only the next draft; restart retains its exact sequence and repetitions', async () => {
  const f = fixture(), store = await initialize(f);
  await store.setSettings({ ...store.getSnapshot().settings, activity_level: 'light' });
  await store.start(courseWorkout(store.getSnapshot(), 1).id);
  const original = clone(store.getSnapshot().draft.workout);
  await store.setSettings({ ...store.getSnapshot().settings, activity_level: 'intense' });
  assert.deepEqual(clone(store.getSnapshot().draft.workout), original);
  await store.close();
  const restored = await initialize(f);
  assert.deepEqual(clone(restored.getSnapshot().draft.workout), original);
  assert.equal(restored.getSnapshot().draft.paused, true);
  await restored.action('stop');
  await restored.start(courseWorkout(restored.getSnapshot(), 1).id);
  assert.equal(restored.getSnapshot().draft.workout.activity_level, 'intense');
  await restored.close();
});

test('offline days persist, enforce recovery dates, sync in order and survive a lost acknowledgement', async () => {
  const f = fixture(), store = await initialize(f);
  await assert.rejects(store.start(courseWorkout(store.getSnapshot(), 3).id));
  await complete(store, f, 1);
  assert.equal(courseState(store.getSnapshot(), f.deps.wall()).day, 2);
  await assert.rejects(store.completeCourseDay(2));
  f.advance(86400000); await store.completeCourseDay(2);
  f.advance(86400000); await complete(store, f, 3);
  assert.equal(courseState(store.getSnapshot(), f.deps.wall()).day, 4);
  await store.close(); f.config.offline = false; f.config.loseAck = true;
  const restored = await initialize(f); await restored.refresh();
  assert.deepEqual(f.progress.map(p => p.day), [1,2,3]);
  assert.equal(f.remote.size, 2);
  assert.equal(f.saved.course_queue.length, 0);
  assert.equal(restored.getSnapshot().records.filter(r => r.server).length, 2);
  assert.equal(courseState(restored.getSnapshot(), f.deps.wall()).day, 4);
  const dayAck = f.calls.indexOf('/v1/workouts/course/days/2');
  assert.ok(dayAck > f.calls.indexOf('/v1/workouts/sessions/id-1'));
  assert.ok(dayAck < f.calls.indexOf('/v1/workouts/sessions/id-2'));
  await restored.close();
});

test('all 28 days finish offline with exact calendar progression and no forced bonus sets', async () => {
  const f = fixture(), store = await initialize(f);
  for (const day of catalogue.course.days) {
    assert.equal(courseState(store.getSnapshot(), f.deps.wall()).day, day.day);
    if (day.workout_ids.medium) await complete(store, f, day.day);
    else await store.completeCourseDay(day.day);
    f.advance(86400000);
  }
  assert.equal(courseState(store.getSnapshot(), f.deps.wall()).finished, true);
  f.config.offline = false; await store.refresh();
  assert.equal(f.progress.length, 28);
  await store.close();
});

test('losing the walk acknowledgement mid-sync never rolls back confirmed or queued days', async () => {
  const f = fixture(), store = await initialize(f);
  await complete(store, f, 1); f.advance(86400000); await store.completeCourseDay(2);
  await store.refresh(); // Let the previous offline attempt settle before reconnecting.
  f.config.offline = false;
  const request = f.deps.request;
  f.deps.request = async (url, options) => {
    const value = await request(url, options);
    if (url.includes('/course/days/2')) { f.config.offline = true; throw Object.assign(Error('ack lost'), { status: 0 }); }
    return value;
  };
  await store.refresh();
  assert.equal(f.saved.course_progress.length, 1);
  assert.equal(f.saved.course_queue.length, 1);
  assert.equal(courseState(store.getSnapshot(), f.deps.wall()).day, 3);
  await store.close();
  const restored = await initialize(f);
  assert.equal(courseState(restored.getSnapshot(), f.deps.wall()).day, 3);
  f.deps.request = request; f.config.offline = false; await restored.refresh();
  assert.equal(f.saved.course_progress.length, 2); assert.equal(f.saved.course_queue.length, 0);
  assert.equal(f.progress.length, 2);
  await restored.close();
});

test('skipped required main steps interrupt the course, optional sets and warmup may be skipped', () => {
  const definition = catalogue.workouts.find(w => w.id === 'fb28_d22_medium');
  let draft = engine.createDraft('draft', definition, catalogue, { auto_log: false }, 'UTC', 0, '2026-01-01T10:00:00Z');
  draft.results = draft.results.map((r, i) => ({ ...r, completed: definition.steps[i].section === 'main' && !definition.steps[i].optional }));
  assert.equal(engine.finish(draft, 'completed', '2026-01-01T11:00:00Z').status, 'completed');
  draft.results[definition.steps.findIndex(s => s.section === 'main')].completed = false;
  assert.equal(engine.finish(draft, 'completed', '2026-01-01T11:00:00Z').status, 'interrupted');
});

test('failed durable check-in remains unsaved until retry and account data never leaks', async () => {
  const f = fixture(), store = await initialize(f); await complete(store, f, 1); f.advance(86400000);
  f.config.diskFull = true; await assert.rejects(store.completeCourseDay(2));
  assert.equal(f.saved.course_queue.length, 0); assert.equal(store.getSnapshot().storage_error, true);
  f.config.diskFull = false; await store.retry(); assert.equal(f.saved.course_queue.length, 1);
  const other = fixture(), otherStore = await initialize(other);
  assert.equal(courseState(otherStore.getSnapshot(), other.deps.wall()).day, 1);
  await store.close(); await otherStore.close();
});
