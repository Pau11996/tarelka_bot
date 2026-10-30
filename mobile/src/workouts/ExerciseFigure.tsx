import { memo, useEffect, useState } from "react";
import { AccessibilityInfo, AppState, View } from "react-native";
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from "react-native-svg";
import { animationSeconds, exercisePose, type Point } from "./poses";
import type { Exercise } from "./types";

function Limb({ a, b, color, width = 11 }: { a: Point; b: Point; color: string; width?: number }) {
  return <Line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={color} strokeWidth={width} strokeLinecap="round" />;
}
export const ExerciseFigure = memo(function ExerciseFigure({ exercise, playing = false, size = 240 }: { exercise: Exercise; playing?: boolean; size?: number }) {
  const [cycle, setCycle] = useState(.15), [reduced, setReduced] = useState(false), [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduced(value); }).catch(() => undefined);
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    const app = AppState.addEventListener("change", value => setActive(value === "active"));
    return () => { alive = false; motion.remove(); app.remove(); };
  }, []);
  useEffect(() => {
    if (!playing || reduced || !active) return;
    let frame = 0, start = performance.now(), previous = 0;
    const draw = (now: number) => {
      if (now - previous >= 40) { setCycle(((now - start) / (animationSeconds(exercise.animation) * 1000)) % 1); previous = now; }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [playing, reduced, active, exercise.id, exercise.animation]);
  const p = exercisePose(exercise.animation, cycle), side = exercise.animation === "wall_push" || exercise.animation === "calf_stretch";
  const skin = "#d9a67d", shadow = "#bd8c69", green = "#4d9774", pants = "#254f40";
  const neck: Point = [(p.shoulderL[0] + p.shoulderR[0]) / 2, (p.shoulderL[1] + p.shoulderR[1]) / 2];
  return <View accessible accessibilityRole="image" accessibilityLabel={`${exercise.title}. ${exercise.cue}`} style={{ width: size, height: size * 1.08 }}>
    <Svg width="100%" height="100%" viewBox="0 0 240 260" fill="none">
      <Ellipse cx="120" cy="241" rx="91" ry="10" fill="#d6e5ce" />
      <G transform={exercise.mirror ? "translate(240,0) scale(-1,1)" : undefined}>
        {side ? <><Rect x="212" y="38" width="7" height="201" rx="3" fill="#c4d6bb" /><Line x1="220" y1="40" x2="220" y2="239" stroke="#acc5a1" strokeWidth="2" /></> : null}
        <Limb a={p.hipL} b={p.kneeL} color={pants} width={17} /><Limb a={p.kneeL} b={p.footL} color={pants} width={13} />
        <Limb a={p.hipR} b={p.kneeR} color="#34634e" width={17} /><Limb a={p.kneeR} b={p.footR} color="#34634e" width={13} />
        <Path d={exercise.animation === "calf_raise" ? `M${p.footL[0] + 7} ${p.footL[1]} L${p.footL[0] - 16} 233 v5 l23 ${p.footL[1] - 233} Z` : `M${p.footL[0] - 8} ${p.footL[1]} q-8 0 -9 5 h24 v-5 Z`} fill="#fbfaf2" stroke="#66876c" strokeWidth="1.5" />
        <Path d={exercise.animation === "calf_raise" ? `M${p.footR[0] - 7} ${p.footR[1]} L${p.footR[0] + 18} 233 v5 l-25 ${p.footR[1] - 233} Z` : `M${p.footR[0] - 7} ${p.footR[1]} v5 h25 q-2 -5 -10 -5 Z`} fill="#fbfaf2" stroke="#66876c" strokeWidth="1.5" />
        <Limb a={p.shoulderL} b={p.elbowL} color={green} width={13} /><Limb a={p.elbowL} b={p.handL} color={shadow} width={10} />
        <Limb a={neck} b={[p.head[0], p.head[1] + 21]} color={skin} width={13} />
        <Path d={`M${p.shoulderL.join(" ")} Q${neck[0]} ${neck[1] + 6} ${p.shoulderR.join(" ")} L${p.hipR[0] + 5} ${p.hipR[1] + 4} Q${(p.hipL[0] + p.hipR[0]) / 2} ${p.hipL[1] + 10} ${p.hipL[0] - 5} ${p.hipL[1] + 4} Z`} fill={green} />
        <Path d={`M${p.shoulderL[0] + 4} ${p.shoulderL[1] + 6} L${p.hipL[0]} ${p.hipL[1]}`} stroke="#377d5c" strokeWidth="3" opacity=".5" />
        <Limb a={p.shoulderR} b={p.elbowR} color="#5da782" width={13} /><Limb a={p.elbowR} b={p.handR} color={skin} width={10} />
        <Circle cx={p.handL[0]} cy={p.handL[1]} r="5.5" fill={shadow} /><Circle cx={p.handR[0]} cy={p.handR[1]} r="5.5" fill={skin} />
        <Ellipse cx={p.head[0]} cy={p.head[1]} rx={side ? 14 : 17} ry="21" fill={skin} />
        <Path d={`M${p.head[0] - 16} ${p.head[1] - 1} Q${p.head[0] - 22} ${p.head[1] - 28} ${p.head[0] + 4} ${p.head[1] - 24} Q${p.head[0] + 23} ${p.head[1] - 22} ${p.head[0] + 16} ${p.head[1] - 8} Q${p.head[0] + 2} ${p.head[1] - 18} ${p.head[0] - 9} ${p.head[1] - 10} L${p.head[0] - 11} ${p.head[1] + 3} Z`} fill="#344638" />
        <Circle cx={p.head[0] + (side ? 9 : 6)} cy={p.head[1]} r="1.6" fill="#344638" />
        {!side ? <Circle cx={p.head[0] - 6} cy={p.head[1]} r="1.6" fill="#344638" /> : null}
        <Path d={`M${p.head[0] + (side ? 5 : -4)} ${p.head[1] + 10} q4 3 8 0`} stroke="#94634e" strokeWidth="1.5" strokeLinecap="round" />
        <Path d={`M${neck[0] - 3} ${neck[1] + 21} q9 -8 12 0 q-9 10 -12 0Z`} fill="#d8edb1" />
      </G>
    </Svg>
  </View>;
});
