import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Icon } from "../components/Brand";
import { colors as c } from "../theme";
import { courseCompletions, courseSummary } from "./course";
import type { WorkoutData } from "./types";

const cover = require("../../assets/workouts/courses/full-body-gym.png");

export function CoursePhoto({ title, days }: { title?: string; days: number }) {
  return <View style={styles.photo}>
    <Image source={cover} resizeMode="cover" style={[StyleSheet.absoluteFill, { width: "100%", height: "100%" }]}
      accessibilityLabel="Девушка в спортивной одежде в тренажёрном зале" />
    <View pointerEvents="none" style={styles.photoContent}>
      <View style={styles.badge}><Text style={styles.badgeText}>{days} ДНЕЙ</Text></View>
      {title ? <Text style={styles.coverTitle}>{title}</Text> : null}
    </View>
  </View>;
}

export function CourseFacts({ data }: { data: WorkoutData }) {
  const summary = courseSummary(data);
  if (!summary) return null;
  return <View style={styles.facts}>
    <View style={styles.fact}>
      <Icon name="clock" size={19} color={c.accentDark} />
      <View style={styles.factText}><Text style={styles.value}>{summary.minutes} мин</Text><Text style={styles.label}>одно занятие</Text></View>
    </View>
    <View style={styles.fact}>
      <Icon name="dumbbell" size={19} color={c.accentDark} />
      <View style={styles.factText}><Text style={styles.value}>{summary.exercises}</Text><Text style={styles.label}>упражнений в занятии</Text></View>
    </View>
  </View>;
}

export function CourseCard({ data }: { data: WorkoutData }) {
  const summary = courseSummary(data);
  if (!summary) return null;
  const completed = courseCompletions(data).length;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Курс «${summary.title}», ${summary.days} дней. Подробнее о курсе`}
    onPress={() => router.push("/workout/course")}
    style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}>
    <CoursePhoto title={summary.title} days={summary.days} />
    <View style={styles.body}>
      <Text style={styles.description}>Тренировки для всего тела, прогулки и восстановление.</Text>
      <CourseFacts data={data} />
      <View style={styles.footer}>
        <Text style={styles.link}>{completed ? `Пройдено ${completed} из ${summary.days} дней` : "Подробнее о курсе"}</Text>
        <View style={styles.arrow}><Icon name="chevron" size={17} color={c.accentDark} /></View>
      </View>
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: c.surface, borderRadius: 26, overflow: "hidden", borderWidth: 1, borderColor: c.border },
  photo: { aspectRatio: 1.5, backgroundColor: "#324b3c", overflow: "hidden" },
  photoContent: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, padding: 20, justifyContent: "space-between", alignItems: "flex-start" },
  badge: { backgroundColor: "#ffffffea", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  badgeText: { fontSize: 10, letterSpacing: 1, fontWeight: "700", color: "#294634" },
  coverTitle: { color: "white", fontSize: 36, lineHeight: 40, fontWeight: "700", maxWidth: "52%" },
  body: { padding: 18, gap: 18 },
  description: { color: c.muted, fontSize: 14, lineHeight: 21 },
  facts: { flexDirection: "row", gap: 16 },
  fact: { flex: 1, flexDirection: "row", alignItems: "center", gap: 9 },
  factText: { flex: 1, gap: 3 },
  value: { color: c.text, fontSize: 16, fontWeight: "600" },
  label: { color: c.muted, fontSize: 11, lineHeight: 15 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 14, borderTopWidth: 1, borderTopColor: c.border },
  link: { color: c.accentDark, fontSize: 13, fontWeight: "600", flex: 1 },
  arrow: { width: 32, height: 32, borderRadius: 16, backgroundColor: c.soft, alignItems: "center", justifyContent: "center" },
});
