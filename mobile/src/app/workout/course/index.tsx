import { useCallback } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../../../theme";
import { ErrorText, Loading, SecondaryButton } from "../../../ui";
import { useWorkouts } from "../../../workouts/context";
import { CourseOverview } from "../../../workouts/CourseOverview";
import { LEGACY_COURSE_ID, selectedCourse } from "../../../workouts/course";
import { s, WorkoutHeader } from "../../../workouts/ui";

export default function WorkoutCourseScreen() {
  const data = useWorkouts(), { store, ready, syncing, error } = data;
  const { courseId = LEGACY_COURSE_ID } = useLocalSearchParams<{ courseId?: string }>();
  useFocusEffect(useCallback(() => { void store.refresh(); }, [store]));
  if (!ready) return <Loading />;
  return <SafeAreaView edges={["top", "bottom"]} style={s.page}>
    <WorkoutHeader title="О курсе" />
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => void store.refresh()} tintColor={colors.accent} />}>
      <ErrorText message={error} />
      {selectedCourse(data, courseId) ? <CourseOverview key={courseId} courseId={courseId} /> : <View style={s.notice}>
        <Text style={s.muted}>Не удалось загрузить курс. Вернитесь в каталог и обновите список.</Text>
        <SecondaryButton label="К курсам" onPress={() => router.replace("/(tabs)/workouts")} />
      </View>}
    </ScrollView>
  </SafeAreaView>;
}
