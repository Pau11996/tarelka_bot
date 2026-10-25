import { StyleSheet, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { achievementColors as c } from "../theme";
import { Icon, type IconName } from "./Brand";

export function achievementTone(key: string) {
  return key.startsWith("diary") ? { background: c.peach, ink: c.gold, icon: "day" as IconName }
    : key === "first_weigh_in" ? { background: c.mint, ink: c.green, icon: "scale" as IconName }
    : { background: c.lilac, ink: c.purple, icon: key === "weight_goal_completed" ? "trophy" as IconName : "scale" as IconName };
}

export function AchievementMedal({ badgeKey, earned }: { badgeKey: string; earned: boolean }) {
  const tone = achievementTone(badgeKey);
  return <View style={s.medal} accessible={false}>
    <Svg width={48} height={54} viewBox="0 0 60 67" accessible={false}>
      <Path d="m19 43-4 15 15-7 15 7-4-15" fill={tone.background} stroke={tone.ink} strokeWidth={1.2} />
      {Array.from({ length: 12 }, (_, i) => <Circle key={i} cx={30 + Math.cos(i * Math.PI / 6) * 18} cy={26 + Math.sin(i * Math.PI / 6) * 18} r={7} fill={tone.background} />)}
      <Circle cx={30} cy={26} r={19} fill={tone.background} stroke={earned ? tone.ink : c.line} strokeWidth={0.8} />
      <Circle cx={30} cy={26} r={14} fill="none" stroke={earned ? tone.ink : c.muted} strokeWidth={0.8} />
    </Svg>
    <View style={s.symbol}><Icon name={earned ? tone.icon : "lock"} size={19} color={earned ? tone.ink : c.muted} /></View>
    {earned ? <View style={s.check}><Icon name="check" size={10} color={tone.ink} /></View> : null}
  </View>;
}

const s = StyleSheet.create({
  medal: { width: 48, height: 54 },
  symbol: { position: "absolute", left: 14.5, top: 11.5 },
  check: { position: "absolute", width: 14, height: 14, borderRadius: 7, left: 32, top: 28, backgroundColor: c.white, alignItems: "center", justifyContent: "center" },
});
