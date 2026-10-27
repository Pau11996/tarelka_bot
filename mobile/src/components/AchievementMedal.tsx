import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { achievementColors as c } from "../theme";
import { Icon, type IconName } from "./Brand";

export function achievementTone(key: string) {
  return key.startsWith("diary") ? { background: "#fff0dc", border: "#edcfa0", ink: "#885019", ribbon: "#d69b43", icon: "day" as IconName }
    : key === "first_weigh_in" ? { background: "#e9f4e7", border: "#c7dec7", ink: "#256644", ribbon: "#63a77a", icon: "scale" as IconName }
    : key === "weight_goal_completed" ? { background: "#fff3d3", border: "#e8d49b", ink: "#7d5b12", ribbon: "#d5ad4b", icon: "trophy" as IconName }
    : { background: "#f1ebfa", border: "#dbceed", ink: "#65508e", ribbon: "#a18ac4", icon: "scale" as IconName };
}

const milestones: Record<string, { value: string; unit: string }> = {
  diary_7_days: { value: "7", unit: "ДНЕЙ" }, diary_30_days: { value: "30", unit: "ДНЕЙ" },
  weight_4_weeks: { value: "4", unit: "НЕДЕЛИ" }, weight_12_weeks: { value: "12", unit: "НЕДЕЛЬ" },
};

export function AchievementMedal({ badgeKey, earned, size = 64 }: { badgeKey: string; earned: boolean; size?: number }) {
  const tone = earned ? achievementTone(badgeKey) : { background: "#f1f4ee", ink: "#637466", ribbon: "#d5ddd1" };
  const milestone = milestones[badgeKey];
  const scale = size / 64;
  return <View style={{ width: size, height: size * 1.125, flexShrink: 0 }} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Svg width={size} height={size * 1.125} viewBox="0 0 64 72">
      <Path d="m17 42-5 24 12-5 7 9 5-25 M35 45l5 25 7-9 12 5-7-24" fill={tone.ribbon} stroke={tone.ink} strokeWidth={1.5} strokeLinejoin="round" />
      <Circle cx={32} cy={28} r={25} fill={tone.background} stroke={tone.ink} strokeWidth={2} />
      <Circle cx={32} cy={28} r={19.5} fill={c.white} stroke={tone.ribbon} strokeWidth={1.5} />
    </Svg>
    <View style={[s.symbol, { left: 12 * scale, top: 9 * scale, width: 40 * scale, height: 38 * scale }]}>
      {milestone ? <><Text style={{ fontSize: 23 * scale, lineHeight: 25 * scale, fontWeight: "700", color: tone.ink, fontVariant: ["tabular-nums"] }}>{milestone.value}</Text><Text style={{ fontSize: 7 * scale, lineHeight: 9 * scale, fontWeight: "700", letterSpacing: 0.5, color: tone.ink }}>{milestone.unit}</Text></>
        : <Icon name={achievementTone(badgeKey).icon} size={26 * scale} color={tone.ink} />}
    </View>
    <View style={[s.status, { right: 0, top: 38 * scale, backgroundColor: earned ? tone.ink : "#edf1e9" }]}>
      <Icon name={earned ? "check" : "lock"} size={12} color={earned ? c.white : tone.ink} />
    </View>
  </View>;
}

const s = StyleSheet.create({
  symbol: { position: "absolute", alignItems: "center", justifyContent: "center" },
  status: { position: "absolute", width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: c.white, alignItems: "center", justifyContent: "center" },
});
