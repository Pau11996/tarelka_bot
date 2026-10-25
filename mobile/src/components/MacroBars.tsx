import { StyleSheet, Text, View } from "react-native";
import { grams } from "../format";
import { colors } from "../theme";

type Macros = { protein_g: number; fat_g: number; carbs_g: number };

const nutrients = [
  { key: "protein_g", label: "Белки", color: "#6f8dac", track: "#eff4f9" },
  { key: "fat_g", label: "Жиры", color: "#b1905d", track: "#faf4e9" },
  { key: "carbs_g", label: "Углеводы", color: "#819960", track: "#f0f5e8" },
] as const;

export function MacroProgress({ values, targets }: { values: Macros; targets: Macros }) {
  return (
    <View style={s.progressGroup}>
      <Text style={s.heading}>БЖУ за день</Text>
      {nutrients.map(({ key, label, color, track }) => {
        const target = targets[key];
        const progress = target > 0 ? Math.max(0, Math.min(100, values[key] / target * 100)) : 0;
        const amount = target > 0
          ? `${Math.round(values[key])} / ${grams(target)}`
          : grams(values[key]);
        return (
          <View
            key={key}
            style={s.progressRow}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={label}
            accessibilityValue={{
              min: 0,
              max: 100,
              now: progress,
              text: target > 0 ? `${grams(values[key])} из ${grams(target)}` : `${grams(values[key])}, цель не задана`,
            }}
          >
            <View style={s.row}>
              <Text style={s.label}>{label}</Text>
              <Text style={s.amount}>{amount}</Text>
            </View>
            <View style={[s.track, { backgroundColor: track }]}>
              <View style={[s.fill, { backgroundColor: color, width: `${progress}%` }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function MacroComposition({ values, micronutrients }: {
  values: Macros;
  micronutrients?: Record<string, number> | null;
}) {
  const total = nutrients.reduce((sum, { key }) => sum + Math.max(0, values[key]), 0);
  const additionalNutrients = [
    { key: "fiber_g", label: "Клетчатка" },
    { key: "sugar_g", label: "Сахар" },
  ].filter(({ key }) => micronutrients?.[key] != null);
  return (
    <View style={s.composition}>
      <Text style={s.heading}>БЖУ в порции</Text>
      <View style={[s.track, s.compositionTrack]} accessible={false}>
        {total > 0 ? nutrients.map(({ key, color }) => (
          <View
            key={key}
            style={{ height: "100%", width: `${Math.max(0, values[key]) / total * 100}%`, backgroundColor: color }}
          />
        )) : null}
      </View>
      <View style={s.legend}>
        {nutrients.map(({ key, label, color }) => (
          <View key={key} style={s.legendItem} accessible accessibilityLabel={`${label}: ${grams(values[key])}`}>
            <View style={s.legendLabel}>
              <View style={[s.dot, { backgroundColor: color }]} />
              <Text style={s.label}>{label}</Text>
            </View>
            <Text style={s.legendAmount}>{grams(values[key])}</Text>
          </View>
        ))}
      </View>
      <Text style={s.hint}>Соотношение по массе БЖУ</Text>
      {additionalNutrients.length ? (
        <View style={s.additional}>
          <Text style={s.heading}>Дополнительные нутриенты</Text>
          {additionalNutrients.map(({ key, label }) => (
            <View key={key} style={s.row}>
              <Text style={s.label}>{label}</Text>
              <Text style={s.amount}>
                {micronutrients![key].toLocaleString("ru-RU", { maximumFractionDigits: 1 })} г
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  heading: { fontSize: 15, fontWeight: "600", color: colors.text },
  progressGroup: { gap: 12, marginTop: 4 },
  progressRow: { gap: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" },
  label: { color: colors.muted, fontSize: 13 },
  amount: { color: colors.text, fontSize: 13, fontWeight: "500", fontVariant: ["tabular-nums"] },
  track: { height: 6, borderRadius: 4, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 4 },
  composition: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 12 },
  compositionTrack: { height: 10, borderRadius: 5, flexDirection: "row", backgroundColor: colors.soft },
  legend: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 12 },
  legendItem: { gap: 5 },
  legendLabel: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  legendAmount: { color: colors.text, fontSize: 17, fontWeight: "600", fontVariant: ["tabular-nums"] },
  hint: { fontSize: 12, color: colors.muted },
  additional: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, gap: 8 },
});
