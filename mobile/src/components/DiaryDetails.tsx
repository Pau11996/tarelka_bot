import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { DayView } from "../types";
import { colors } from "../theme";
import { Icon } from "./Brand";
import { DiaryAdditionalNutrients, DiaryHabits } from "./DiaryDay";
import { DeviceHealthDay } from "./DeviceHealth";

export function DiaryDetails({ day }: { day: DayView }) {
  const [expanded, setExpanded] = useState(false);
  return <View style={s.card}>
    <Pressable accessibilityRole="button" accessibilityLabel="Подробнее о дне" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={s.heading}>
      <View style={s.labels}>
        <Text style={s.title}>Подробнее о дне</Text>
        <Text style={s.hint}>Вода, клетчатка, сахар и активность</Text>
      </View>
      <View style={expanded ? s.up : undefined}><Icon name="down" size={18} color={colors.muted} /></View>
    </Pressable>
    {expanded ? <View style={s.body}>
      <DiaryHabits day={day} />
      <Text style={s.hint}>Активность, записанная в дневнике, увеличивает остаток калорий на день.</Text>
      <DiaryAdditionalNutrients day={day} />
      <DeviceHealthDay health={day.health} />
    </View> : null}
  </View>;
}

const s = StyleSheet.create({
  card: { backgroundColor: "#eef3e9", borderWidth: 1, borderColor: colors.border, borderRadius: 16, overflow: "hidden" },
  heading: { minHeight: 58, paddingHorizontal: 13, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  labels: { flex: 1, gap: 4 },
  title: { color: colors.text, fontSize: 12, fontWeight: "600" },
  hint: { color: colors.muted, fontSize: 10, lineHeight: 16 },
  up: { transform: [{ rotate: "180deg" }] },
  body: { paddingHorizontal: 10, paddingBottom: 10, gap: 10 },
});
