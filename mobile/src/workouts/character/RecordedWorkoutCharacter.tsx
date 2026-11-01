import { memo, useId } from "react";
import Svg, { ClipPath, Defs, G, Path } from "react-native-svg";
import { getRecordedWorkoutAsset, type RecordedWorkoutFrame } from "./recordedWorkoutMotion";

/** Complete source contours keep every joint, support and clothing layer aligned. */
export const RecordedWorkoutCharacter = memo(function RecordedWorkoutCharacter({ frame, size = 280, backdrop = true }: {
  frame: RecordedWorkoutFrame; size?: number; backdrop?: boolean;
}) {
  const data = getRecordedWorkoutAsset(frame.movement, frame.mirror);
  const silhouetteId = `workout-silhouette-${frame.movement}-${frame.mirror ? "left" : "right"}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const pose = data.poses[frame.pose];
  const [width, height] = data.canvas, [x, y, scale] = data.transform;
  return <Svg width={size} height={size * height / width} viewBox={`0 0 ${width} ${height}`} fill="none">
    <Defs><ClipPath id={silhouetteId}><Path d={pose[0]} fillRule="evenodd" clipRule="evenodd" /></ClipPath></Defs>
    <G transform={frame.mirror && !data.authoredMirror ? `translate(${width} 0) scale(-1 1)` : undefined}>
      <G transform={`translate(${x} ${y}) scale(${scale})`}>
        {backdrop ? data.support.map(([fill, path], layer) => <Path key={`support:${layer}`} d={path} fill={fill} fillRule="evenodd" />) : null}
        <G clipPath={`url(#${silhouetteId})`}>
          {pose.map((path, layer) => <Path key={layer} d={path} fill={data.palette[layer]} fillRule="evenodd"
            stroke={data.palette[layer]} strokeWidth={layer === 0 ? 0 : .35} strokeLinejoin="round" />)}
        </G>
        {backdrop ? data.indicators?.map((indicator, index) => {
          const [opacity, dx, dy] = indicator.samples[frame.sample];
          return <G key={`indicator:${index}`} opacity={opacity} transform={`translate(${dx} ${dy})`}>
            <Path d={indicator.path} fill={indicator.fill} fillRule="evenodd"
              stroke={indicator.stroke} strokeWidth={indicator.strokeWidth}
              strokeDasharray={indicator.strokeDasharray}
              strokeLinecap={indicator.strokeLinecap === "round" ? "round" : undefined}
              strokeLinejoin="round" />
          </G>;
        }) : null}
      </G>
    </G>
  </Svg>;
});
