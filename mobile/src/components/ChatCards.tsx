import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import type { DayView, Entry } from "../types";
import { BrandMark, Icon } from "./Brand";

export function AssistantLabel() {
  return <View style={s.label}><BrandMark size={18} /><Text style={s.labelText}>ТАРЕЛКА</Text></View>;
}

export function EntryCard({ entry, onCorrect, disabled, fromPhoto, previousCalories, time }: {
  entry: Entry;
  onCorrect: () => void;
  disabled?: boolean;
  fromPhoto?: boolean;
  previousCalories?: number;
  time?: string;
}) {
  const activity = entry.entry_type === "activity";
  const revised = previousCalories !== undefined;
  const details = entry.items?.map((item) => item.name).filter(Boolean).join(", ");
  const caloriesChanged = revised && Math.round(previousCalories) !== Math.round(entry.calories);
  return <View style={s.response}>
    <AssistantLabel />
    <View style={s.card}>
      {activity ? <>
        <View style={s.activityHeading}>
          <View style={s.walk}><Icon name="walk" color={colors.accent} /></View>
          <View style={s.flex}>
            <Text style={s.title}>{entry.title}</Text>
            <Text style={s.description}>{entry.duration_minutes ? `${entry.duration_minutes} минут` : `≈ ${Math.round(entry.calories)} ккал`}</Text>
          </View>
        </View>
        <View style={s.savedRow}>
          <Icon name="check" size={16} color={colors.accent} />
          <Text style={s.saved}>Активность сохранена</Text>
          {time ? <Text style={s.time}>{time}</Text> : null}
        </View>
        <Pressable accessibilityRole="button" disabled={disabled} onPress={onCorrect} style={s.quietEdit}>
          <Text style={s.link}>Уточнить</Text>
        </Pressable>
      </> : <>
        {revised ? <Text style={s.kicker}>Запись · обновлено</Text> : fromPhoto ? <View style={s.photoChip}><Icon name="camera" size={14} color={colors.accent} /><Text style={s.kicker}>Фото</Text></View> : null}
        <Text style={s.title}>{entry.title}</Text>
        {details ? <Text style={s.description}>{details}</Text> : null}
        <View style={s.calorieRow}>
          <Text style={s.approx}>≈</Text>
          <Text style={s.calories}>{Math.round(entry.calories)}</Text>
          <Text style={s.unit}>ккал</Text>
          {caloriesChanged ? <Text style={s.previous}>{Math.round(previousCalories)} ккал</Text> : null}
        </View>
        <View style={s.macros}>
          {[["Б", entry.protein_g], ["Ж", entry.fat_g], ["У", entry.carbs_g]].map(([label, value]) => (
            <Text key={label} style={s.macro}><Text style={s.macroLabel}>{label} </Text>{Math.round(Number(value))} г</Text>
          ))}
        </View>
        <View style={s.divider} />
        {revised ? <View style={s.savedRow}><Icon name="check" size={16} color={colors.accent} /><Text style={s.saved}>Изменения сохранены</Text></View> : <View style={s.between}>
          <Text style={s.caption}>Порция определена примерно</Text>
          <View style={s.savedRow}><Icon name="check" size={16} color={colors.accent} /><Text style={s.saved}>Добавлено в дневник</Text></View>
        </View>}
        <Pressable accessibilityRole="button" disabled={disabled} onPress={onCorrect} style={({ pressed }) => [s.edit, (pressed || disabled) && { opacity: 0.6 }]}>
          <Text style={s.link}>Уточнить порцию</Text>
        </Pressable>
      </>}
    </View>
  </View>;
}

export function DaySummary({ day, onPress }: { day: DayView; onPress: () => void }) {
  const minutes = day.entries.reduce((sum, entry) => sum + (entry.duration_minutes ?? 0), 0);
  return <Pressable accessibilityRole="button" accessibilityLabel="Открыть дневник" onPress={onPress} style={s.summary}>
    <View style={s.between}><Text style={s.summaryTitle}>Твой день</Text><Text style={s.summaryHint}>{new Date(`${day.date}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</Text></View>
    <View style={s.calorieRow}><Text style={s.summaryCalories}>{Math.round(day.balance.consumed).toLocaleString("ru-RU")}</Text><Text style={s.summaryHint}>ккал из еды</Text></View>
    <View style={[s.divider, { backgroundColor: "#3a4f43" }]} />
    <View style={s.between}><View style={s.activityHeading}><Icon name="walk" color={colors.lime} size={22} /><Text style={s.summaryBody}>{minutes ? `${minutes} мин движения` : "Все записи за сегодня"}</Text></View><Icon name="chevron" color={colors.lime} size={20} /></View>
  </Pressable>;
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  response: { gap: 10, maxWidth: 360, width: "100%" },
  label: { flexDirection: "row", gap: 8, alignItems: "center", paddingLeft: 2 },
  labelText: { fontSize: 10, fontWeight: "600", color: colors.muted, letterSpacing: 0.7 },
  card: { borderRadius: 22, backgroundColor: colors.surface, padding: 16, gap: 8 },
  title: { fontSize: 18, fontWeight: "700", color: colors.text },
  description: { fontSize: 13, lineHeight: 20, color: colors.muted },
  kicker: { fontSize: 12, color: colors.muted },
  photoChip: { flexDirection: "row", alignItems: "center", gap: 6 },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  calorieRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 4 },
  approx: { fontSize: 22, fontWeight: "600", color: colors.text },
  calories: { color: colors.text, fontSize: 34, fontWeight: "700", letterSpacing: -0.6 },
  unit: { color: colors.muted, fontSize: 16 },
  previous: { marginLeft: 6, color: colors.muted, fontSize: 14, textDecorationLine: "line-through" },
  caption: { fontSize: 12, color: colors.muted, lineHeight: 16, flexShrink: 1 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  macros: { flexDirection: "row", gap: 16, marginTop: 2 },
  macro: { color: colors.text, fontSize: 15, fontWeight: "600" },
  macroLabel: { color: colors.muted, fontWeight: "500" },
  edit: { backgroundColor: colors.soft, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 16, alignItems: "center", minHeight: 48, justifyContent: "center", marginTop: 4 },
  link: { color: colors.accentDark, fontSize: 14, fontWeight: "600" },
  quietEdit: { alignSelf: "flex-start", minHeight: 36, justifyContent: "center" },
  activityHeading: { flexDirection: "row", gap: 12, alignItems: "center" },
  walk: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.soft },
  savedRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  saved: { color: colors.accentDark, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  time: { marginLeft: "auto", fontSize: 11, color: colors.muted },
  summary: { padding: 18, gap: 13, borderRadius: 22, backgroundColor: colors.text, marginTop: 2 },
  summaryTitle: { fontSize: 18, color: "white", fontWeight: "700" },
  summaryHint: { fontSize: 11, color: "#bdd0c2" },
  summaryCalories: { fontSize: 30, color: "white", fontWeight: "700" },
  summaryBody: { fontSize: 13, color: "white" },
});
