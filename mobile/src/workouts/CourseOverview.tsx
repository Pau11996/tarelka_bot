import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { colors as c } from "../theme";
import { ErrorText, PrimaryButton } from "../ui";
import { Icon } from "../components/Brand";
import { useWorkouts } from "./context";
import { activityLevels, courseState, courseSummary, courseWorkout } from "./course";
import { CourseFacts, CoursePhoto } from "./CourseCard";
import { s } from "./ui";

export function useCourseClock() {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => { const timer = setInterval(() => setNow(new Date().toISOString()), 30000); return () => clearInterval(timer); }, []);
  return now;
}

export function ActivityPicker({ compact = false }: { compact?: boolean }) {
  const { store, settings, draft } = useWorkouts();
  const [error, setError] = useState<string | null>(null);
  return <View style={{ gap: 10 }}>
    <Text style={s.title}>Нагрузка</Text>
    <View style={[s.row, { gap: 6 }]}>{activityLevels.map(level => {
      const selected = (settings.activity_level ?? "medium") === level.id;
      return <Pressable key={level.id} accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => {
        setError(null); void store.setSettings({ ...settings, activity_level: level.id }).catch(e => setError(e.message));
      }} style={{ flex: 1, paddingVertical: 14, paddingHorizontal: 4, borderRadius: 16, alignItems: "center", gap: 5, backgroundColor: selected ? c.soft : c.surface, borderColor: selected ? c.accent : c.border, borderWidth: 1 }}>
        <Text style={[s.body, { fontSize: 12, fontWeight: "600", color: selected ? c.accentDark : c.text }]}>{level.title}</Text>
        <Text style={s.small}>{level.seconds} сек</Text>
      </Pressable>;
    })}</View>
    {!compact ? <Text style={s.small}>Меняется только время основной части. С третьей недели +5 секунд у знакомых движений; в день 26 — исходное время. Отдых — 30 секунд, его можно продлить. Разминка, растяжка и восстановление одинаковые.</Text> : null}
    {draft ? <Text style={s.small}>Выбор применится к следующему занятию. Текущее сохранит свою нагрузку.</Text> : null}
    <ErrorText message={error} />
  </View>;
}

export function CourseOverview() {
  const data = useWorkouts(), now = useCourseClock();
  const progress = courseState(data, now), course = data.catalogue!.course!;
  const summary = courseSummary(data)!;
  const [week, setWeek] = useState<number | null>(null);
  const [about, setAbout] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const starting = useRef(false);
  const visibleWeek = week ?? Math.min(4, Math.ceil(progress.day / 7));
  const current = course.days.find(d => d.day === progress.day);
  function open(day: number) {
    const workout = courseWorkout(data, day);
    if (workout) router.push({ pathname: "/workout/[id]", params: { id: workout.id } });
    else router.push({ pathname: "/workout/course/[day]", params: { day: String(day) } });
  }
  async function start() {
    if (starting.current) return;
    if (data.draft) { router.push("/workout/player"); return; }
    if (!current || !progress.available) return;
    const workout = courseWorkout(data, current.day);
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
      <CoursePhoto days={summary.days} />
      <View style={{ padding: 20, gap: 18 }}>
        <View style={{ gap: 8 }}><Text accessibilityRole="header" style={[s.title, { fontSize: 30 }]}>{summary.title}</Text>
          <Text style={s.muted}>Тренировки для всего тела, прогулки и восстановление — в своём темпе.</Text></View>
        <CourseFacts data={data} />
        {progress.completed.length ? <View style={{ gap: 8 }}>
          <Text style={s.link}>{progress.completed.length} из {summary.days} дней завершено</Text>
          <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: summary.days, now: progress.completed.length }} style={{ height: 5, borderRadius: 3, backgroundColor: c.border, overflow: "hidden" }}><View style={{ height: 5, width: `${progress.completed.length / summary.days * 100}%`, backgroundColor: c.accent }} /></View>
        </View> : null}
        <ErrorText message={error} />
        {current || data.draft ? <PrimaryButton
          label={busy ? "Подготовка…" : data.draft ? "Продолжить занятие" : !progress.available ? "Следующий день — завтра" : progress.completed.length ? "Продолжить курс" : "Начать курс"}
          disabled={busy || (!data.draft && !progress.available)} onPress={() => void start()} />
          : <Text style={s.title}>Курс пройден! Результаты сохранены в истории.</Text>}
        {current && progress.completed.length ? <Text style={s.small}>День {current.day} · {current.title}</Text> : null}
      </View>
    </View>
    <ActivityPicker compact />
    <View style={s.card}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: about }} onPress={() => setAbout(value => !value)} style={s.row}>
        <Text style={[s.link, { flex: 1 }]}>Что понадобится и как заниматься</Text><View style={{ transform: [{ rotate: about ? "180deg" : "0deg" }] }}><Icon name="down" size={17} color={c.accentDark} /></View>
      </Pressable>
      {about ? <View style={{ gap: 10 }}>
        <Text style={s.muted}>Коврик, свободная стена и устойчивый стул без колёс. Все занятия можно выполнять дома.</Text>
        <Text style={s.muted}>Силовые занятия чередуются с прогулками, подвижностью и отдыхом. Нагрузка меняет время упражнений; отдых можно продлить.</Text>
        <Text style={s.muted}>После пропуска продолжайте с текущего дня. Не нужно выполнять два дня за один. Дополнительные подходы необязательны.</Text>
      </View> : null}
    </View>
    <Text accessibilityRole="header" style={s.title}>Программа курса</Text>
    <View style={[s.row, { gap: 6 }]}>{[1, 2, 3, 4].map(n => <Pressable key={n} accessibilityRole="tab" accessibilityState={{ selected: visibleWeek === n }} onPress={() => setWeek(n)} style={{ flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12, backgroundColor: visibleWeek === n ? c.soft : c.surface }}><Text style={[s.small, { color: visibleWeek === n ? c.accentDark : c.muted }]}>{n} неделя</Text></Pressable>)}</View>
    {course.days.filter(day => day.week === visibleWeek).map(day => {
      const done = progress.completed.some(p => p.day === day.day), workout = courseWorkout(data, day.day);
      const label = day.kind === "strength" ? "Тренировка" : day.kind === "mobility" ? "Подвижность" : day.kind === "walk" ? "Прогулка" : "Отдых";
      return <Pressable key={day.day} accessibilityRole="button" accessibilityLabel={`День ${day.day}. ${day.title}. ${done ? "Завершён" : "Открыть"}`} onPress={() => open(day.day)} style={[s.card, { borderColor: day.day === progress.day ? c.accent : c.border }]}>
        <View style={s.row}><Text style={[s.link, { width: 30 }]}>{done ? "✓" : String(day.day).padStart(2, "0")}</Text><View style={{ flex: 1, gap: 4 }}><Text style={s.title}>{day.title}</Text><Text style={s.small}>{label}{workout ? ` · ${Math.round(workout.duration_seconds / 60)} мин` : day.walk_minutes ? ` · около ${day.walk_minutes} мин` : ""}</Text></View><Text style={s.small}>{done ? "Готово" : day.day === progress.day ? "Текущий" : ""}</Text></View>
      </Pressable>;
    })}
    {data.course_queue?.filter(item => item.blocked).map(item => <ErrorText key={item.day} message={`День ${item.day}: ${item.error}`} />)}
  </View>;
}
