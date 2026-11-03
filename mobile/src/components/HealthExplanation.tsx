import { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { SITE_URL } from "../config";
import { colors } from "../theme";
import { Icon } from "./Brand";

export function HealthExplanation() {
  const [expanded, setExpanded] = useState(false);
  return <View style={s.card}>
    <Pressable accessibilityRole="button" accessibilityLabel="Как это работает"
      accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={s.heading}>
      <Text style={s.title}>Как это работает</Text>
      <View style={expanded ? s.up : undefined}><Icon name="down" size={20} color={colors.muted} /></View>
    </Pressable>
    {expanded ? <View style={s.body}>
      <Text style={s.text}>Health Connect — общее хранилище данных о здоровье на вашем Android-телефоне. Приложения, которым вы дали разрешение, могут сохранять в нём шаги, тренировки, вес и другие показатели.</Text>
      <Text style={s.text}>ТАРЕЛКА берёт данные из Health Connect. Вы выбираете, какие показатели ей доступны. Если данные не появляются, проверьте, что ваше фитнес-приложение сохраняет их в Health Connect, а ТАРЕЛКЕ разрешено их читать.</Text>
      <Text style={s.text}>Данные обновляются при открытии ТАРЕЛКИ или по кнопке «Обновить данные» и сохраняются в вашем аккаунте для дневника и статистики. Они не передаются ИИ-провайдерам и не используются для рекламы.</Text>
      <Text style={s.text}>Калории устройств не увеличивают норму питания, а измерения веса не меняют вес в профиле автоматически. Доступ можно отозвать в настройках Health Connect.</Text>
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`${SITE_URL}/privacy.html`)} style={s.linkButton}>
        <Text style={s.link}>Политика конфиденциальности</Text>
      </Pressable>
    </View> : null}
  </View>;
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 24, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  heading: { minHeight: 64, padding: 20, flexDirection: "row", alignItems: "center", gap: 12 },
  title: { flex: 1, fontSize: 19, fontWeight: "700", color: colors.text },
  up: { transform: [{ rotate: "180deg" }] },
  body: { paddingHorizontal: 20, paddingBottom: 20, gap: 12 },
  text: { fontSize: 13, lineHeight: 20, color: colors.muted },
  linkButton: { minHeight: 44, justifyContent: "center" },
  link: { fontSize: 13, color: colors.accentDark },
});
