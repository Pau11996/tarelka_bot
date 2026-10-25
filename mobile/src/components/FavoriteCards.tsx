import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { grams, kcal, ml } from "../format";
import { colors } from "../theme";
import type { Favorite } from "../types";
import { Icon } from "./Brand";

const macros = [
  { key: "protein_g", label: "Б", name: "Белки", color: "#3776a2", background: "#edf4fa" },
  { key: "fat_g", label: "Ж", name: "Жиры", color: "#946821", background: "#faf3e7" },
  { key: "carbs_g", label: "У", name: "Углеводы", color: colors.accent, background: "#edf5ec" },
] as const;

function appearance(item: Favorite) {
  if (item.entry_type === "water") return { color: "#3776a2", background: "#edf4fa", label: "Вода" };
  if (item.entry_type === "activity") return { color: "#946821", background: "#faf3e7", label: "Активность" };
  return { color: colors.accent, background: colors.soft, label: "Еда" };
}

function summary(item: Favorite) {
  if (item.entry_type === "water") return ml(item.volume_ml ?? 0);
  if (item.entry_type === "activity") return `${item.duration_minutes != null ? `${item.duration_minutes} мин · ` : ""}${kcal(item.calories)} сожжено`;
  return kcal(item.calories);
}

function Illustration({ item }: { item: Favorite }) {
  const { background, color } = appearance(item);
  return (
    <View accessible={false} style={[s.illustration, { backgroundColor: background }]}>
      <Icon name={item.entry_type === "meal" ? "bowl" : item.entry_type === "water" ? "drop" : "walk"} color={color} size={23} />
    </View>
  );
}

export function FavoriteCard({ item, disabled, busy, onOpen, onLog }: {
  item: Favorite;
  disabled: boolean;
  busy: boolean;
  onOpen: () => void;
  onLog: () => void;
}) {
  const { color } = appearance(item);
  return (
    <View style={s.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Открыть избранное: ${item.title}`}
        onPress={onOpen}
        style={({ pressed }) => [s.cardBody, pressed && { opacity: 0.65 }]}
      >
        <Illustration item={item} />
        <View style={s.cardText}>
          <Text numberOfLines={2} style={s.cardTitle}>{item.title}</Text>
          <Text style={[s.summary, { color }]}>{summary(item)}</Text>
          {item.entry_type === "meal" ? (
            <View style={s.macros}>
              {macros.map(({ key, label, name, color: tint, background }) => (
                <View key={key} accessible accessibilityLabel={`${name}: ${grams(item[key])}`} style={[s.badge, { backgroundColor: background }]}>
                  <Text style={[s.badgeText, { color: tint }]}>{label} {Math.round(item[key])}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Добавить на сегодня: ${item.title}`}
        accessibilityState={{ disabled, busy }}
        disabled={disabled}
        onPress={(event) => { event.stopPropagation(); onLog(); }}
        style={({ pressed }) => [s.add, (pressed || disabled) && { opacity: 0.5 }]}
      >
        <View style={s.addCircle}>
          {busy ? <ActivityIndicator size="small" color={colors.accent} /> : <Icon name="plus" size={19} color={colors.accent} />}
        </View>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingRight: 6, overflow: "hidden" },
  cardBody: { flex: 1, minWidth: 0, minHeight: 78, flexDirection: "row", alignItems: "flex-start", gap: 11, padding: 12 },
  illustration: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardText: { flex: 1, minWidth: 0, gap: 4 },
  cardTitle: { color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  summary: { fontSize: 12, lineHeight: 17, fontWeight: "600", fontVariant: ["tabular-nums"] },
  macros: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  badgeText: { fontSize: 10, lineHeight: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
  add: { width: 44, alignSelf: "stretch", minHeight: 44, alignItems: "center", justifyContent: "center" },
  addCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center" },
});
