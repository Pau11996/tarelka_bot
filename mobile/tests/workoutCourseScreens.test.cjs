const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), { execFileSync } = require("node:child_process");
const ts = require("typescript");
const root = path.resolve(__dirname, "../src");
const catalogue = JSON.parse(execFileSync(path.resolve(__dirname, "../../.venv/bin/python"), ["-c", "import json; from src.shared.workouts import catalogue; print(json.dumps(catalogue(3)))"], { cwd: path.resolve(root, "../.."), encoding: "utf8" }));

function setup() {
  const pushes = [], starts = [], slots = [];
  let cursor = 0;
  const data = { catalogue, ready: true, settings: { activity_level: "medium" }, timezone: "UTC", records: [], course_progress: [], course_queue: [], draft: null,
    store: { refresh() {}, async start(id) { starts.push(id); } } };
  const cache = new Map();
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], v => { slots[i] = typeof v === "function" ? v(slots[i]) : v; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect() {}, useCallback: fn => fn,
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const context = { exports: {}, Date, require(name) {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "Fragment" };
      if (name === "react-native") return new Proxy({ StyleSheet: { create: v => v, absoluteFill: {} } }, { get: (v, key) => v[key] ?? key });
      if (name === "react-native-safe-area-context") return { SafeAreaView: "SafeAreaView" };
      if (name === "expo-router") return { router: { push: value => pushes.push(value) }, useLocalSearchParams: () => ({}), useFocusEffect() {} };
      if (name.endsWith("/context")) return { useWorkouts: () => data };
      if (name.endsWith("/theme")) return { colors: {} };
      if (name.endsWith("/Brand")) return { Icon: "Icon" };
      if (name.endsWith("/ExerciseFigure")) return { ExerciseFigure: "ExerciseFigure" };
      if (name.endsWith("/ui") || name === "./ui") return { s: {}, WorkoutHeader: "WorkoutHeader", ErrorText: "ErrorText", Loading: "Loading", PrimaryButton: "PrimaryButton", SecondaryButton: "SecondaryButton", statsFor: () => ({}), dateLabel: s => s };
      if (name === "./engine") return { sessionDate: value => value.slice(0, 10) };
      if (name.endsWith(".png")) return "bundled-course-photo";
      const target = path.resolve(path.dirname(file), name);
      return load(fs.existsSync(target + ".ts") ? target + ".ts" : target + ".tsx");
    } };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, context);
    cache.set(file, context.exports); return context.exports;
  }
  return { data, pushes, starts, load: name => load(path.join(root, name)), render: fn => { cursor = 0; return fn(); } };
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

test("workout catalogue shows one course card; opening it does not start a session", () => {
  const app = setup();
  const { CourseCard } = app.load("workouts/CourseCard.tsx");
  const tree = app.render(app.load("app/(tabs)/workouts.tsx").default);
  const cards = nodes(tree).filter(node => node.type === CourseCard);
  assert.equal(cards.length, 1);
  assert.equal(nodes(tree).some(node => node.type?.name === "CourseOverview"), false);
  const card = CourseCard(cards[0].props);
  assert.match(card.props.accessibilityLabel, /Всё тело.*28 дней/);
  card.props.onPress();
  assert.deepEqual(app.pushes, ["/workout/course"]);
  assert.equal(app.starts.length, 0);
});

test("course facts are derived from the selected load and the actual programme", () => {
  const app = setup(), { courseSummary } = app.load("workouts/course.ts");
  for (const level of ["light", "medium", "intense"]) {
    app.data.settings.activity_level = level;
    const facts = courseSummary(app.data);
    const workouts = catalogue.workouts.filter(w => w.course_id === catalogue.course.id && w.activity_level === level);
    const minutes = workouts.map(w => Math.round(w.duration_seconds / 60));
    assert.equal(facts.minutes, `${Math.min(...minutes)}–${Math.max(...minutes)}`);
    assert.equal(facts.exercises, "10–21");
    assert.equal(facts.title, "Всё тело");
    assert.equal(facts.days, 28);
  }
});

test("the course detail starts day one once and enters the player", async () => {
  const app = setup();
  const { CourseOverview } = app.load("workouts/CourseOverview.tsx");
  let release;
  app.data.store.start = id => { app.starts.push(id); return new Promise(resolve => { release = resolve; }); };
  const tree = app.render(CourseOverview);
  const button = nodes(tree).find(node => node.type === "PrimaryButton");
  assert.equal(button.props.label, "Начать курс");
  button.props.onPress(); button.props.onPress();
  assert.equal(app.starts.length, 1);
  assert.equal(app.starts[0], catalogue.course.days[0].workout_ids.medium);
  assert.equal(app.pushes.length, 0);
  release(); await new Promise(setImmediate);
  assert.deepEqual(app.pushes, ["/workout/player"]);
});

test("an existing session resumes; the course never replaces its progress", () => {
  const app = setup();
  app.data.draft = { workout: { title: "День 3" } };
  const button = nodes(app.render(app.load("workouts/CourseOverview.tsx").CourseOverview)).find(node => node.type === "PrimaryButton");
  assert.equal(button.props.label, "Продолжить занятие");
  button.props.onPress();
  assert.deepEqual(app.pushes, ["/workout/player"]);
  assert.equal(app.starts.length, 0);
});

test("the course respects recovery days and gives access to the next walk without starting a workout", () => {
  const app = setup(), { CourseOverview } = app.load("workouts/CourseOverview.tsx");
  const now = new Date().toISOString();
  app.data.course_progress = [{ day: 1, completed_at: now, local_date: now.slice(0, 10), session_id: "one" }];
  let button = nodes(app.render(CourseOverview)).find(node => node.type === "PrimaryButton");
  assert.equal(button.props.label, "Следующий день — завтра");
  assert.equal(button.props.disabled, true);
  button.props.onPress(); assert.equal(app.pushes.length, 0);
  app.data.course_progress[0].local_date = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  button = nodes(app.render(CourseOverview)).find(node => node.type === "PrimaryButton");
  assert.equal(button.props.label, "Продолжить курс");
  button.props.onPress();
  assert.equal(app.pushes[0].pathname, "/workout/course/[day]");
  assert.equal(app.pushes[0].params.day, "2");
  assert.equal(app.starts.length, 0);
});
