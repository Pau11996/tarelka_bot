import type { ReactNode } from "react";
import { Image, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, welcomeColors } from "../theme";
import { BrandMark, Icon } from "./Brand";

const hero = require("../../assets/login-hero.jpg");

export function LoginWelcome({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const inset = useSafeAreaInsets();
  const compact = height - inset.top - inset.bottom < 740;
  const plateSize = Math.min(compact ? 210 : 258, width - 110);
  const photoSize = Math.round(plateSize * 224 / 258);
  const titleSize = width < 350 ? 29 : compact ? 32 : 35;

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={s.brandRow}>
        <BrandMark size={33} />
        <Text style={s.brand}>тарелка</Text>
      </View>
      <View style={s.scene}>
        <View>
          <Text accessibilityRole="header" style={[s.title, { fontSize: titleSize, lineHeight: titleSize + 5 }]}>
            Забота о себе.{"\n"}<Text style={s.titleAccent}>Без лишних усилий.</Text>
          </Text>
          <Text style={s.subtitle}>Фото, голос или пара слов —{"\n"}ваш дневник уже пополняется.</Text>
        </View>
        <View style={[s.plateStage, { minHeight: plateSize + 18 }]}>
          <View accessible={false} style={[s.halo, { width: plateSize, height: plateSize, borderRadius: plateSize / 2 }]}>
            <View style={[s.dashedRing, { borderRadius: plateSize / 2 }]} />
          </View>
          <View style={[s.photoFrame, { width: photoSize, height: photoSize, borderRadius: photoSize / 2 }]}>
            <Image accessibilityLabel="Тарелка пасты с креветками" source={hero} resizeMode="cover" style={[s.photo, { borderRadius: photoSize / 2 }]} />
          </View>
          <View style={[s.chip, s.photoChip]}>
            <Icon name="camera" size={16} color={welcomeColors.chipText} />
            <Text style={s.chipText}>Просто фото</Text>
          </View>
          <View style={[s.chip, s.savedChip]}>
            <View style={s.dot} />
            <Text style={s.chipText}>Сохранено в дневник</Text>
          </View>
        </View>
        <Text style={s.footnote}>Еда, вода и движение — в одном месте</Text>
      </View>
      {children}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1 },
  content: { flexGrow: 1, width: "100%", maxWidth: 480, alignSelf: "center", paddingHorizontal: 24, paddingTop: 12, paddingBottom: 12 },
  brandRow: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  brand: { fontSize: 23, fontWeight: "700", letterSpacing: -0.8, color: colors.text },
  scene: { flex: 1, justifyContent: "space-between", paddingTop: 18, paddingBottom: 12, gap: 14 },
  title: { fontWeight: "700", letterSpacing: -1.4, color: colors.text, textAlign: "center" },
  titleAccent: { color: colors.accent },
  subtitle: { fontSize: 13, lineHeight: 22, color: colors.muted, textAlign: "center", marginTop: 12 },
  plateStage: { alignItems: "center", justifyContent: "center", marginVertical: 7 },
  halo: { position: "absolute", backgroundColor: welcomeColors.halo, borderWidth: 1, borderColor: welcomeColors.haloBorder, transform: [{ rotate: "-15deg" }] },
  dashedRing: { position: "absolute", inset: 13, borderWidth: 1, borderStyle: "dashed", borderColor: welcomeColors.dashedRing },
  photoFrame: { padding: 8, backgroundColor: welcomeColors.photoFrame, boxShadow: welcomeColors.photoShadow },
  photo: { width: "100%", height: "100%" },
  chip: { position: "absolute", flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, backgroundColor: colors.surface, boxShadow: welcomeColors.chipShadow },
  photoChip: { top: 39, left: -1, transform: [{ rotate: "-5deg" }] },
  savedChip: { bottom: 26, right: -1, transform: [{ rotate: "4deg" }] },
  chipText: { fontSize: 10, lineHeight: 14, fontWeight: "500", color: welcomeColors.chipText },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: welcomeColors.savedDot },
  footnote: { fontSize: 10, lineHeight: 15, color: welcomeColors.footnote, textAlign: "center", marginBottom: 6 },
});
