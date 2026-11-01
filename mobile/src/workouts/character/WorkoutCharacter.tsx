import { memo, useId } from "react";
import Svg, { ClipPath, Defs, Ellipse, G, LinearGradient, Path, Stop } from "react-native-svg";
import { add, footPoint, project, proportions, scale, type Foot, type MorningFrame, type P2, type Side, type V3 } from "./morningMotion";

// The approved green-tank character: restrained shoulders, fitted clothes, no face details.
const ink = { skin: "#f3b294", skinLight: "#f6b99e", tank: "#589565", tankDark: "#50875d", shorts: "#202b31", shortsDark: "#19252c", hair: "#626463", shoe: "#606362" };
const lerp = (a: V3, b: V3, t: number) => add(scale(a, 1 - t), scale(b, t));
const mix = (a: P2, b: P2, t: number): P2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const offset = (p: P2, n: P2, r: number): P2 => [p[0] + n[0] * r, p[1] + n[1] * r];
const direction = (a: P2, b: P2): P2 => {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
};
const normal = (a: P2, b: P2): P2 => { const u = direction(a, b); return [-u[1], u[0]]; };
type BodyPoint = (x: number, y: number, z?: number) => P2;

function Leg({ side, yaw, fill }: { side: Side; yaw: number; fill: string }) {
  const hip = project(side.hip, yaw), knee = project(side.knee, yaw), ankle = project(side.ankle, yaw);
  const thighN = normal(hip, knee), calfN = normal(knee, ankle);
  const thigh = (t: number, r: number) => offset(mix(hip, knee, t), thighN, r);
  const calf = (t: number, r: number) => offset(mix(knee, ankle, t), calfN, r);
  // One outline through the knee and ankle, with a gentle calf taper.
  return <Path d={`M${thigh(.78, 9)} Q${thigh(.9, 8.5)} ${calf(0, 8)}
    C${calf(.15, 7.6)} ${calf(.26, 10)} ${calf(.44, 8.7)}
    C${calf(.65, 7.2)} ${calf(.85, 5.8)} ${calf(1, 5.4)}
    Q${offset(ankle, direction(knee, ankle), 2)} ${calf(1, -5.4)}
    C${calf(.84, -5.7)} ${calf(.63, -7.7)} ${calf(.44, -9)}
    C${calf(.25, -10)} ${calf(.13, -7.5)} ${calf(0, -8)}
    Q${thigh(.9, -8.5)} ${thigh(.78, -9)} Z`} fill={fill} />;
}

function Shoe({ foot, yaw }: { foot: Foot; yaw: number }) {
  const p = (x: number, y: number, z: number) => project(footPoint(foot, x, y, z), yaw);
  // Both the shoe and the ankle use the same toe pivot, including on calf raises.
  const shape = `M${p(-5.5, 23, -2)} Q${p(0, 25, -3)} ${p(5.5, 23, -2)}
    C${p(7, 20, -2)} ${p(6, 12, 6)} ${p(8.5, 9, 16)}
    C${p(11, 5, 21)} ${p(9, 1, 22)} ${p(2, 0, 22)}
    Q${p(-7, 0, 22)} ${p(-9, 3, 20)} C${p(-11, 7, 16)} ${p(-7, 12, 6)} ${p(-6, 17, -2)} Z`;
  return <G><Path d={shape} fill={ink.shoe} />
    <Path d={`M${p(-9, 3, 20)} C${p(-7, 0, 22)} ${p(6, 0, 22)} ${p(9, 3, 21)}`} stroke={ink.shortsDark} strokeWidth="1" fill="none" strokeLinecap="round" />
  </G>;
}

function Shorts({ frame, p }: { frame: MorningFrame; p: BodyPoint }) {
  const hem = (side: Side, sign: number) => {
    const hip = project(side.hip, frame.yaw), knee = project(side.knee, frame.yaw);
    const cuff = project(lerp(side.hip, side.knee, .88), frame.yaw);
    const n = normal(hip, knee), u = direction(hip, knee);
    return { hip, cuff, u, outerHip: offset(hip, n, sign * 10), outer: offset(cuff, n, sign * 10.8), inner: offset(cuff, n, -sign * 9.5) };
  };
  const l = hem(frame.left, 1), r = hem(frame.right, -1);
  const crotch = project(add(frame.pelvis, [0, -22, 0]), frame.yaw);
  const wl = p(-22, 8), wr = p(22, 8);
  return <G>
    <Path d={`M${wl} Q${p(0, 4)} ${wr}
      C${r.outerHip} ${mix(r.outerHip, r.outer, .72)} ${r.outer}
      Q${offset(r.cuff, r.u, 3)} ${r.inner} Q${offset(crotch, [1, 0], 3)} ${crotch}
      Q${offset(crotch, [-1, 0], 3)} ${l.inner} Q${offset(l.cuff, l.u, 3)} ${l.outer}
      C${mix(l.outerHip, l.outer, .72)} ${l.outerHip} ${wl} Z`} fill={ink.shorts} />
    <Path d={`M${wl} Q${p(0, 4)} ${wr} C${p(12, -2)} ${p(3, -10)} ${crotch} C${p(-3, -10)} ${p(-12, -2)} ${wl} Z`} fill={ink.shortsDark} />
  </G>;
}

function Arm({ side, yaw, left, fill, forearmOnly = false }: { side: Side; yaw: number; left: boolean; fill: string; forearmOnly?: boolean }) {
  const shoulder = project(side.shoulder, yaw), elbow = project(side.elbow, yaw), wrist = project(side.wrist, yaw);
  const start = forearmOnly ? mix(shoulder, elbow, .88) : shoulder;
  const h = left ? 1 : -1, n1 = normal(start, elbow), n2 = normal(elbow, wrist);
  const middle = direction([0, 0], [n1[0] + n2[0], n1[1] + n2[1]]);
  const elbowRadius = 5.4 / Math.max(.7, middle[0] * n1[0] + middle[1] * n1[1]);
  const edge = (sign: number) => ({ a: offset(start, n1, sign * h * (forearmOnly ? 5.4 : 7)), b: offset(elbow, middle, sign * h * elbowRadius), c: offset(wrist, n2, sign * h * 3.5) });
  const outer = edge(1), inner = edge(-1), u = direction(elbow, wrist);
  const upper = (sign: number) => offset(mix(start, elbow, .43), n1, sign * h * (forearmOnly ? 5.4 : 7.6));
  const forearm = (sign: number) => offset(mix(elbow, wrist, .36), n2, sign * h * 6.2);
  const hand = (x: number, y: number): P2 => [wrist[0] + u[1] * x * h + u[0] * y, wrist[1] - u[0] * x * h + u[1] * y];
  return <Path d={`M${outer.a} Q${upper(1)} ${mix(outer.b, outer.a, .16)} Q${outer.b} ${mix(outer.b, outer.c, .16)}
    Q${forearm(1)} ${hand(-3.5, 0)} C${hand(-4, 3)} ${hand(-3.5, 8)} ${hand(-2.2, 10)}
    Q${hand(0, 12)} ${hand(2.5, 9.5)} L${hand(3.5, 4)} Q${hand(6, 7)} ${hand(6, 4)} L${hand(3.5, -1)}
    Q${forearm(-1)} ${mix(inner.b, inner.c, .16)} Q${inner.b} ${mix(inner.b, inner.a, .16)}
    Q${upper(-1)} ${inner.a} Q${offset(start, direction(elbow, start), forearmOnly ? 0 : 7)} ${outer.a} Z`} fill={fill} />;
}

export const WorkoutCharacter = memo(function WorkoutCharacter({ frame, size = 280, backdrop = true }: { frame: MorningFrame; size?: number; backdrop?: boolean }) {
  const prefix = `coach${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const { left, right, pelvis, lean, yaw, shrug } = frame;
  const p: BodyPoint = (x, y, z = 0) => project([pelvis[0] + x * Math.cos(lean) + y * Math.sin(lean), pelvis[1] + y * Math.cos(lean) - x * Math.sin(lean), pelvis[2] + z], yaw);
  const head = project(frame.head, yaw);
  const lifted = (side: Side) => Math.max(0, (side.elbow[1] - side.shoulder[1]) / proportions.upperArm);
  const underL = 47 + lifted(left) * 4, underR = 47 + lifted(right) * 4;
  const collarL = p(-15.5, 77 + shrug * .45), collarR = p(15.5, 77 + shrug * .45);
  const strapL = p(-20, 78 + shrug), strapR = p(20, 78 + shrug);
  const hemL = p(-22, 8), hemR = p(22, 8);
  // A single skin torso overlaps the arm roots. Straps and armholes share this
  // coordinate system, so the top cannot drift off the shoulders on a shrug/bend.
  const torso = `M${p(-7.5, 91)} L${p(7.5, 91)} Q${p(7, 84)} ${p(15, 80 + shrug * .5)}
    Q${p(24, 84 + shrug)} ${p(29, 76 + shrug)} Q${p(29, 66 + shrug)} ${p(22.5, underR)}
    Q${p(21, 28)} ${hemR} Q${p(0, 4)} ${hemL} Q${p(-21, 28)} ${p(-22.5, underL)}
    Q${p(-29, 66 + shrug)} ${p(-29, 76 + shrug)} Q${p(-24, 84 + shrug)} ${p(-15, 80 + shrug * .5)} Q${p(-7, 84)} ${p(-7.5, 91)} Z`;
  const tank = `M${collarL} C${p(-12, 58)} ${p(12, 58)} ${collarR} L${strapR}
    C${p(20, 67 + shrug)} ${p(19.5, 58)} ${p(22.5, underR)}
    C${p(23, 36)} ${p(20.5, 20)} ${hemR} Q${p(0, 3)} ${hemL}
    C${p(-20.5, 20)} ${p(-23, 36)} ${p(-22.5, underL)}
    C${p(-19.5, 58)} ${p(-20, 67 + shrug)} ${strapL} Z`;
  const skin = `url(#${prefix}skin)`, fabric = `url(#${prefix}fabric)`;
  const nearArm = (side: Side) => side.wrist[2] > side.shoulder[2] + 6;
  return <Svg width={size} height={size * 1.0556} viewBox="0 0 360 380" fill="none">
    <Defs>
      <LinearGradient id={`${prefix}skin`} x1="80" y1="70" x2="260" y2="340" gradientUnits="userSpaceOnUse"><Stop offset="0" stopColor={ink.skinLight} /><Stop offset="1" stopColor={ink.skin} /></LinearGradient>
      <LinearGradient id={`${prefix}fabric`} x1="140" y1="120" x2="220" y2="210" gradientUnits="userSpaceOnUse"><Stop offset="0" stopColor={ink.tank} /><Stop offset="1" stopColor={ink.tankDark} /></LinearGradient>
      <ClipPath id={`${prefix}body`}><Path d={torso} /></ClipPath>
    </Defs>
    {backdrop ? <Ellipse cx={180 + pelvis[0] * Math.cos(yaw)} cy="347" rx="44" ry="5" fill="#d9dcda" /> : null}
    <Leg side={left} yaw={yaw} fill={skin} /><Leg side={right} yaw={yaw} fill={skin} />
    <Shorts frame={frame} p={p} />
    <Shoe foot={left.foot} yaw={yaw} /><Shoe foot={right.foot} yaw={yaw} />
    <Arm side={left} yaw={yaw} left fill={skin} /><Arm side={right} yaw={yaw} left={false} fill={skin} />
    <Path d={torso} fill={skin} />
    <G clipPath={`url(#${prefix}body)`}><Path d={tank} fill={fabric} /></G>
    {nearArm(left) ? <Arm side={left} yaw={yaw} left fill={skin} forearmOnly /> : null}
    {nearArm(right) ? <Arm side={right} yaw={yaw} left={false} fill={skin} forearmOnly /> : null}
    <G transform={`translate(${head}) rotate(${lean * 180 / Math.PI})`}>
      <Path d="M-11,0 C-14,-8 -13,-14 -8,-17 Q0,-21 8,-17 C13,-14 14,-8 11,0 Z" fill={ink.hair} />
      <Path d="M-11,-8 C-13,-4 -13,5 -9,10 L-4,14 Q0,16 4,14 L9,10 C13,5 13,-4 11,-8 Q0,-13 -11,-8 Z" fill={ink.skinLight} />
      <Path d="M-12,3 C-13,-3 -14,-13 -8,-17 Q0,-21 8,-17 C14,-13 13,-3 12,3 L10,-9 Q0,-12 -10,-9 Z" fill={ink.hair} />
    </G>
  </Svg>;
});
