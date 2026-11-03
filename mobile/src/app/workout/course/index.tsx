import { useCallback } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../../../theme";
import { ErrorText, Loading, SecondaryButton } from "../../../ui";
import { useWorkouts } from "../../../workouts/context";
import { CourseOverview } from "../../../workouts/CourseOverview";
import { s, WorkoutHeader } from "../../../workouts/ui";

export default function WorkoutCourseScreen() {
  const { store, ready, catalogue, syncing, error } = useWorkouts();
  useFocusEffect(useCallback(() => { void store.refresh(); }, [store]));
  if (!ready) return <Loading />;
  return <SafeAreaView edges={["top", "bottom"]} style={s.page}>
    <WorkoutHeader title="О курсе" />
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => void store.refresh()} tintColor={colors.accent} />}>
      <ErrorText message={error} />
      {catalogue?.course ? <CourseOverview /> : <View style={s.notice}>
        <Text style={s.muted}>Не удалось загрузить курс. Вернитесь в каталог и обновите список.</Text>
        <SecondaryButton label="К курсам" onPress={() => router.replace("/(tabs)/workouts")} />
      </View>}
    </ScrollView>
  </SafeAreaView>;
}
