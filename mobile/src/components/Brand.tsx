import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { colors } from "../theme";

const paths = {
  camera: "M4 6h4l2-3h4l2 3h4v15H4z M8 13a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
  mic: "M8 6a4 4 0 0 1 8 0v5a4 4 0 0 1-8 0z M5 11v1a7 7 0 0 0 14 0v-1 M12 19v3 M9 22h6",
  plus: "M12 5v14 M5 12h14", arrow: "M12 19V5 M6 11l6-6 6 6",
  chevron: "m9 6 6 6-6 6", close: "m6 6 12 12 M18 6 6 18",
  chat: "M20 11a8 8 0 0 1-8 8H4v-8a8 8 0 0 1 16 0Z M8 10h8 M8 14h5",
  day: "M7 5h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z M8 3v4 M16 3v4 M4 11h16 M8 15h2 M14 15h2",
  profile: "M8 8a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M4 21a8 8 0 0 1 16 0",
  settings: "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z M12 3.5v2.2 M12 18.3v2.2 M4.8 4.8l1.6 1.6 M17.6 17.6l1.6 1.6 M3.5 12h2.2 M18.3 12h2.2 M4.8 19.2l1.6-1.6 M17.6 6.4l1.6-1.6",
  check: "m5 12 4 4L19 6", edit: "m14 4 6 6 M4 20l5-1L21 7l-4-4L5 15z",
  walk: "M12 4a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M10 22l2-7-3-4 3-4 4 5h4 M5 12l3-4 4-1 M12 15l5 7",
  play: "m8 4 12 8-12 8Z", pause: "M8 4v16 M16 4v16", stop: "M6 6h12v12H6Z",
  telegram: "m3 11 18-7-4 17-6-6-4 2 1-5 9-5-7 7",
  gallery: "M4 4h16v16H4z M4 17l5-5 4 4 3-3 4 4 M8 8h.01",
  lines: "M5 7h14 M5 12h14 M5 17h9",
  clip: "M15.5 7.5V15a3.5 3.5 0 0 1-7 0V6.5a2.5 2.5 0 0 1 5 0V15a1.5 1.5 0 0 1-3 0V8",
  stats: "M4 19V11 M10 19V5 M16 19v-6 M21 19H3",
  star: "m12 3 2.4 6.8H21l-5.4 4.1 2 6.6L12 16.8 6.4 20.5l2-6.6L3 9.8h6.6z",
} as const;
export type IconName = keyof typeof paths;

export function Icon({ name, size = 24, color = colors.text }: { name: IconName; size?: number; color?: string }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d={paths[name]} stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}

export function BrandMark({ size = 38 }: { size?: number }) {
  const ring = "#1A4030";
  const leaf = "#3C9A46";
  return <Svg width={size} height={size} viewBox="0 0 64 64">
    <Path d="M35.96 21.84A16.5 16.5 0 1 0 38.96 35.99" stroke={ring} strokeWidth={3.3} strokeLinecap="round" fill="none" />
    <Path d="M32.2 27.5A10.2 10.2 0 1 0 32.2 36.5" stroke={ring} strokeWidth={3} strokeLinecap="round" fill="none" />
    <Path d="M34 33.5C43.8 33 46.6 26.4 46 19C39.6 20.5 33.1 25 34 33.5Z" fill={leaf} />
    <Path d="M36.4 31.1C39.6 27.1 41.4 24.5 43.4 22.2" stroke="#E8F6E6" strokeWidth={1.05} strokeLinecap="round" fill="none" />
  </Svg>;
}

const WAVE_HEIGHTS = [7, 13, 9, 17, 11, 19, 8, 15, 10, 18, 7, 14, 11, 16, 9];

export function Waveform({ color = colors.accent, dim = false }: { color?: string; dim?: boolean }) {
  return <View style={styles.wave}>
    {WAVE_HEIGHTS.map((height, index) => <View key={index} style={{ width: 3, height, borderRadius: 2, backgroundColor: color, opacity: dim && index % 3 === 0 ? 0.35 : 1 }} />)}
  </View>;
}

export function IconButton({ name, label, onPress, onLongPress, disabled, filled = false }: {
  name: IconName; label: string; onPress: () => void; onLongPress?: () => void; disabled?: boolean; filled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} onLongPress={onLongPress}
    style={({ pressed }) => [styles.iconButton, filled && styles.filled, (pressed || disabled) && { opacity: 0.5 }]}>
    <Icon name={name} color={filled ? "white" : colors.accent} size={filled ? 18 : 22} />
  </Pressable>;
}

export function PlateIllustration() {
  return <View style={styles.plate}><Svg width="100%" height="100%" viewBox="0 0 342 221">
    <Circle cx="167" cy="110" r="83" fill="white" />
    <Circle cx="167" cy="110" r="63" fill="none" stroke="#cadbbf" />
    <Circle cx="146" cy="86" r="23" fill="#c9e994" /><Circle cx="187" cy="94" r="24" fill="#eab899" />
    <Circle cx="157" cy="132" r="24" fill="#e5dab6" /><Circle cx="185" cy="135" r="17" fill="#8fb773" />
  </Svg></View>;
}

const styles = StyleSheet.create({
  iconButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 26 },
  filled: { width: 40, height: 40, minWidth: 40, minHeight: 40, borderRadius: 20, backgroundColor: colors.accent },
  plate: { position: "absolute", inset: 0 },
  wave: { flex: 1, height: 22, flexDirection: "row", alignItems: "center", gap: 3 },
});
