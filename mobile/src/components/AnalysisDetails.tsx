import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { API_URL } from "../config";
import { formatWhen, grams, kcal, mealHeading, ml } from "../format";
import { colors } from "../theme";
import type { Entry, EntryDetails } from "../types";
import { MacroComposition } from "./MacroBars";
import { PhotoPreview } from "./PhotoPreview";

type AnalysisEntry = Pick<Entry, "entry_type" | "title" | "calories" | "protein_g" | "fat_g" | "carbs_g" | "duration_minutes" | "volume_ml">
  & Partial<Pick<Entry, "meal_slot" | "created_at" | "micronutrients" | "items">>
  & { media?: EntryDetails["media"] };

export function AnalysisDetails({ entry, action }: { entry: AnalysisEntry; action?: ReactNode }) {
  const activity = entry.entry_type === "activity";
  const water = entry.entry_type === "water";
  const title = activity || water ? entry.title : mealHeading(entry.title, entry.meal_slot);
  const photos = entry.media?.filter((item) => item.mime.startsWith("image/")) ?? [];
  return (
    <>
      <View style={s.header}>
        <Text accessibilityRole="header" style={s.title}>{title}</Text>
        {action}
      </View>
      {entry.created_at ? <Text style={s.muted}>{formatWhen(entry.created_at)}</Text> : null}
      {photos.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={s.photos}>
            {photos.map((photo) => <PhotoPreview key={photo.id} uri={API_URL + photo.url} style={s.photo} />)}
          </View>
        </ScrollView>
      ) : null}
      <Text style={s.calories}>
        {water ? ml(entry.volume_ml ?? 0) : activity ? `Сожжено ${kcal(entry.calories)}` : kcal(entry.calories)}
      </Text>
      {activity && entry.duration_minutes != null ? <Text style={s.muted}>{entry.duration_minutes} мин</Text> : null}
      {!activity && !water ? <MacroComposition values={entry} micronutrients={entry.micronutrients} /> : null}
      {!water && entry.items?.length ? <Text style={s.sectionTitle}>Состав и порции</Text> : null}
      {!water ? entry.items?.map((item, index) => (
        <View key={`${item.name}-${index}`} style={s.item}>
          <Text style={s.itemTitle}>{item.name}</Text>
          <Text style={s.muted}>{item.quantity ? `${item.quantity} · ` : ""}{kcal(item.calories)}</Text>
          {!activity ? <Text style={s.muted}>Белки {grams(item.protein_g ?? 0)} · жиры {grams(item.fat_g ?? 0)} · углеводы {grams(item.carbs_g ?? 0)}</Text> : null}
        </View>
      )) : null}
    </>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  title: { flex: 1, fontSize: 26, fontWeight: "700", color: colors.text },
  muted: { color: colors.muted, fontSize: 14 },
  photos: { flexDirection: "row", gap: 10 },
  photo: { width: 280, height: 210, borderRadius: 18 },
  calories: { fontSize: 18, fontWeight: "600", color: colors.accentDark },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: "600", marginTop: 10 },
  item: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 8 },
  itemTitle: { color: colors.text, fontWeight: "600" },
});
