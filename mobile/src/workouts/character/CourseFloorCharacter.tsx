import { memo } from "react";
import Svg, { G, Path } from "react-native-svg";
import type { FloorFrame, Point } from "./courseFloorMotion";

const skin = "#f7c2af", shade = "#e8af9b", green = "#589565", shorts = "#1e2730";
const d = (p: Point) => `${p[0].toFixed(3)} ${p[1].toFixed(3)}`;
function Segment({ a, b, width, color }: { a: Point; b: Point; width: number; color: string }) {
  return <Path d={`M${d(a)} L${d(b)}`} stroke={color} strokeWidth={width} strokeLinecap="round" />;
}
function Leg({ limb, far, raised, bridge }: { limb: FloorFrame["legs"][number]; far: boolean; raised: number; bridge: boolean }) {
  const { root, joint, end } = limb;
  const hem: Point = [root[0] + (joint[0] - root[0]) * .5, root[1] + (joint[1] - root[1]) * .5];
  return <G><Segment a={root} b={joint} width={23} color={far ? shade : skin} /><Segment a={joint} b={end} width={16} color={far ? shade : skin} />
    <Segment a={root} b={hem} width={28} color={far ? "#131e26" : shorts} />
    <G transform={`translate(${end[0]},${end[1]}) rotate(${-raised * 15}) scale(${bridge ? 1 : -1},1)`}>
      <Path d="M-8 -4 Q-2 -1 6 -3 L13 3 Q22 4 22 9 L-11 9 Q-14 6 -8 -4Z" fill={far ? "#515252" : "#656363"} />
      <Path d="M-11 9 H22" stroke="#373b3e" strokeWidth="2" strokeLinecap="round" />
    </G></G>;
}
function Arm({ limb, far }: { limb: FloorFrame["arms"][number]; far: boolean }) {
  return <G><Segment a={limb.root} b={limb.joint} width={16} color={far ? shade : skin} /><Segment a={limb.joint} b={limb.end} width={13} color={far ? shade : skin} /><Path d={`M${d(limb.end)} l10 2`} stroke={far ? shade : skin} strokeWidth={9} strokeLinecap="round" /></G>;
}
export const CourseFloorCharacter = memo(function CourseFloorCharacter({ frame, size = 280 }: { frame: FloorFrame; size?: number }) {
  const { shoulder: a, hip: b } = frame, bridge = frame.movement === "glute_bridge";
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy), n: Point = [-dy / length, dx / length];
  const offset = (p: Point, v: number): Point => [p[0] + n[0] * v, p[1] + n[1] * v];
  const neck: Point = bridge ? [78, 239] : [262, 164];
  return <Svg width={size} height={size * 300 / 360} viewBox="0 0 360 300" fill="none">
    <Path d="M31 258 L317 258 L343 275 L12 275Z" fill="#c7edfa" />
    <Leg limb={frame.legs[0]} far bridge={bridge} raised={bridge ? 0 : frame.lift[0]} /><Arm limb={frame.arms[0]} far />
    <Segment a={a} b={neck} width={24} color={skin} /><Segment a={neck} b={frame.head} width={17} color={skin} />
    <Path d={`M${d(offset(a, -19))} Q${d(offset([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], -20))} ${d(offset(b, -15))} L${d(offset(b, 16))} Q${d(offset([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 15))} ${d(offset(a, 19))} Q${d(a)} ${d(offset(a, -19))}Z`} fill={green} />
    <Path d={`M${d(offset(b, -15))} L${d(offset(b, 16))} L${d(offset([b[0] - dx / length * 15, b[1] - dy / length * 15], 16))} L${d(offset([b[0] - dx / length * 15, b[1] - dy / length * 15], -15))}Z`} fill={shorts} />
    <Leg limb={frame.legs[1]} far={false} bridge={bridge} raised={bridge ? 0 : frame.lift[1]} />
    <G transform={`translate(${frame.head[0]},${frame.head[1]}) rotate(${bridge ? -65 : 18})`}>
      <Path d="M-12 -15 Q1 -23 12 -12 L13 -2 L18 3 L13 6 L11 16 Q4 23 -5 16 L-14 7 Q-19 -5 -12 -15Z" fill={skin} />
      <Path d="M-14 7 Q-22 -5 -13 -17 Q-2 -27 11 -17 Q17 -12 13 -6 L8 -10 Q2 -15 -5 -10 L-7 2 L-11 0Z" fill="#656363" />
      <Path d="M-9 2 Q-4 -1 -4 5" stroke={shade} strokeWidth={2} strokeLinecap="round" />
    </G>
    <Arm limb={frame.arms[1]} far={false} />
  </Svg>;
});
