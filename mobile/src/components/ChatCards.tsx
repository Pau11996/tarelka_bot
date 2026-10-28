import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import type { AchievementMessage, DayView, Entry } from "../types";
import { grams, mealHeading, ml } from "../format";
import { BrandMark, Icon } from "./Brand";
import { PhotoPreview } from "./PhotoPreview";
import { FavoriteButton } from "./FavoriteButton";
import { DeleteEntryButton } from "./DeleteEntryButton";
import { StarterTargetNotice } from "./StarterTargetNotice";

export type CardPhoto = { uri: string; previewUri?: string };

function AdditionalPhotos({ photos }: { photos: CardPhoto[] }) {
  if (photos.length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.additionalPhotos}>
      {photos.slice(1).map((photo) => (
        <PhotoPreview key={photo.uri} uri={photo.uri} previewUri={photo.previewUri} style={s.photo} />
      ))}
    </ScrollView>
  );
}

export function AssistantLabel() {
  return (
    <View style={s.label}>
      <View style={s.brandIcon}>
        <BrandMark size={20} />
      </View>
      <Text style={s.labelText}>Тарелка</Text>
    </View>
  );
}

export function WeightChatCard({ weight, time, photos = [] }: {
  weight: number; time?: string; photos?: CardPhoto[];
}) {
  return <View style={s.response}>
    <AssistantLabel />
    <View style={[s.card, { padding: 16, gap: 12 }]}>
      <View style={s.between}><View style={s.category}><Icon name="scale" size={15} color={colors.accent} /><Text style={s.categoryText}>Взвешивание</Text></View>{time ? <Text style={s.time}>{time}</Text> : null}</View>
      <Text style={{ color: colors.accentDark, fontSize: 30, fontWeight: "600" }}>{weight.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}<Text style={{ fontSize: 14, fontWeight: "400", color: colors.muted }}> кг</Text></Text>
      <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}><Icon name="check" size={15} color={colors.accent} /><Text style={{ fontSize: 12, color: colors.muted }}>Сохранено в «Прогрессе»</Text></View>
      {photos.length ? <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>{photos.map(photo => <PhotoPreview key={photo.uri} {...photo} style={{ width: 64, height: 64, borderRadius: 12 }} />)}</ScrollView> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Открыть прогресс" onPress={() => router.push("/(tabs)/achievements")} style={{ minHeight: 42, borderRadius: 12, backgroundColor: colors.soft, flexDirection: "row", gap: 7, alignItems: "center", justifyContent: "center" }}><Icon name="trophy" size={16} color={colors.accentDark} /><Text style={{ fontSize: 12, fontWeight: "500", color: colors.accentDark }}>Посмотреть прогресс</Text><Icon name="chevron" size={13} color={colors.accentDark} /></Pressable>
    </View>
  </View>;
}

export function GoalReachedChatCard({ notice, time }: { notice: AchievementMessage; time?: string }) {
  return <View style={s.response}>
    <AssistantLabel />
    <View style={[s.card, { padding: 16, gap: 12 }]}>
      <View style={s.between}>
        <View style={s.category}><Icon name="trophy" size={16} color={colors.accent} /><Text style={s.categoryText}>Ваша цель</Text></View>
        {time ? <Text style={s.time}>{time}</Text> : null}
      </View>
      <Text style={{ fontSize: 20, fontWeight: "600", color: colors.accentDark }}>{notice.title}</Text>
      <Text style={{ fontSize: 14, lineHeight: 21, color: colors.text }}>{notice.message}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Открыть достигнутую цель" onPress={() => router.push("/(tabs)/achievements")} style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.soft, flexDirection: "row", gap: 7, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: 13, fontWeight: "500", color: colors.accentDark }}>Открыть прогресс</Text><Icon name="chevron" size={14} color={colors.accentDark} />
      </Pressable>
    </View>
  </View>;
}

export function EntryCard({
  entry,
  onCorrect,
  disabled,
  previousCalories,
  time,
  fromPhoto,
  photos = [],
  onFavoriteChange,
  onDeleted,
}: {
  entry: Entry;
  onCorrect: () => void;
  disabled?: boolean;
  fromPhoto?: boolean;
  previousCalories?: number;
  time?: string;
  photos?: CardPhoto[];
  onFavoriteChange: (favoriteId: number | null) => void;
  onDeleted: () => void;
}) {
  const water = entry.entry_type === "water",
    activity = entry.entry_type === "activity";
  const accent = water ? "#4d8199" : activity ? "#a77342" : colors.accent;
  const soft = water ? "#edf5fa" : activity ? "#fbf2e7" : "#f0f5e8";
  return (
    <View style={s.response}>
      <AssistantLabel />
      <View style={s.card}>
        <View style={[s.between, s.cardHeader]}>
          <View style={[s.category, { backgroundColor: soft }]}>
            <Icon
              name={water ? "drop" : activity ? "walk" : fromPhoto ? "camera" : "plate"}
              size={12}
              color={accent}
            />
            <Text style={[s.categoryText, { color: accent }]}>
              {water
                ? "Вода"
                : activity
                  ? "Активность"
                  : mealHeading("", entry.meal_slot).replace(
                      /\s*·\s*$/,
                      "",
                    ) || "Приём пищи"}
            </Text>
          </View>
          <DeleteEntryButton entryId={entry.id} disabled={disabled} onDeleted={onDeleted} />
        </View>
          <View style={s.cardBody}>
            <View style={s.overview}>
              {photos[0] ? (
                <PhotoPreview uri={photos[0].uri} previewUri={photos[0].previewUri} style={s.photo} />
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Открыть запись: ${entry.title}`}
                onPress={() => router.push(`/entry/${entry.id}`)}
                style={s.overviewText}
              >
                <Text style={s.title} numberOfLines={2}>{entry.title}</Text>
                <View style={s.energy}>
                  <Text style={[s.calories, { color: water ? accent : colors.text }]}>
                    {water
                      ? ml(entry.volume_ml ?? 0).replace(" мл", "")
                      : Math.round(entry.calories).toLocaleString("ru-RU")}
                  </Text>
                  <Text style={s.unit}>{water ? "мл" : "ккал"}</Text>
                  {activity && entry.duration_minutes ? (
                    <Text style={s.description}>{entry.duration_minutes} мин</Text>
                  ) : null}
                </View>
              </Pressable>
            </View>
            <AdditionalPhotos photos={photos} />
            {!water && !activity ? (
              <View
                accessible
                style={s.macroRow}
                accessibilityLabel={`Белки: ${grams(entry.protein_g)}, жиры: ${grams(entry.fat_g)}, углеводы: ${grams(entry.carbs_g)}`}
              >
                {[
                  { label: "Б", value: entry.protein_g, color: "#3776a2", backgroundColor: "#edf4fa" },
                  { label: "Ж", value: entry.fat_g, color: "#946821", backgroundColor: "#faf3e7" },
                  { label: "У", value: entry.carbs_g, color: colors.accent, backgroundColor: "#edf5ec" },
                ].map(({ label, value, color, backgroundColor }) => (
                  <View key={label} style={[s.macroItem, { backgroundColor }]}>
                    <Text style={[s.macroLabel, { color }]}>{label}</Text>
                    <Text style={[s.macroValue, { color }]}>{grams(value)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {previousCalories !== undefined &&
            Math.round(previousCalories) !== Math.round(entry.calories) ? (
              <Text style={s.description}>
                Уточнено: {Math.round(previousCalories)} →{" "}
                {Math.round(entry.calories)} ккал
              </Text>
            ) : null}
          </View>
        <View style={s.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Подробнее: ${entry.title}`}
            onPress={() => router.push(`/entry/${entry.id}`)}
            style={({ pressed }) => [s.details, pressed && { opacity: 0.6 }]}
          >
            <Text style={s.link}>Подробнее</Text>
            <Icon name="chevron" size={15} color={colors.accentDark} />
          </Pressable>
          <View style={s.rightActions}>
            <FavoriteButton entryId={entry.id} favoriteId={entry.favorite_id} onChange={onFavoriteChange} />
            <Pressable
              accessibilityRole="button"
              disabled={disabled}
              onPress={onCorrect}
              style={({ pressed }) => [
                s.correct,
                (pressed || disabled) && { opacity: 0.5 },
              ]}
            >
              <Icon name="edit" size={15} color={colors.accentDark} />
              <Text style={s.link}>Уточнить</Text>
            </Pressable>
          </View>
        </View>
      </View>
      {time ? <Text style={s.time}>{time}</Text> : null}
    </View>
  );
}

export function AnalysisFailureCard({
  message,
  photos = [],
  time,
  onLimit,
  onRetry,
  onDismiss,
  disabled,
}: {
  message: string;
  photos?: CardPhoto[];
  time?: string;
  onLimit?: () => void;
  onRetry?: () => void;
  onDismiss?: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={s.response}>
      <AssistantLabel />
      <View style={[s.card, s.failureCard]}>
        <View style={[s.cardBody, s.failureBody]}>
          <View style={[s.overview, s.failureOverview]}>
            {photos[0] ? <PhotoPreview uri={photos[0].uri} previewUri={photos[0].previewUri} style={s.photo} /> : null}
            <Text accessibilityRole="alert" style={s.failureMessage}>{message}</Text>
            {onDismiss ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Скрыть сообщение об ошибке"
                onPress={onDismiss} style={({ pressed }) => [s.failureClose, pressed && { opacity: 0.5 }]}>
                <Icon name="close" size={16} color="#82776c" />
              </Pressable>
            ) : null}
          </View>
          <AdditionalPhotos photos={photos} />
        </View>
        {onLimit || onRetry ? (
          <View style={[s.actions, s.failureActions]}>
            {onLimit ? (
              <Pressable accessibilityRole="button" onPress={onLimit} style={({ pressed }) => [s.details, pressed && { opacity: 0.6 }]}>
                <Text style={[s.link, s.failureLink]}>Информация о лимите</Text>
              </Pressable>
            ) : null}
            {onRetry ? (
              <Pressable accessibilityRole="button" onPress={onRetry} disabled={disabled} style={({ pressed }) => [s.details, (pressed || disabled) && { opacity: 0.5 }]}>
                <Text style={[s.link, s.failureLink]}>Повторить</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
      {time ? <Text style={s.time}>{time}</Text> : null}
    </View>
  );
}

export function DaySummary({
  day,
  onPress,
}: {
  day: DayView;
  onPress: () => void;
}) {
  const target = day.balance.target + day.balance.activity_bonus;
  const starter = !day.profile_complete;
  const progress = Math.max(
    0,
    Math.min(1, day.balance.consumed / Math.max(1, target)),
  );
  return (
    <View style={s.summary}><Pressable
      accessibilityRole="button"
      accessibilityLabel="Открыть дневник"
      onPress={onPress}
      style={{ gap: 8 }}
    >
      <View style={s.summaryTop}>
        <Text style={s.summaryTitle}>Сегодня</Text>
        <Text style={s.summaryCalories}>
          {Math.round(day.balance.consumed).toLocaleString("ru-RU")}{" "}
          <Text style={s.summaryHint}>
            / {Math.round(target).toLocaleString("ru-RU")} ккал
          </Text>
        </Text>
        <Icon name="chevron" size={16} color={colors.accentDark} />
      </View>
      <View style={s.track}>
        <View style={[s.progress, { width: `${progress * 100}%` }]} />
      </View>
      <Text style={s.summaryHint}>
        {starter ? `Стартовый ориентир ${Math.round(day.balance.target).toLocaleString("ru-RU")} ккал` : day.balance.remaining >= 0
          ? `Осталось ${Math.round(day.balance.remaining).toLocaleString("ru-RU")} ккал до цели`
          : `Сверх цели ${Math.round(-day.balance.remaining).toLocaleString("ru-RU")} ккал`}{" "}
        · <Text style={{ color: colors.accentDark }}>В дневник →</Text>
      </Text>
    </Pressable>
      {starter ? <StarterTargetNotice /> : null}
    </View>
  );
}
const s = StyleSheet.create({
  response: { gap: 5, maxWidth: 300, width: "100%", alignSelf: "flex-start" },
  label: { flexDirection: "row", gap: 6, alignItems: "center" },
  brandIcon: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  labelText: { fontSize: 12, fontWeight: "600", color: colors.text },
  card: {
    borderRadius: 18,
    borderTopLeftRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "#e0e8dc",
    overflow: "hidden",
    boxShadow: "0px 3px 12px #182c2305",
  },
  cardHeader: { paddingTop: 8, paddingHorizontal: 12 },
  cardBody: { padding: 12, paddingTop: 8, gap: 8 },
  overview: { flexDirection: "row", alignItems: "center", gap: 10 },
  overviewText: { flex: 1, gap: 3 },
  photo: { width: 56, height: 56, borderRadius: 10 },
  additionalPhotos: { gap: 8 },
  failureCard: { backgroundColor: "#f8f6f2", borderColor: "#e8e2d9" },
  failureBody: { paddingTop: 12 },
  failureOverview: { alignItems: "flex-start" },
  failureMessage: { flex: 1, color: "#73665b", fontSize: 14, lineHeight: 21, fontWeight: "400" },
  failureClose: { width: 44, height: 44, marginTop: -8, marginRight: -8, marginLeft: -4, alignItems: "center", justifyContent: "center", borderRadius: 22 },
  failureActions: { borderTopColor: "#e8e2d9", flexWrap: "wrap" },
  failureLink: { color: "#73665b", fontWeight: "500" },
  between: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
  },
  category: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 7,
  },
  categoryText: { fontSize: 10, fontWeight: "600" },
  title: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    letterSpacing: -0.2,
    color: colors.text,
  },
  energy: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  calories: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.5,
    fontVariant: ["tabular-nums"],
  },
  unit: { fontSize: 12, color: colors.muted },
  macroRow: { flexDirection: "row", gap: 6, marginTop: 2 },
  macroItem: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 6 },
  macroLabel: { fontSize: 12, lineHeight: 17, fontWeight: "700" },
  macroValue: { fontSize: 12, lineHeight: 17, fontWeight: "600", fontVariant: ["tabular-nums"] },
  description: {
    fontSize: 11,
    lineHeight: 17,
    color: colors.muted,
    flexShrink: 1,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 6,
    paddingVertical: 2,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: "#edf1e9",
  },
  correct: {
    minHeight: 44,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "#f0f5e8",
    borderRadius: 10,
  },
  rightActions: { flexDirection: "row", alignItems: "center", gap: 2 },
  details: {
    minHeight: 44,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  link: { fontSize: 12, fontWeight: "600", color: colors.accentDark },
  time: { fontSize: 10, color: colors.muted, paddingLeft: 8 },
  summary: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 16,
    marginBottom: 10,
    gap: 8,
    borderRadius: 18,
    backgroundColor: "#eef4e7",
    borderWidth: 1,
    borderColor: "#dfe8d6",
  },
  summaryTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  summaryTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    color: colors.accentDark,
  },
  summaryCalories: { fontSize: 14, fontWeight: "700", color: colors.text },
  summaryHint: { fontSize: 10, fontWeight: "400", color: colors.muted },
  track: {
    height: 4,
    backgroundColor: "#dbe6d1",
    borderRadius: 2,
    overflow: "hidden",
  },
  progress: { height: 4, backgroundColor: colors.accent, borderRadius: 2 },
});
