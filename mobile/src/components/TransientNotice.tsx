import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme";
import { Icon } from "./Brand";

export function TransientNotice({ message }: { message: string | null }) {
  const insets = useSafeAreaInsets();
  if (!message) return null;
  return (
    <View pointerEvents="none" style={[s.host, { bottom: Math.max(insets.bottom, 16) }]}>
      <View role="status" accessibilityLiveRegion="polite" style={s.notice}>
        <Icon name="check" size={18} color="white" />
        <Text style={s.text}>{message}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  host: { position: "absolute", left: 20, right: 20, alignItems: "center" },
  notice: { maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14, backgroundColor: colors.accentDark, boxShadow: "0px 4px 16px #182c2320" },
  text: { flexShrink: 1, color: "white", fontSize: 13, lineHeight: 18, fontWeight: "500" },
});
