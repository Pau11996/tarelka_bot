import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { colors as c } from "../theme";
import { ErrorText, PrimaryButton } from "../ui";
import { Icon } from "../components/Brand";
import { useWorkouts } from "./context";
import { activityLevels, courseDescription, courseInstructions, courseState, courseSummary, courseVariant, courseWorkout, LEGACY_COURSE_ID, selectedCourse } from "./course";
import { CourseFacts, CoursePhoto } from "./CourseCard";
import { workoutSeconds } from "./timing";
import { s } from "./ui";

export function useCourseClock() {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => { const timer = setInterval(() => setNow(new Date().toISOString()), 30000); return () => clearInterval(timer); }, []);
  return now;
}

export function ActivityPicker({ compact = false, courseId }: { compact?: boolean; courseId?: string }) {
  const data = useWorkouts(), { store, settings, draft, catalogue } = data;
  const course = courseId ? selectedCourse(data, courseId) : undefined;
  const revised = !!catalogue && catalogue.version >= 4;
  const [error, setError] = useState<string | null>(null);
  return <View style={{ gap: 10 }}>
    <Text style={s.title}>Нагрузка</Text>
    <View style={[s.row, { gap: 6 }]}>{activityLevels.map(level => {
      const selected = (settings.activity_level ?? "medium") === level.id;
      return <Pressable key={level.id} accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => {
        setError(null); void store.setSettings({ ...settings, activity_level: level.id }).catch(e => setError(e.message));
      }} style={{ flex: 1, paddingVertical: 14, paddingHorizontal: 4, borderRadius: 16, alignItems: "center", gap: 5, backgroundColor: selected ? c.soft : c.surface, borderColor: selected ? c.accent : c.border, borderWidth: 1 }}>
        <Text style={[s.body, { fontSize: 12, fontWeight: "600", color: selected ? c.accentDark : c.text }]}>{level.title}</Text>
      </Pressable>;
    })}</View>
    {!compact ? <Text style={s.small}>{course?.load_description ?? (revised ? "Нагрузка меняет число повторов и варианты упражнений. Выполняйте движения плавно. После занятия можно оценить усилие и выбрать уровень на следующий раз." : "Нагрузка меняет длительность основной части. Разминка, растяжка и восстановление одинаковые.")}</Text> : null}
    {draft ? <Text style={s.small}>Выбор применится к следующему занятию. Текущее сохранит свою нагрузку.</Text> : null}
    <ErrorText message={error} />
  </View>;
}

export function CourseOverview({ courseId = LEGACY_COURSE_ID }: { courseId?: string } = {}) {
  const data = useWorkouts(), now = useCourseClock();
  const progress = courseState(data, now, courseId), course = selectedCourse(data, courseId)!;
  const summary = courseSummary(data, courseId)!;
  const [week, setWeek] = useState<number | null>(null);
  const [about, setAbout] = useState(false);
  const [programExpanded, setProgramExpanded] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const starting = useRef(false);
  const visibleWeek = week ?? Math.min(4, Math.ceil(progress.day / 7));
  const current = course.days.find(d => d.day === progress.day);
  function open(day: number) {
    const workout = courseWorkout(data, day, undefined, courseId);
    if (workout) router.push({ pathname: "/workout/[id]", params: { id: workout.id, courseId } });
    else router.push({ pathname: "/workout/course/[day]", params: { day: String(day), courseId } });
  }
  async function start() {
    if (starting.current) return;
    if (data.draft) { router.push("/workout/player"); return; }
    if (!current || !progress.available) return;
    const workout = courseWorkout(data, current.day, undefined, courseId);
    if (!workout) { open(current.day); return; }
    starting.current = true; setBusy(true); setError(null);
    try {
      await data.store.start(workout.id);
      router.push("/workout/player");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось начать курс. Попробуйте ещё раз.");
    } finally { starting.current = false; setBusy(false); }
  }
  return <View style={{ gap: 18 }}>
    <View style={{ borderRadius: 26, overflow: "hidden", backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
      <CoursePhoto days={summary.days} courseId={courseId} variant={courseVariant(data.profile_sex)} />
      <View style={{ padding: 20, gap: 18 }}>
        <View style={{ gap: 8 }}><Text accessibilityRole="header" style={[s.title, { fontSize: 30 }]}>{summary.title}</Text>
          <Text style={s.muted}>{courseDescription(course)}</Text></View>
        <CourseFacts data={data} courseId={courseId} />
        {progress.completed.length ? <View style={{ gap: 8 }}>
          <Text style={s.link}>{progress.completed.length} из {summary.days} дней завершено</Text>
          <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: summary.days, now: progress.completed.length }} style={{ height: 5, borderRadius: 3, backgroundColor: c.border, overflow: "hidden" }}><View style={{ height: 5, width: `${progress.completed.length / summary.days * 100}%`, backgroundColor: c.accent }} /></View>
        </View> : null}
        <ErrorText message={error} />
        {data.draft ? <Text style={s.small}>Незавершённое занятие: {data.draft.workout.title}</Text> : null}
        {current || data.draft ? <PrimaryButton
          label={busy ? "Подготовка…" : data.draft ? "Продолжить занятие" : !progress.available ? "Следующий день — завтра" : progress.completed.length ? "Продолжить курс" : "Начать курс"}
          disabled={busy || (!data.draft && !progress.available)} onPress={() => void start()} />
          : <Text style={s.title}>Курс пройден! Результаты сохранены в истории.</Text>}
        {current && progress.completed.length ? <Text style={s.small}>День {current.day} · {current.title}</Text> : null}
      </View>
    </View>
    <ActivityPicker compact courseId={courseId} />
    <View style={s.card}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: about }} onPress={() => setAbout(value => !value)} style={s.row}>
        <Text style={[s.link, { flex: 1 }]}>Что понадобится и как заниматься</Text><View style={{ transform: [{ rotate: about ? "180deg" : "0deg" }] }}><Icon name="down" size={17} color={c.accentDark} /></View>
      </Pressable>
      {about ? <View style={{ gap: 10 }}>
        {courseInstructions(course).map(instruction => <Text key={instruction} style={s.muted}>{instruction}</Text>)}
        <Text style={s.muted}>Перед началом — 15 секунд на подготовку. После каждого упражнения — 15–30 секунд отдыха. Кнопка «+20 сек» продлевает ожидание, «Пауза» останавливает таймер.</Text>
        <Text style={s.muted}>После пропуска продолжайте с текущего дня. Не нужно выполнять два дня за один.</Text>
      </View> : null}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Программа курса" accessibilityState={{ expanded: programExpanded }} onPress={() => setProgramExpanded(value => !value)} style={[s.row, { minHeight: 48 }]}>
      <Text style={[s.title, { flex: 1 }]}>Программа курса</Text>
      <Text style={s.small}>{programExpanded ? "Свернуть" : "Развернуть"}</Text>
      <View style={{ transform: [{ rotate: programExpanded ? "180deg" : "0deg" }] }}><Icon name="down" size={17} color={c.accentDark} /></View>
    </Pressable>
    {programExpanded ? <>
      <View style={[s.row, { gap: 6 }]}>{[1, 2, 3, 4].map(n => <Pressable key={n} accessibilityRole="tab" accessibilityState={{ selected: visibleWeek === n }} onPress={() => setWeek(n)} style={{ flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12, backgroundColor: visibleWeek === n ? c.soft : c.surface }}><Text style={[s.small, { color: visibleWeek === n ? c.accentDark : c.muted }]}>{n} неделя</Text></Pressable>)}</View>
      {course.days.filter(day => day.week === visibleWeek).map(day => {
        const done = progress.completed.some(p => p.day === day.day), workout = courseWorkout(data, day.day, undefined, courseId);
        const label = day.kind === "strength" ? "Тренировка" : day.kind === "mobility" ? "Подвижность" : day.kind === "walk" ? "Прогулка" : "Отдых";
        return <Pressable key={day.day} accessibilityRole="button" accessibilityLabel={`День ${day.day}. ${day.title}. ${done ? "Завершён" : "Открыть"}`} onPress={() => open(day.day)} style={[s.card, { borderColor: day.day === progress.day ? c.accent : c.border }]}>
          <View style={s.row}><Text style={[s.link, { width: 30 }]}>{done ? "✓" : String(day.day).padStart(2, "0")}</Text><View style={{ flex: 1, gap: 4 }}><Text style={s.title}>{day.title}</Text><Text style={s.small}>{label}{workout ? ` · ${Math.round(workoutSeconds(workout) / 60)} мин` : day.walk_minutes ? ` · около ${day.walk_minutes} мин` : ""}</Text></View><Text style={s.small}>{done ? "Готово" : day.day === progress.day ? "Текущий" : ""}</Text></View>
        </Pressable>;
      })}
    </> : null}
    {data.course_queue?.filter(item => item.blocked && item.course_id === courseId).map(item => <ErrorText key={item.day} message={`День ${item.day}: ${item.error}`} />)}
  </View>;
}
