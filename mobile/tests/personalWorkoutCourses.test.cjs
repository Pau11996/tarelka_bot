const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), { execFileSync } = require('node:child_process');
const ts = require('typescript'), root = path.resolve(__dirname, '../src/workouts'), cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const scope = { exports: {}, AbortController, performance, require: name => name.startsWith('.') ? load(path.join(path.dirname(file), name + '.ts')) : require(name) };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, scope);
  cache.set(file, scope.exports); return scope.exports;
}
const { WorkoutStore, supportedCatalogue } = load(path.join(root, 'store.ts'));
const { courseState, courseWorkout, courseVariant, selectedCourse, HOME_COURSE_ID: HOME, LEGACY_COURSE_ID: WALK } = load(path.join(root, 'course.ts'));
const { availableWorkouts } = load(path.join(root, 'catalogue.ts'));
const { effortSuggestion } = load(path.join(root, 'effort.ts'));
const catalogue = JSON.parse(execFileSync(path.resolve(__dirname, '../../.venv/bin/python'), ['-c', 'import json; from src.shared.workouts import catalogue; print(json.dumps(catalogue(5),ensure_ascii=False))'], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
const legacyCatalogue = JSON.parse(execFileSync(path.resolve(__dirname, '../../.venv/bin/python'), ['-c', 'import json; from src.shared.workouts import catalogue; print(json.dumps(catalogue(4),ensure_ascii=False))'], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
const clone = value => JSON.parse(JSON.stringify(value));
function fixture(initial = {}) {
  let elapsed = 0, serial = 0, saved = { catalogue, settings: { auto_log: false, sound: true, activity_level: 'medium' }, settings_dirty: false,
    timezone: 'UTC', records: [], draft: null, course_progress: [], course_queue: [], ...clone(initial) };
  const config = { offline: true, sex: null, profileFailure: false, loseAck: null, blockDayCourse: null };
  const progress = { [HOME]: clone(saved.course_progress_by_id?.[HOME] ?? []), [WALK]: clone(saved.course_progress_by_id?.[WALK] ?? saved.course_progress ?? []) };
  const remote = new Map(), calls = [];
  const wall = () => new Date(Date.parse('2026-01-01T10:00:00Z') + elapsed).toISOString();
  function credit(course, day, time, id) {
    const previous = progress[course];
    if (previous.some(item => item.day === day)) return;
    if (day !== previous.length + 1 || (previous.length && time.slice(0, 10) <= previous.at(-1).local_date)) throw Object.assign(Error('out of order'), { status: 409 });
    previous.push({ day, completed_at: time, local_date: time.slice(0, 10), session_id: id });
  }
  const deps = { read: async () => clone(saved), write: async data => { saved = clone(data); }, remove: async () => { saved = null; },
    uuid: () => `session-${++serial}`, now: () => elapsed, wall, updated() {},
    async request(url, options) {
      if (config.offline) throw Object.assign(Error('offline'), { status: 0 });
      calls.push({ url, body: options.json });
      if (url.includes('/course/days/')) {
        const body = options.json;
        if (body.course_id === config.blockDayCourse) throw Object.assign(Error('calendar conflict'), { status: 409 });
        credit(body.course_id, Number(url.split('/').at(-1)), body.completed_at, null);
        if (config.loseAck === body.course_id) { config.loseAck = null; throw Object.assign(Error('ack lost'), { status: 0 }); }
        return clone(progress[body.course_id]);
      }
      if (url.includes('/sessions/')) {
        const id = url.split('/').at(-1), body = options.json;
        const definition = catalogue.workouts.find(workout => workout.id === body.workout_id);
        if (!remote.has(id)) {
          if (body.status === 'completed') credit(definition.course_id, definition.course_day, body.ended_at, id);
          remote.set(id, { ...body, id, title: definition.title, course_id: definition.course_id, course_variant: definition.course_variant });
        }
        if (config.loseAck === definition.course_id) { config.loseAck = null; throw Object.assign(Error('ack lost'), { status: 0 }); }
        return { ...clone(remote.get(id)), course_progress: clone(progress[definition.course_id]) };
      }
      if (url.startsWith('/v1/workouts/course/progress')) return clone(progress[url.includes('?') ? decodeURIComponent(url.split('course_id=')[1]) : WALK]);
      if (url.startsWith('/v1/workouts/catalogue')) return catalogue;
      if (url === '/v1/profile') {
        if (config.profileFailure) throw Object.assign(Error('profile unavailable'), { status: 503 });
        return { sex: config.sex };
      }
      if (url === '/v1/settings/workouts') return saved.settings;
      if (url === '/v1/me') return { timezone: 'UTC' };
      if (url.startsWith('/v1/workouts/history')) return { items: [...remote.values()], next_offset: null };
      throw Error(url);
    } };
  return { deps, config, progress, remote, calls, advance(ms) { elapsed += ms; }, get saved() { return saved; } };
}
async function initialize(f) { const store = new WorkoutStore(f.deps); await store.initialize(); await store.refresh(); return store; }
async function complete(store, f, course, day) {
  const workout = courseWorkout(store.getSnapshot(), day, undefined, course);
  await store.start(workout.id); await store.action('skip');
  await finish(store, f);
}
async function finish(store, f) {
  for (const step of store.getSnapshot().draft.workout.steps) {
    f.advance(step.expected_seconds * 1000); store.tick();
    if (step.repetitions) await store.action('complete_reps');
    if (store.getSnapshot().draft?.phase === 'rest') await store.action('skip');
  }
  await store.refresh();
}

test('v5 validates every course/variant and selects female when sex is absent', () => {
  assert.equal(supportedCatalogue(catalogue), true);
  assert.equal(courseVariant(null), 'female'); assert.equal(courseVariant(undefined), 'female');
  assert.equal(courseVariant('male'), 'male');
  for (const sex of [null, 'female', 'male']) {
    const offered = availableWorkouts(catalogue, sex);
    assert.equal(offered.length, 120);
    assert.ok(offered.every(workout => workout.course_variant === (sex ?? 'female')));
  }
  for (const change of [
    c => { delete c.courses[0].variants.male; },
    c => { c.courses[1].variants.male.days[0].workout_ids.medium = c.courses[0].variants.male.days[0].workout_ids.medium; },
    c => { c.courses[0].variants.male.days[6].kind = 'walk'; },
    c => { c.courses[0].variants.female.days[0].workout_ids.medium = 'missing'; },
  ]) { const bad = clone(catalogue); change(bad); assert.equal(supportedCatalogue(bad), false); }
});

test('migration keeps old progress only on walking course and survives an offline restart', async () => {
  const old = [{ day: 1, local_date: '2025-12-30', completed_at: '2025-12-30T10:00:00Z', session_id: 'old' }];
  const f = fixture({ course_progress: old }), store = await initialize(f);
  assert.equal(courseState(store.getSnapshot(), f.deps.wall(), WALK).day, 2);
  assert.equal(courseState(store.getSnapshot(), f.deps.wall(), HOME).day, 1);
  await complete(store, f, HOME, 1);
  assert.equal(courseState(store.getSnapshot(), f.deps.wall(), HOME).day, 2);
  await store.close();
  const restored = await initialize(f);
  assert.deepEqual(f.saved.course_progress_by_id[WALK], old);
  assert.equal(courseState(restored.getSnapshot(), f.deps.wall(), HOME).day, 2);
  assert.equal(courseState(restored.getSnapshot(), f.deps.wall(), WALK).day, 2);
  await restored.close();
});

test('profile selection persists, null resets to female, failures preserve cached sex and an active snapshot', async () => {
  const f = fixture(); f.config.offline = false; f.config.sex = 'male';
  const store = await initialize(f);
  const first = courseWorkout(store.getSnapshot(), 1, undefined, HOME);
  assert.equal(first.course_variant, 'male');
  await store.start(first.id); const snapshot = clone(store.getSnapshot().draft);
  f.config.sex = 'female'; f.config.profileFailure = true; await store.refresh();
  assert.equal(store.getSnapshot().profile_sex, 'male');
  f.config.profileFailure = false; await store.refresh();
  assert.equal(courseWorkout(store.getSnapshot(), 1, undefined, HOME).course_variant, 'female');
  assert.deepEqual(clone(store.getSnapshot().draft), snapshot);
  await store.action('skip'); await finish(store, f);
  assert.equal(f.remote.get(snapshot.id).course_variant, 'male');
  assert.equal(courseState(store.getSnapshot(), f.deps.wall(), HOME).day, 2);
  f.advance(86400000);
  await assert.rejects(store.start(catalogue.courses[0].variants.male.days[1].workout_ids.medium), /обновилась/);
  f.config.sex = 'male'; await store.refresh();
  f.config.sex = null; await store.refresh();
  assert.equal(store.getSnapshot().profile_sex, null);
  assert.equal(selectedCourse(store.getSnapshot(), HOME).variant, 'female');
  await store.close(); f.config.offline = true;
  const restored = await initialize(f);
  assert.equal(selectedCourse(restored.getSnapshot(), HOME).variant, 'female');
  assert.equal(courseState(restored.getSnapshot(), f.deps.wall(), HOME).day, 2);
  await restored.close();
});

test('a v4 draft resumes and credits the walking course after catalogue and profile updates', async () => {
  const { createDraft } = load(path.join(root, 'engine.ts'));
  const workout = legacyCatalogue.workouts.find(w => w.id === legacyCatalogue.course.days[0].workout_ids.medium);
  const settings = { auto_log: false, sound: true, activity_level: 'medium' };
  const draft = createDraft('legacy-session', workout, legacyCatalogue, settings, 'UTC', 0, '2026-01-01T10:00:00Z');
  const f = fixture({ catalogue: legacyCatalogue, draft }); f.config.offline = false; f.config.sex = 'male';
  const store = await initialize(f);
  assert.equal(store.getSnapshot().catalogue.version, 5);
  assert.equal(store.getSnapshot().draft.catalogue_version, 4);
  assert.equal(store.getSnapshot().draft.workout.id, workout.id);
  await store.action('resume'); await store.action('skip'); await finish(store, f);
  assert.equal(f.remote.get('legacy-session').catalogue_version, 4);
  assert.equal(f.progress[WALK].length, 1); assert.equal(f.progress[HOME].length, 0);
  await store.close();
});

test('offline completions and lost acknowledgments cannot advance the other course', async () => {
  const f = fixture({ profile_sex: 'male' }), store = await initialize(f);
  await complete(store, f, HOME, 1);
  await complete(store, f, WALK, 1);
  assert.equal(courseState(store.getSnapshot(), f.deps.wall(), HOME).day, 2);
  assert.equal(courseState(store.getSnapshot(), f.deps.wall(), WALK).day, 2);
  f.config.offline = false; f.config.sex = 'male'; f.config.loseAck = HOME;
  await store.refresh();
  assert.equal(f.progress[HOME].length, 1); assert.equal(f.progress[WALK].length, 0);
  assert.equal(courseState(store.getSnapshot(), f.deps.wall(), WALK).day, 2);
  await store.refresh();
  assert.equal(f.progress[HOME].length, 1); assert.equal(f.progress[WALK].length, 1);
  assert.equal(f.remote.size, 2);
  f.advance(86400000); await store.completeCourseDay(2, WALK);
  assert.equal(courseState(store.getSnapshot(), f.deps.wall(), WALK).day, 3);
  assert.equal(courseState(store.getSnapshot(), f.deps.wall(), HOME).day, 2);
  await store.close();
});

test('same-number rest check-ins keep their own acknowledgments, conflicts and retries', async () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ day: i+1, local_date: `2026-01-0${i+1}`, completed_at: `2026-01-0${i+1}T09:00:00Z`, session_id: null }));
  const f = fixture({ course_progress_by_id: { [HOME]: six, [WALK]: six } }); f.advance(6 * 86400000);
  const store = await initialize(f);
  await store.completeCourseDay(7, HOME); await store.completeCourseDay(7, WALK);
  await store.refresh(); // Finish the offline upload pass before restoring connectivity.
  assert.equal(store.getSnapshot().course_queue.length, 2);
  f.config.offline = false; f.config.loseAck = HOME; f.config.blockDayCourse = WALK;
  await store.refresh(); assert.equal(store.getSnapshot().course_queue.length, 2);
  await store.refresh();
  assert.equal(store.getSnapshot().course_queue.length, 1);
  assert.equal(store.getSnapshot().course_queue[0].course_id, WALK);
  assert.equal(store.getSnapshot().course_queue[0].blocked, true);
  assert.equal(courseState(store.getSnapshot(), f.deps.wall(), HOME).day, 8);
  assert.equal(courseState(store.getSnapshot(), f.deps.wall(), WALK).day, 7);
  f.config.blockDayCourse = null; await store.retry();
  assert.equal(store.getSnapshot().course_queue.length, 0);
  assert.equal(f.progress[WALK].length, 7);
  await store.close();
});

test('feedback ignores other courses and variants when suggesting a higher load', async () => {
  const f = fixture({ profile_sex: 'male' }), store = await initialize(f);
  await complete(store, f, HOME, 1); await store.rateWorkout(store.getSnapshot().records[0].id, 'easy');
  await complete(store, f, WALK, 1); await store.rateWorkout(store.getSnapshot().records[0].id, 'easy');
  let record = store.getSnapshot().records[0];
  assert.equal(effortSuggestion(store.getSnapshot(), record).level, 'medium');
  f.advance(86400000); await complete(store, f, HOME, 2);
  await assert.rejects(store.rateWorkout(store.getSnapshot().records[0].id, 'easy'));
  f.advance(86400000); await complete(store, f, HOME, 3); await store.rateWorkout(store.getSnapshot().records[0].id, 'easy');
  record = store.getSnapshot().records[0];
  assert.equal(effortSuggestion(store.getSnapshot(), record).level, 'intense');
  const otherVariant = clone(store.getSnapshot());
  otherVariant.records.find(item => item.id === 'session-1').payload.workout_id = catalogue.courses[0].variants.female.days[0].workout_ids.medium;
  assert.equal(effortSuggestion(otherVariant, otherVariant.records[0]).level, 'medium');
  assert.equal(store.getSnapshot().settings.activity_level, 'medium');
  await store.close();
});
