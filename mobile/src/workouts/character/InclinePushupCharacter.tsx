import { memo } from "react";
import Svg, { Ellipse, G, Path } from "react-native-svg";
import { inclinePushupPoses, inclinePushupSupport, type InclinePushupFrame } from "./inclinePushupMotion";

const palette = ["#f6b99e", "#589565", "#202b31", "#19252c", "#626463"];

/** Measured vector silhouettes keep torso, hands and support aligned. */
export const InclinePushupCharacter = memo(function InclinePushupCharacter({ frame, size = 280, backdrop = true }: {
  frame: InclinePushupFrame; size?: number; backdrop?: boolean;
}) {
  return <Svg width={size} height={size * 1.0556} viewBox="0 0 360 380" fill="none">
    <G transform={frame.mirror ? "translate(360 0) scale(-1 1)" : undefined}>
      <G transform="translate(20 90)">
        {backdrop ? <>
          <Ellipse cx={34} cy={242} rx={20} ry={3} fill="#d9dcda" />
          <Ellipse cx={272} cy={253} rx={41} ry={3} fill="#d9dcda" />
          {inclinePushupSupport.map(([fill, path], layer) => <Path key={layer} d={path} fill={fill} />)}
        </> : null}
        {inclinePushupPoses[frame.pose].map((path, layer) => <Path key={layer} d={path}
          fill={palette[layer]} fillRule="evenodd" stroke={palette[layer]}
          strokeWidth={layer === 0 ? 0 : 1.2} strokeLinejoin="round" />)}
      </G>
    </G>
  </Svg>;
});
