import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { colors } from "../theme";

const paths = {
  bowl: "M3 10h18a9 9 0 0 1-18 0Z M6 21h12 M7 3v3 M12 3v3 M17 3v3",
  search: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 1 0 0-15 M16 16l5 5",
  trophy: "M8 3h8v6a4 4 0 0 1-8 0V3Z M8 5H4v2a4 4 0 0 0 4 4 M16 5h4v2a4 4 0 0 1-4 4 M12 13v5 M8 21h8 M9 21v-3h6v3",
  leaf: "M20 4C8 3 3 9 7 16s15 0 13-12Z M5 21l10-10",
  cube: "m12 3 8 5v9l-8 5-8-5V8l8-5Z M4 8l8 5 8-5 M12 13v9 M8 5l8 5",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2",
  down: "m6 9 6 6 6-6",
  sparkles:
    "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z M20 2v4 M18 4h4",
  bell: "M5 16h14l-2-3V9a5 5 0 0 0-10 0v4z M10 20h4 M12 2v2",
  gift: "M3 9h18v4H3z M5 13v8h14v-8 M12 9v12 M12 9H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z",
  plate:
    "M5 3v6 M8 3v6 M2 3v6a3 3 0 0 0 6 0 M5 12v9 M20 3c-4 2-5 7-1 9h1 M20 3v18 M12 8a5 5 0 0 1 3 8",
  camera: "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z M16 14a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  mic: "M8 6a4 4 0 0 1 8 0v5a4 4 0 0 1-8 0z M5 11v1a7 7 0 0 0 14 0v-1 M12 19v3 M9 22h6",
  plus: "M12 5v14 M5 12h14",
  arrow: "M12 19V5 M6 11l6-6 6 6",
  arrowRight: "M4 12h16 M14 6l6 6-6 6",
  trendDown: "M5 6l14 12 M9 18h10V8",
  balance: "M5 9h14 M5 15h14",
  scale: "M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z M8 8a5 5 0 0 1 8 0 M12 5v4 M8 17h8",
  trendUp: "M5 18 19 6 M9 6h10v10",
  chevron: "m9 6 6 6-6 6",
  left: "m15 6-6 6 6 6",
  close: "m6 6 12 12 M18 6 6 18",
  lock: "M7 10V7a5 5 0 0 1 10 0v3 M5 10h14v11H5Z M12 14v3",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  eyeOff: "m3 3 18 18 M10.6 10.6a2 2 0 0 0 2.8 2.8 M9.9 5.2A12 12 0 0 1 12 5c6.5 0 10 7 10 7a19 19 0 0 1-3 3.8 M6.5 6.5A20 20 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.5-1.5",
  chat: "M20 11a8 8 0 0 1-8 8H4v-8a8 8 0 0 1 16 0Z M8 10h8 M8 14h5",
  day: "M7 5h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z M8 3v4 M16 3v4 M4 11h16 M8 15h2 M14 15h2",
  profile: "M8 8a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M4 21a8 8 0 0 1 16 0",
  logout: "M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4 M10 12h11 M17 8l4 4-4 4",
  device: "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z M10 17h4 M9 7h6 M9 10h4",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z m-4 9 3 3 5-6",
  book: "M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z M12 5v15",
  settings:
    "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z M12 3.5v2.2 M12 18.3v2.2 M4.8 4.8l1.6 1.6 M17.6 17.6l1.6 1.6 M3.5 12h2.2 M18.3 12h2.2 M4.8 19.2l1.6-1.6 M17.6 6.4l1.6-1.6",
  check: "m5 12 4 4L19 6",
  edit: "m14 4 6 6 M4 20l5-1L21 7l-4-4L5 15z",
  drop: "M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z",
  walk: "M12 4a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M10 22l2-7-3-4 3-4 4 5h4 M5 12l3-4 4-1 M12 15l5 7",
  play: "m8 4 12 8-12 8Z",
  pause: "M8 4v16 M16 4v16",
  stop: "M6 6h12v12H6Z",
  telegram: "m3 11 18-7-4 17-6-6-4 2 1-5 9-5-7 7",
  gallery: "M4 4h16v16H4z M4 17l5-5 4 4 3-3 4 4 M8 8h.01",
  lines: "M5 7h14 M5 12h14 M5 17h9",
  clip: "m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48",
  stats: "M4 19V11 M10 19V5 M16 19v-6 M21 19H3",
  star: "m12 3 2.4 6.8H21l-5.4 4.1 2 6.6L12 16.8 6.4 20.5l2-6.6L3 9.8h6.6z",
} as const;
export type IconName = keyof typeof paths;

export function Icon({
  name,
  size = 24,
  color = colors.text,
  filled = false,
}: {
  name: IconName;
  size?: number;
  color?: string;
  filled?: boolean;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d={paths[name]}
        stroke={color}
        fill={filled ? color : "none"}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function BrandMark({ size = 38 }: { size?: number }) {
  const ring = "#1A4030";
  const leaf = "#3C9A46";
  return (
    <Svg width={size} height={size} viewBox="2 8 48 48">
      <Path
        d="M35.96 21.84A16.5 16.5 0 1 0 38.96 35.99"
        stroke={ring}
        strokeWidth={3.3}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M32.2 27.5A10.2 10.2 0 1 0 32.2 36.5"
        stroke={ring}
        strokeWidth={3}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M34 33.5C43.8 33 46.6 26.4 46 19C39.6 20.5 33.1 25 34 33.5Z"
        fill={leaf}
      />
      <Path
        d="M36.4 31.1C39.6 27.1 41.4 24.5 43.4 22.2"
        stroke="#E8F6E6"
        strokeWidth={1.05}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

const WAVE_HEIGHTS = [7, 13, 9, 17, 11, 19, 8, 15, 10, 18, 7, 14, 11, 16, 9];

export function Waveform({
  color = colors.accent,
  dim = false,
}: {
  color?: string;
  dim?: boolean;
}) {
  return (
    <View style={styles.wave}>
      {WAVE_HEIGHTS.map((height, index) => (
        <View
          key={index}
          style={{
            width: 3,
            height,
            borderRadius: 2,
            backgroundColor: color,
            opacity: dim && index % 3 === 0 ? 0.35 : 1,
          }}
        />
      ))}
    </View>
  );
}

export function IconButton({
  name,
  label,
  onPress,
  onLongPress,
  disabled,
  filled = false,
}: {
  name: IconName;
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  filled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.iconButton,
        filled && styles.filled,
        (pressed || disabled) && { opacity: 0.5 },
      ]}
    >
      <Icon
        name={name}
        color={filled ? "white" : colors.accent}
        size={filled ? 18 : 22}
      />
    </Pressable>
  );
}

export function PlateIllustration() {
  return (
    <View style={styles.plate}>
      <Svg width="100%" height="100%" viewBox="0 0 342 221">
        <Circle cx="167" cy="110" r="83" fill="white" />
        <Circle cx="167" cy="110" r="63" fill="none" stroke="#cadbbf" />
        <Circle cx="146" cy="86" r="23" fill="#c9e994" />
        <Circle cx="187" cy="94" r="24" fill="#eab899" />
        <Circle cx="157" cy="132" r="24" fill="#e5dab6" />
        <Circle cx="185" cy="135" r="17" fill="#8fb773" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 26,
  },
  filled: {
    width: 44,
    height: 44,
    minWidth: 44,
    minHeight: 44,
    borderRadius: 20,
    backgroundColor: colors.accent,
  },
  plate: { position: "absolute", inset: 0 },
  wave: {
    flex: 1,
    height: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
});
