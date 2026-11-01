import { memo } from "react";
import Svg, { Ellipse, G, Path } from "react-native-svg";
import { squatKickPoses, type SquatKickFrame } from "./squatKickMotion";

const palette = ["#f6b99e", "#589565", "#202b31", "#19252c", "#626463"];

export const SquatKickCharacter = memo(function SquatKickCharacter({ frame, size = 280, backdrop = true }: {
  frame: SquatKickFrame; size?: number; backdrop?: boolean;
}) {
  return <Svg width={size} height={size * 1.0556} viewBox="0 0 360 380" fill="none">
    <G transform={frame.mirror ? "translate(360 0) scale(-1 1)" : undefined}>
      <G transform="translate(60 28) scale(.92)">
        {backdrop ? <Ellipse cx={98} cy={333} rx={35} ry={4} fill="#d9dcda" /> : null}
        {squatKickPoses[frame.pose].map((path, layer) => <Path key={layer} d={path}
          fill={palette[layer]} fillRule="evenodd" stroke={palette[layer]}
          strokeWidth={layer === 0 ? 0 : 1.2} strokeLinejoin="round" />)}
      </G>
    </G>
  </Svg>;
});
