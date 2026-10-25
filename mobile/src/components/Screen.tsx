import { router, type Href } from "expo-router";
import { ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../theme";
import { AccountMenu } from "./AccountMenu";
export const design = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  content: {
    padding: 20,
    gap: 20,
    paddingBottom: 110,
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
  },
  title: {
    fontSize: 30,
    fontWeight: "700",
    letterSpacing: -0.7,
    color: colors.text,
  },
  subtitle: { fontSize: 14, lineHeight: 21, color: colors.muted },
  heading: { fontSize: 19, fontWeight: "700", color: colors.text },
  label: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1,
    color: colors.muted,
    textTransform: "uppercase",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  metric: {
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: -1,
    color: colors.text,
    fontVariant: ["tabular-nums"],
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.accent },
});
export function Screen({
  title,
  subtitle,
  children,
  back,
  backTo,
  refreshing,
  onRefresh,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  backTo?: Href;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <SafeAreaView style={design.page} edges={["top"]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={design.content}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={!!refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
            />
          ) : undefined
        }
      >
        {back ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              backTo ? router.dismissTo(backTo) : router.canGoBack()
                ? router.back()
                : router.replace("/(tabs)/chat")
            }
            style={{
              minHeight: 44,
              justifyContent: "center",
              alignSelf: "flex-start",
            }}
          >
            <Text style={{ color: colors.accent, fontWeight: "600" }}>
              ‹ Назад
            </Text>
          </Pressable>
        ) : null}
        <View
          style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}
        >
          <View style={{ flex: 1, gap: 6 }}>
            <Text accessibilityRole="header" style={design.title}>
              {title}
            </Text>
            {subtitle ? <Text style={design.subtitle}>{subtitle}</Text> : null}
          </View>
          {!back ? <AccountMenu /> : null}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
export function Panel({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <View style={design.card}>
      {title ? (
        <Text accessibilityRole="header" style={design.heading}>
          {title}
        </Text>
      ) : null}
      {subtitle ? <Text style={design.subtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}
export function State({
  loading,
  error,
  empty,
  onRetry,
}: {
  loading?: boolean;
  error?: string | null;
  empty?: string;
  onRetry?: () => void;
}) {
  if (!loading && !error && !empty) return null;
  return (
    <View style={{ gap: 12, paddingVertical: 12 }}>
      {loading ? <ActivityIndicator color={colors.accent} /> : null}
      {error || empty ? (
        <Text accessibilityLiveRegion="polite" style={design.subtitle}>
          {error || empty}
        </Text>
      ) : null}
      {error && onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          style={design.chip}
        >
          <Text style={{ color: colors.accent }}>Попробовать ещё раз</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
export function Segments<T extends string | number>({
  items,
  value,
  onChange,
}: {
  items: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {items.map((item) => (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: item.value === value }}
          key={item.value}
          onPress={() => onChange(item.value)}
          style={[design.chip, item.value === value && design.chipOn]}
        >
          <Text
            style={{
              color: item.value === value ? "white" : colors.text,
              fontWeight: "600",
            }}
          >
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
