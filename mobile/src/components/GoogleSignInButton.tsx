import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";

// Google's pre-approved light icon, displayed at its original 20 dp logo size.
// Source: https://developers.google.com/identity/branding-guidelines
const icon = require("../../assets/google-sign-in-icon.png");

export function GoogleSignInButton({ busy, disabled, onPress }: {
  busy: boolean; disabled: boolean; onPress: () => void;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Войти через Google"
    accessibilityState={{ busy, disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.button, (pressed || disabled) && s.disabled]}>
    {busy ? <ActivityIndicator size="small" color="#1f1f1f" /> :
      <View style={s.iconCrop} accessible={false}><Image source={icon} style={s.icon} /></View>}
    <Text style={s.label}>{busy ? "Входим…" : "Войти через Google"}</Text>
  </Pressable>;
}

const s = StyleSheet.create({
  button: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12,
    paddingHorizontal: 12, borderRadius: 15, borderWidth: 1, borderColor: "#747775", backgroundColor: "#ffffff" },
  label: { fontSize: 14, lineHeight: 20, fontWeight: "500", color: "#1f1f1f" },
  iconCrop: { width: 20, height: 20, overflow: "hidden" },
  icon: { width: 40, height: 40, position: "absolute", left: -10, top: -10 },
  disabled: { opacity: 0.65 },
});
