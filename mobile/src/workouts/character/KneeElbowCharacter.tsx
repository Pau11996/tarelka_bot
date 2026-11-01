import { memo } from "react";
import Svg, { Ellipse, G, Path } from "react-native-svg";
import { kneeElbowPoses, type KneeElbowFrame } from "./kneeElbowMotion";

const palette = ["#f6b99e", "#589565", "#202b31", "#19252c", "#626463"];

/** Native vector paths; no network, video decoder or per-frame image loading. */
export const KneeElbowCharacter = memo(function KneeElbowCharacter({ frame, size = 280, backdrop = true }: {
  frame: KneeElbowFrame; size?: number; backdrop?: boolean;
}) {
  return <Svg width={size} height={size * 1.0556} viewBox="0 0 360 380" fill="none">
    {backdrop ? <Ellipse cx={180} cy={346} rx={45} ry={4} fill="#d9dcda" /> : null}
    <G transform={frame.mirror ? "translate(360 0) scale(-1 1)" : undefined}>
      <G transform="translate(91.2 49) scale(.8)">
        {kneeElbowPoses[frame.pose].map((path, layer) => <Path key={layer} d={path}
          fill={palette[layer]} fillRule="evenodd" stroke={palette[layer]}
          strokeWidth={layer === 0 ? 0 : 1.2} strokeLinejoin="round" />)}
      </G>
    </G>
  </Svg>;
});
