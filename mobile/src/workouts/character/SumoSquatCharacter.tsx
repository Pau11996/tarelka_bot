import { memo } from "react";
import Svg, { Ellipse, G, Path } from "react-native-svg";
import { sumoSquatPoses, type SumoSquatFrame } from "./sumoSquatMotion";

const palette = ["#f6b99e", "#589565", "#202b31", "#19252c", "#626463"];

export const SumoSquatCharacter = memo(function SumoSquatCharacter({ frame, size = 280, backdrop = true }: {
  frame: SumoSquatFrame; size?: number; backdrop?: boolean;
}) {
  return <Svg width={size} height={size * 1.0556} viewBox="0 0 360 380" fill="none">
    <G transform={frame.mirror ? "translate(360 0) scale(-1 1)" : undefined}>
      <G transform="translate(59 22) scale(1.1)">
        {backdrop ? <Ellipse cx={110} cy={293} rx={85} ry={4} fill="#d9dcda" /> : null}
        {sumoSquatPoses[frame.pose].map((path, layer) => <Path key={layer} d={path}
          fill={palette[layer]} fillRule="evenodd" stroke={palette[layer]}
          strokeWidth={layer === 0 ? 0 : 1.2} strokeLinejoin="round" />)}
      </G>
    </G>
  </Svg>;
});
