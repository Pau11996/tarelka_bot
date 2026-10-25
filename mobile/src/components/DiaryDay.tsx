import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { router } from "expo-router";
import { diaryChronicle, diaryMonth, diaryProgress, diaryWeek, dayNutrient, moveDiaryMonth, streakLabel } from "../diary";
import { shiftDay } from "../chartMath";
import { formatDay, grams, kcal, mealHeading, ml } from "../format";
import { colors } from "../theme";
import type { DayView, Entry } from "../types";
import { Icon, type IconName } from "./Brand";
import { FavoriteButton } from "./FavoriteButton";

const weekdays = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];
const macros = [
  { key: "protein_g", label: "Белки", color: "#3776a2", track: "#edf4fa" },
  { key: "fat_g", label: "Жиры", color: "#946821", track: "#faf3e7" },
  { key: "carbs_g", label: "Углеводы", color: colors.accent, track: "#edf5ec" },
] as const;
const additional = [
  { key: "fiber_g", label: "Клетчатка", icon: "leaf", color: "#557645" },
  { key: "sugar_g", label: "Сахар", icon: "cube", color: "#a17848" },
] as const;

const decimalGrams = (value: number) => `${value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} г`;
const monthName = (month: string) => new Date(`${month}-01T12:00:00Z`).toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" });

function CalendarButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={s.calendarArrow}><Icon name={icon} size={19} color={colors.muted} /></Pressable>;
}

export function StreakBadge({ value }: { value: number | null | undefined }) {
  const label = typeof value === "number" && value >= 0 ? streakLabel(value) : "—";
  return (
    <View accessible accessibilityLabel={`Серия записей: ${label}`} style={s.streak}>
      <Icon name="trophy" size={18} color="#946821" />
      <Text style={s.streakText}>{label}</Text>
    </View>
  );
}

export function DiaryCalendar({ selected, entryDates, isToday, onSelect, onToday }: {
  selected: string;
  entryDates: string[];
  isToday: boolean;
  onSelect: (date: string) => void;
  onToday: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [month, setMonth] = useState(selected.slice(0, 7));
  const recorded = new Set(entryDates);
  const choose = (value: string) => { onSelect(value); setExpanded(false); };
  return (
    <View style={s.calendar}>
      <View style={s.calendarHeading}>
        <Pressable accessibilityRole="button" accessibilityLabel="Открыть календарь" accessibilityState={{ expanded }} onPress={() => {
          setMonth(selected.slice(0, 7)); setExpanded(!expanded);
        }} style={s.monthButton}>
          <Text style={s.monthName}>{monthName(selected.slice(0, 7))}</Text>
          <Icon name="down" size={14} color={colors.muted} />
        </Pressable>
        {!isToday ? <Pressable accessibilityRole="button" onPress={onToday} style={s.todayButton}><Text style={s.link}>Сегодня</Text></Pressable> : null}
        <CalendarButton icon="left" label="Предыдущая неделя" onPress={() => onSelect(shiftDay(selected, -7))} />
        <CalendarButton icon="chevron" label="Следующая неделя" onPress={() => onSelect(shiftDay(selected, 7))} />
      </View>
      <View style={s.week}>
        {diaryWeek(selected).map((value, index) => (
          <Pressable key={value} accessibilityRole="button" accessibilityLabel={`Выбрать ${formatDay(value)}${recorded.has(value) ? ", есть записи" : ""}`} accessibilityState={{ selected: value === selected }} onPress={() => choose(value)} style={s.weekDay}>
            <Text style={s.weekLabel}>{weekdays[index]}</Text>
            <View style={[s.dayNumber, recorded.has(value) && s.dayRecorded, value === selected && s.daySelected]}>
              <Text style={[s.dayText, value === selected && s.dayTextSelected]}>{Number(value.slice(8))}</Text>
            </View>
            <View style={[s.dayDot, { backgroundColor: recorded.has(value) ? colors.accent : "transparent" }]} />
          </Pressable>
        ))}
      </View>
      {expanded ? (
        <View style={s.monthPanel}>
          <View style={s.calendarHeading}>
            <CalendarButton icon="left" label="Предыдущий месяц" onPress={() => setMonth(moveDiaryMonth(month, -1))} />
            <Text style={[s.monthName, { flex: 1, textAlign: "center" }]}>{monthName(month)}</Text>
            <CalendarButton icon="chevron" label="Следующий месяц" onPress={() => setMonth(moveDiaryMonth(month, 1))} />
          </View>
          <View style={s.monthGrid}>
            {weekdays.map((value) => <Text key={value} style={s.monthWeekday}>{value}</Text>)}
            {diaryMonth(month).map((value, index) => value ? (
              <Pressable key={value} accessibilityRole="button" accessibilityLabel={`Календарь: ${formatDay(value)}${recorded.has(value) ? ", есть записи" : ""}`} accessibilityState={{ selected: value === selected }} onPress={() => choose(value)} style={s.monthDay}>
                <View style={[s.dayNumber, value === selected && s.daySelected]}><Text style={[s.dayText, value === selected && s.dayTextSelected]}>{Number(value.slice(8))}</Text></View>
                <View style={[s.dayDot, { backgroundColor: recorded.has(value) ? colors.accent : "transparent" }]} />
              </Pressable>
            ) : <View key={`blank-${index}`} style={s.monthDay} />)}
          </View>
          <Pressable accessibilityRole="button" onPress={() => { onToday(); setExpanded(false); }} style={s.todayButton}><Text style={s.link}>Вернуться к сегодняшнему дню</Text></Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function DiaryEnergy({ day }: { day: DayView }) {
  const target = day.balance.target + day.balance.activity_bonus;
  const progress = diaryProgress(day.balance.consumed, target);
  const over = day.balance.remaining < 0;
  const radius = 35;
  const circumference = 2 * Math.PI * radius;
  return (
    <View style={s.energyCard}>
      <View style={s.energyTop}>
        <View style={s.energyNumbers}>
          <Text style={s.muted}>{over ? "Выше текущей цели" : "Осталось на день"}</Text>
          <Text style={[s.energyValue, over && { color: colors.danger }]}>{Math.round(Math.abs(day.balance.remaining)).toLocaleString("ru-RU")} <Text style={s.energyUnit}>ккал</Text></Text>
        </View>
        <View style={s.ring} accessible accessibilityRole="progressbar" accessibilityLabel="Калории за день" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100), text: `${kcal(day.balance.consumed)} из ${kcal(target)}` }}>
          <Svg width={84} height={84} viewBox="0 0 84 84">
            <Circle cx={42} cy={42} r={radius} fill="none" stroke={colors.soft} strokeWidth={7} />
            {progress > 0 ? <Circle cx={42} cy={42} r={radius} fill="none" stroke={over ? colors.danger : colors.accent} strokeWidth={7} strokeLinecap="round" strokeDasharray={`${circumference * progress} ${circumference}`} transform="rotate(-90 42 42)" /> : null}
          </Svg>
          <Text style={[s.ringText, over && { color: colors.danger }]}>{Math.round(progress * 100)}%</Text>
        </View>
      </View>
      <Text style={s.energyHint}>Записано {kcal(day.balance.consumed)} · цель {kcal(day.balance.target)}{day.balance.activity_bonus > 0 ? ` + ${kcal(day.balance.activity_bonus)} за активность` : ""}</Text>
    </View>
  );
}

export function DiaryNutrients({ day }: { day: DayView }) {
  const details = additional.map((nutrient) => ({ ...nutrient, ...dayNutrient(day.entries, nutrient.key), target: day.nutrient_targets.micronutrients[nutrient.key] }));
  return (
    <View style={s.nutrientCard}>
      <View style={s.macros}>
        {macros.map(({ key, label, color, track }) => {
          const target = day.nutrient_targets[key];
          return (
            <View key={key} style={s.macro} accessible accessibilityLabel={`${label}: ${grams(day.balance[key])}${target > 0 ? ` из ${grams(target)}` : ""}`}>
              <Text style={s.nutrientLabel}>{label}</Text>
              <Text style={s.macroAmount}>{Math.round(day.balance[key])}{target > 0 ? ` / ${grams(target)}` : " г"}</Text>
              <View style={[s.track, { backgroundColor: track }]}><View style={[s.fill, { width: `${diaryProgress(day.balance[key], target) * 100}%`, backgroundColor: color }]} /></View>
            </View>
          );
        })}
      </View>
      <View style={s.additional}>
        {details.map(({ key, label, icon, color, value, target, partial }) => (
          <View key={key} style={s.additionalItem} accessible accessibilityLabel={`${label}: ${value === null ? "нет данных" : decimalGrams(value)}${target > 0 ? `, ${key === "sugar_g" ? "дневной ориентир до" : "дневная цель"} ${decimalGrams(target)}` : ""}${partial ? ", данные неполные" : ""}`}>
            <View style={s.nutrientHeading}><Icon name={icon} size={15} color={color} /><Text style={s.nutrientLabel}>{label}</Text></View>
            <Text style={s.additionalAmount}>{value === null ? "—" : value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}<Text style={s.additionalTarget}>{target > 0 ? ` / ${decimalGrams(target)}` : " г"}</Text></Text>
            <View style={s.track}><View style={[s.fill, { width: `${diaryProgress(value ?? 0, target) * 100}%`, backgroundColor: color }]} /></View>
            {value === null ? <Text style={s.nutrientHint}>Нет данных</Text> : null}
          </View>
        ))}
      </View>
      {details.filter((item) => item.partial).map((item) => <Text key={item.key} style={s.partial}>Неполный итог ({item.label.toLowerCase()}): данные есть в {item.recorded} из {item.meals} записей еды.</Text>)}
    </View>
  );
}

export function DiaryHabits({ day }: { day: DayView }) {
  const activities = day.entries.filter((entry) => entry.entry_type === "activity");
  const minutes = activities.reduce((sum, entry) => sum + (entry.duration_minutes ?? 0), 0);
  return <View style={s.habits}>
    <View style={s.habit}><Icon name="drop" size={21} color="#3776a2" /><View style={s.habitText}><Text style={s.habitLabel}>Вода</Text><Text style={s.habitAmount}>{ml(day.balance.water_ml ?? 0)}</Text></View></View>
    <View style={s.habit}><Icon name="walk" size={21} color="#946821" /><View style={s.habitText}><Text style={s.habitLabel}>Активность</Text><Text style={s.habitAmount}>{activities.length ? `${minutes ? `${minutes} мин · ` : ""}${kcal(day.balance.activity_bonus)}` : "Пока нет записей"}</Text></View></View>
  </View>;
}

function entryTime(entry: Entry) {
  if (!entry.created_at || !Number.isFinite(Date.parse(entry.created_at))) return "—";
  return new Date(entry.created_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function DiaryChronicle({ entries, onFavoriteChange }: { entries: Entry[]; onFavoriteChange: (id: number, favoriteId: number | null) => void }) {
  const rows = diaryChronicle(entries);
  return (
    <View style={s.chronicle}>
      <View style={s.chronicleHeading}><Text accessibilityRole="header" style={s.chronicleTitle}>Хроника дня</Text><Pressable accessibilityRole="button" accessibilityLabel="Добавить запись в чате" onPress={() => router.push("/(tabs)/chat")} style={s.addButton}><Icon name="plus" size={15} color={colors.accentDark} /><Text style={s.link}>В чат</Text></Pressable></View>
      {!rows.length ? <View style={s.empty}><Text style={s.emptyTitle}>День начинается с первой записи</Text><Text style={s.muted}>Отправьте фото еды, напишите про воду или прогулку в чате.</Text></View> : null}
      {rows.map((entry, index) => {
        const water = entry.entry_type === "water", activity = entry.entry_type === "activity";
        const accent = water ? "#3776a2" : activity ? "#946821" : colors.accent;
        const category = water ? "Вода" : activity ? "Активность" : mealHeading("", entry.meal_slot).replace(/\s*·\s*$/, "") || "Приём пищи";
        return <View key={entry.id} style={s.chronicleRow}>
          <Text style={s.time}>{entryTime(entry)}</Text>
          <View style={s.rail}><View style={[s.railLine, index === rows.length - 1 && { bottom: "50%" }, index === 0 && { top: "50%" }]} /><View style={[s.railDot, { borderColor: accent }]} /></View>
          <View style={s.entryCard}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Открыть запись: ${entry.title}`} onPress={() => router.push(`/entry/${entry.id}`)} style={s.entryBody}>
              <View style={s.entryText}><Text style={s.entryTitle}>{entry.title}</Text>{!water ? <Text style={s.entrySubtitle}>{category}{activity && entry.duration_minutes != null ? ` · ${entry.duration_minutes} мин` : ""}</Text> : null}</View>
              <View style={s.entryAmount}><Text style={[s.entryNumber, { color: accent }]}>{Math.round(water ? entry.volume_ml ?? 0 : entry.calories).toLocaleString("ru-RU")}</Text><Text style={s.entrySubtitle}>{water ? "мл" : activity ? "ккал сожжено" : "ккал"}</Text></View>
            </Pressable>
            <FavoriteButton entryId={entry.id} favoriteId={entry.favorite_id} onChange={(favoriteId) => onFavoriteChange(entry.id, favoriteId)} />
          </View>
        </View>;
      })}
      {rows.length > 0 && !rows.some((entry) => entry.entry_type === "activity") ? <Text style={s.activityHint}>Активность пока не записана. Добавьте прогулку или тренировку в чате.</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  calendar: { gap: 3 },
  calendarHeading: { flexDirection: "row", alignItems: "center", gap: 2 },
  monthButton: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6 },
  monthName: { color: colors.text, fontSize: 12, fontWeight: "600", textTransform: "capitalize" },
  calendarArrow: { width: 36, height: 44, alignItems: "center", justifyContent: "center" },
  todayButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  link: { color: colors.accentDark, fontSize: 12, fontWeight: "600" },
  week: { flexDirection: "row", gap: 2 },
  weekDay: { flex: 1, alignItems: "center", gap: 6, paddingVertical: 3 },
  weekLabel: { color: colors.muted, fontSize: 10, lineHeight: 14 },
  dayNumber: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dayRecorded: { backgroundColor: "#edf3e8" },
  daySelected: { backgroundColor: colors.accent },
  dayText: { fontSize: 14, fontWeight: "600", color: colors.text },
  dayTextSelected: { color: "white" },
  dayDot: { width: 4, height: 4, borderRadius: 2 },
  monthPanel: { marginTop: 8, borderRadius: 18, padding: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 6 },
  monthGrid: { flexDirection: "row", flexWrap: "wrap" },
  monthWeekday: { width: "14.2857%", textAlign: "center", fontSize: 10, color: colors.muted, paddingVertical: 8 },
  monthDay: { width: "14.2857%", minHeight: 49, alignItems: "center", justifyContent: "center", gap: 2 },
  streak: { backgroundColor: "#faf3e7", paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16, flexDirection: "row", alignItems: "center", gap: 6 },
  streakText: { color: "#946821", fontSize: 12, fontWeight: "600" },
  energyCard: { padding: 16, backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border, gap: 9 },
  energyTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  energyNumbers: { flex: 1, minWidth: 0, gap: 6 },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  energyValue: { color: colors.text, fontSize: 34, lineHeight: 44, fontWeight: "700", letterSpacing: -1, fontVariant: ["tabular-nums"] },
  energyUnit: { color: colors.muted, fontSize: 13, fontWeight: "400", letterSpacing: 0 },
  energyHint: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  ring: { width: 84, height: 84, alignItems: "center", justifyContent: "center" },
  ringText: { position: "absolute", color: colors.accentDark, fontSize: 15, fontWeight: "700" },
  nutrientCard: { backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 12 },
  macros: { flexDirection: "row", gap: 12 },
  macro: { flex: 1, minWidth: 0, gap: 6 },
  nutrientLabel: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  macroAmount: { color: colors.text, fontSize: 12, lineHeight: 17, fontWeight: "600", fontVariant: ["tabular-nums"] },
  track: { height: 4, borderRadius: 3, backgroundColor: "#edf1e8", overflow: "hidden" },
  fill: { height: "100%", borderRadius: 3 },
  additional: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, flexDirection: "row", gap: 16 },
  additionalItem: { flex: 1, minWidth: 0, gap: 6 },
  nutrientHeading: { flexDirection: "row", alignItems: "center", gap: 5 },
  additionalAmount: { fontSize: 18, lineHeight: 24, color: colors.text, fontWeight: "600", fontVariant: ["tabular-nums"] },
  additionalTarget: { fontSize: 12, lineHeight: 18, color: colors.muted, fontWeight: "400" },
  nutrientHint: { fontSize: 10, lineHeight: 15, color: colors.muted },
  partial: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  habits: { flexDirection: "row", gap: 10 },
  habit: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8, padding: 11, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  habitText: { flex: 1, minWidth: 0, gap: 4 },
  habitLabel: { fontSize: 10, color: colors.muted },
  habitAmount: { fontSize: 11, lineHeight: 16, fontWeight: "600", color: colors.text },
  chronicle: { gap: 0, marginTop: 2 },
  chronicleHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 },
  chronicleTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  addButton: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 8 },
  chronicleRow: { flexDirection: "row", alignItems: "stretch", minHeight: 82 },
  time: { width: 39, paddingTop: 27, fontSize: 10, color: colors.muted },
  rail: { width: 18, alignItems: "center", justifyContent: "center", paddingBottom: 10 },
  railLine: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: "#d1dec8" },
  railDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, backgroundColor: colors.bg },
  entryCard: { flex: 1, minWidth: 0, marginLeft: 7, marginBottom: 10, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", paddingRight: 3 },
  entryBody: { flex: 1, minWidth: 0, minHeight: 70, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 11, paddingVertical: 12 },
  entryText: { flex: 1, minWidth: 0, gap: 5 },
  entryTitle: { color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  entrySubtitle: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  entryAmount: { alignItems: "flex-end", gap: 3 },
  entryNumber: { fontSize: 14, lineHeight: 19, fontWeight: "600", fontVariant: ["tabular-nums"] },
  empty: { padding: 18, backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  activityHint: { color: colors.muted, fontSize: 11, lineHeight: 17, paddingTop: 6 },
});
