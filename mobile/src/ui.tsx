import { type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";

import { colors } from "./theme";

export function ScreenTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={styles.titleBlock}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.primary,
        (pressed || disabled) && styles.pressed,
      ]}
    >
      <Text style={styles.primaryLabel}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.secondary,
        (pressed || disabled) && styles.pressed,
      ]}
    >
      <Text style={styles.secondaryLabel}>{label}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps) {
  const label = props.accessibilityLabel ?? props.placeholder;
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 18 }}>
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={colors.muted}
        {...props}
        accessibilityLabel={label}
        style={[styles.field, props.style]}
      />
    </View>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }
  return <Text style={styles.error}>{message}</Text>;
}

export function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  titleBlock: {
    gap: 6,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.text,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    color: colors.muted,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 8,
  },
  primary: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  primaryLabel: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  secondary: {
    backgroundColor: colors.soft,
    borderRadius: 14,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  secondaryLabel: {
    color: colors.accentDark,
    fontSize: 15,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.75,
  },
  field: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
});
