import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { achievementColors as c } from "../theme";

export function WeightGoalProgress({ progress }: { progress: number }) {
  const fraction = Math.max(0, Math.min(1, progress));
  const circumference = 2 * Math.PI * 33;
  return <View accessible={false} style={s.ring}>
    <Svg width={80} height={80} viewBox="0 0 80 80" accessible={false}>
      <Circle cx={40} cy={40} r={33} fill="none" stroke={c.line} strokeWidth={6} />
      {fraction > 0 ? <Circle cx={40} cy={40} r={33} fill="none" stroke={c.green} strokeWidth={6} strokeLinecap="round" strokeDasharray={`${circumference * fraction} ${circumference}`} transform="rotate(-90 40 40)" /> : null}
    </Svg>
    <View style={s.label}><Text style={s.percent}>{Math.round(fraction * 100)}%</Text><Text style={s.caption}>пройдено</Text></View>
  </View>;
}

const s = StyleSheet.create({
  ring: { width: 80, height: 80 },
  label: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  percent: { color: c.dark, fontSize: 19, lineHeight: 24, fontWeight: "700", fontVariant: ["tabular-nums"] },
  caption: { color: c.green, fontSize: 9, lineHeight: 13 },
});
