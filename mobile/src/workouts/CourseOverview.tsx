import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { colors as c } from "../theme";
import { ErrorText, PrimaryButton } from "../ui";
import { useWorkouts } from "./context";
import { activityLevels, courseState, courseWorkout } from "./course";
import { s } from "./ui";

export function useCourseClock() {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => { const timer = setInterval(() => setNow(new Date().toISOString()), 30000); return () => clearInterval(timer); }, []);
  return now;
}

export function ActivityPicker() {
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
    <Text style={s.small}>Меняется только время основной части. С третьей недели +5 секунд у знакомых движений; в день 26 — исходное время. Отдых — 30 секунд, его можно продлить. Разминка, растяжка и восстановление одинаковые.</Text>
    {draft ? <Text style={s.small}>Выбор применится к следующему занятию. Текущее сохранит свою нагрузку.</Text> : null}
    <ErrorText message={error} />
  </View>;
}

export function CourseOverview() {
  const data = useWorkouts(), now = useCourseClock();
  const progress = courseState(data, now), course = data.catalogue!.course!;
  const [week, setWeek] = useState<number | null>(null);
  const visibleWeek = week ?? Math.min(4, Math.ceil(progress.day / 7));
  const current = course.days.find(d => d.day === progress.day);
  function open(day: number) {
    const workout = courseWorkout(data, day);
    if (workout) router.push({ pathname: "/workout/[id]", params: { id: workout.id } });
    else router.push({ pathname: "/workout/course/[day]", params: { day: String(day) } });
  }
  return <View style={{ gap: 18 }}>
    <View style={[s.card, { backgroundColor: "#e7f0dc" }]}>
      <Text style={s.small}>4 НЕДЕЛИ · БЕСПЛАТНО</Text><Text style={[s.title, { fontSize: 26 }]}>{course.title}</Text>
      <Text style={s.muted}>12 тренировок, прогулки и дни восстановления. Знакомые движения с постепенным увеличением времени.</Text>
      <Text style={s.link}>{progress.completed.length} из 28 дней завершено</Text>
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 28, now: progress.completed.length }} style={{ height: 6, borderRadius: 3, backgroundColor: c.border, overflow: "hidden" }}><View style={{ height: 6, width: `${progress.completed.length / 28 * 100}%`, backgroundColor: c.accent }} /></View>
      {current ? <><Text style={s.title}>День {current.day} · {current.title}</Text><Text style={s.muted}>{progress.available ? "Следующий шаг вашего курса" : "На сегодня всё. Следующий день откроется завтра."}</Text><PrimaryButton label={progress.available ? "Открыть текущий день" : "Посмотреть следующий день"} onPress={() => open(current.day)} /></> : <Text style={s.title}>Курс пройден! Результаты сохранены в истории.</Text>}
    </View>
    <ActivityPicker />
    <Text style={s.small}>Для занятий нужны коврик, свободная стена и устойчивый стул без колёс. Обратные отжимания от стула остаются в программе.</Text>
    <View style={[s.row, { gap: 6 }]}>{[1, 2, 3, 4].map(n => <Pressable key={n} accessibilityRole="tab" accessibilityState={{ selected: visibleWeek === n }} onPress={() => setWeek(n)} style={{ flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12, backgroundColor: visibleWeek === n ? c.soft : c.surface }}><Text style={[s.small, { color: visibleWeek === n ? c.accentDark : c.muted }]}>{n} неделя</Text></Pressable>)}</View>
    {course.days.filter(day => day.week === visibleWeek).map(day => {
      const done = progress.completed.some(p => p.day === day.day), workout = courseWorkout(data, day.day);
      const label = day.kind === "strength" ? "Тренировка" : day.kind === "mobility" ? "Подвижность" : day.kind === "walk" ? "Прогулка" : "Отдых";
      return <Pressable key={day.day} accessibilityRole="button" accessibilityLabel={`День ${day.day}. ${day.title}. ${done ? "Завершён" : "Открыть"}`} onPress={() => open(day.day)} style={[s.card, { borderColor: day.day === progress.day ? c.accent : c.border }]}>
        <View style={s.row}><Text style={[s.link, { width: 30 }]}>{done ? "✓" : String(day.day).padStart(2, "0")}</Text><View style={{ flex: 1, gap: 4 }}><Text style={s.title}>{day.title}</Text><Text style={s.small}>{label}{workout ? ` · ${Math.round(workout.duration_seconds / 60)} мин` : day.walk_minutes ? ` · около ${day.walk_minutes} мин` : ""}</Text></View><Text style={s.small}>{done ? "Готово" : day.day === progress.day ? "Текущий" : ""}</Text></View>
      </Pressable>;
    })}
    <Text style={s.small}>После пропуска продолжайте с текущего дня. Не нужно выполнять два дня за один. Если основная часть пропущена или завершена досрочно, день можно повторить. Дополнительные подходы в дни 22 и 24 необязательны.</Text>
    {data.course_queue?.filter(item => item.blocked).map(item => <ErrorText key={item.day} message={`День ${item.day}: ${item.error}`} />)}
  </View>;
}
