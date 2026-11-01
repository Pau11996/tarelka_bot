import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, AppState } from "react-native";
import { cycleAt, previewProgress, type MorningMovement } from "./morningMotion";

/** Pause freezes the pose; resuming never rewinds it or counts background time. */
export function useExerciseMotion(movement: string, identity: string, playing: boolean, timing?: { duration: number; preview: number }) {
  const preview = timing?.preview ?? previewProgress[movement as MorningMovement];
  const duration = timing?.duration;
  const elapsed = useRef(0), previousIdentity = useRef(identity);
  const [cycle, setCycle] = useState(playing ? 0 : preview);
  const [reduced, setReduced] = useState<boolean | null>(null);
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReduced(value); }).catch(() => { if (mounted) setReduced(false); });
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    const app = AppState.addEventListener("change", value => setActive(value === "active"));
    return () => { mounted = false; motion.remove(); app.remove(); };
  }, []);
  useEffect(() => {
    if (previousIdentity.current !== identity) {
      previousIdentity.current = identity; elapsed.current = 0;
      setCycle(playing ? 0 : preview);
    }
    if (reduced === null) return;
    if (reduced) { setCycle(preview); return; }
    if (!playing || !active) return;
    let frame = 0, previous: number | null = null, lastPaint = 0;
    const draw = (now: number) => {
      // A delayed JS frame must not cause a visible jump through the movement.
      if (previous !== null) elapsed.current += Math.min(now - previous, 80);
      previous = now;
      if (now - lastPaint >= 1000 / 30) { setCycle(duration ? (elapsed.current / (duration * 1000)) % 1 : cycleAt(elapsed.current, movement as MorningMovement)); lastPaint = now; }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [movement, identity, playing, active, reduced, preview, duration]);
  return { cycle, reduced: reduced === true };
}
