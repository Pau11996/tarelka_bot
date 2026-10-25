import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

export function StarterTargetNotice() {
  return <View style={s.notice}>
    <Text style={s.hint}>Пока это стартовый ориентир. Заполните профиль, чтобы рассчитать свою норму.</Text>
    <Pressable accessibilityRole="button" onPress={() => router.push("/profile")} style={s.button}>
      <Text style={s.link}>Рассчитать мою норму →</Text>
    </Pressable>
  </View>;
}

const s = StyleSheet.create({
  notice: { gap: 3, paddingTop: 8 },
  hint: { fontSize: 12, lineHeight: 18, color: colors.muted },
  button: { minHeight: 44, justifyContent: "center" },
  link: { fontSize: 13, fontWeight: "600", color: colors.accentDark },
});
