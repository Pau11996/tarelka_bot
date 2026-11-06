import { memo } from "react";
import Svg, { G, Path } from "react-native-svg";
import type { Point } from "./courseFloorMotion";
import type { PushupFrame } from "./pushupMotion";

const skin = "#f7c2af", shade = "#e8af9b", shirt = "#589565", shorts = "#1e2730";
const d = (point: Point) => `${point[0].toFixed(3)} ${point[1].toFixed(3)}`;
function Segment({ a, b, width, color }: { a: Point; b: Point; width: number; color: string }) {
  return <Path d={`M${d(a)} L${d(b)}`} stroke={color} strokeWidth={width} strokeLinecap="round" />;
}
function Arm({ limb, far }: { limb: PushupFrame["arms"][number]; far: boolean }) {
  return <G><Segment a={limb.root} b={limb.joint} width={16} color={far ? shade : skin} />
    <Segment a={limb.joint} b={limb.end} width={13} color={far ? shade : skin} />
    <Path d={`M${d(limb.end)} l14 2`} stroke={far ? shade : skin} strokeWidth={8} strokeLinecap="round" /></G>;
}
function Leg({ limb, far, knees }: { limb: PushupFrame["legs"][number]; far: boolean; knees: boolean }) {
  const hem: Point = [limb.root[0] + (limb.joint[0] - limb.root[0]) * .5, limb.root[1] + (limb.joint[1] - limb.root[1]) * .5];
  return <G><Segment a={limb.root} b={limb.joint} width={22} color={far ? shade : skin} />
    <Segment a={limb.joint} b={limb.end} width={15} color={far ? shade : skin} />
    <Segment a={limb.root} b={hem} width={27} color={far ? "#131e26" : shorts} />
    <G transform={`translate(${limb.end[0]},${limb.end[1]}) rotate(${knees ? 45 : 0})`}>
      <Path d="M-8 -17 Q0 -18 4 -9 L12 1 Q13 5 8 6 L-8 6 Q-12 2 -10 -4Z" fill={far ? "#515252" : "#656363"} />
      <Path d="M-8 6 H9" stroke="#373b3e" strokeWidth={2} strokeLinecap="round" />
    </G></G>;
}
export const PushupCharacter = memo(function PushupCharacter({ frame, size = 280 }: { frame: PushupFrame; size?: number }) {
  const { shoulder, hip } = frame, knees = frame.movement === "knee_push_up";
  const normal: Point = [Math.sin(frame.angle), Math.cos(frame.angle)];
  const offset = (point: Point, amount: number): Point => [point[0] + normal[0] * amount, point[1] + normal[1] * amount];
  return <Svg width={size} height={size * 280 / 400} viewBox="0 0 400 280" fill="none">
    <Path d="M28 239 H344 L371 263 H12Z" fill="#c7edfa" />
    <Path d="M28 239 H344" stroke="#a4d9e9" strokeWidth={2} />
    <Leg limb={frame.legs[0]} far knees={knees} /><Arm limb={frame.arms[0]} far />
    <Segment a={shoulder} b={frame.neck} width={22} color={skin} />
    <Segment a={frame.neck} b={frame.head} width={16} color={skin} />
    <Path d={`M${d(offset(shoulder, -18))} L${d(offset(hip, -15))} Q${d(offset(hip, 0))} ${d(offset(hip, 15))} L${d(offset(shoulder, 19))} Q${d(offset(shoulder, 0))} ${d(offset(shoulder, -18))}Z`} fill={shirt} />
    <Path d={`M${d(offset(hip, -15))} L${d(offset(hip, 15))}`} stroke={shorts} strokeWidth={12} />
    <Leg limb={frame.legs[1]} far={false} knees={knees} />
    <G transform={`translate(${frame.head[0]},${frame.head[1]}) rotate(${45 - frame.angle * 180 / Math.PI})`}>
      <Path d="M-12 -15 Q1 -23 12 -12 L13 -2 L18 3 L13 6 L11 16 Q4 23 -5 16 L-14 7 Q-19 -5 -12 -15Z" fill={skin} />
      <Path d="M-14 7 Q-22 -5 -13 -17 Q-2 -27 11 -17 Q17 -12 13 -6 L8 -10 Q2 -15 -5 -10 L-7 2 L-11 0Z" fill="#656363" />
      <Path d="M-9 2 Q-4 -1 -4 5" stroke={shade} strokeWidth={2} strokeLinecap="round" />
    </G>
    <Arm limb={frame.arms[1]} far={false} />
  </Svg>;
});
