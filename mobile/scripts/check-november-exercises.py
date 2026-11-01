"""Verify the rasterised native body independently of animated annotations."""
import json
from pathlib import Path
import runpy

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
HELPERS = runpy.run_path(str(Path(__file__).with_name("trace-november-exercises.py")))


def main():
    results = {}
    for name, config in HELPERS["CONFIG"].items():
        data = json.loads((ROOT / "mobile/src/workouts/character" / config["file"]).read_text())
        folder = ROOT / "outputs/workout-reference/november-stretches" / name
        x, y, scale = data["transform"]
        parts, overlaps, frames = [], [], []
        for i in range(len(data["timeline"])):
            image = cv2.imread(str(folder / "rendered" / f"character-{i:03d}.png"), cv2.IMREAD_UNCHANGED)
            frames.append(image)
            mask = image[:, :, 3] > 128
            _, _, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8))
            parts.append(int(sum(stats[1:, cv2.CC_STAT_AREA] > 3)))
            source_index = config["baseSample"] if data["staticBody"] else i
            source = cv2.cvtColor(cv2.imread(str(folder / "cycle-source" / f"{source_index + 1:03d}.png")), cv2.COLOR_BGR2RGB)
            reference = cv2.warpAffine((HELPERS["HELPERS"]["classify"](source) > 0).astype(np.uint8),
                np.float32([[scale, 0, x], [0, scale, y]]), tuple(data["canvas"]), flags=cv2.INTER_NEAREST) > 0
            overlaps.append(float(np.count_nonzero(mask & reference) / np.count_nonzero(mask | reference)))
        unchanged = all(np.array_equal(frames[0], frame) for frame in frames)
        result = {"samples": len(frames), "bodyPoses": len(data["poses"]), "bodyComponents": sorted(set(parts)),
                  "bodyCompletelyStatic": unchanged, "loopIdentical": bool(np.array_equal(frames[0], frames[-1])),
                  "meanSilhouetteIoU": float(np.mean(overlaps)), "minSilhouetteIoU": min(overlaps),
                  "animatedIndicators": len(data["indicators"])}
        assert parts == [config["components"]] * len(frames), f"{name}: disconnected body parts"
        assert result["loopIdentical"], f"{name}: loop seam changed"
        assert unchanged == data["staticBody"], f"{name}: wrong body motion"
        (folder / "qa.json").write_text(json.dumps(result, indent=2) + "\n")
        results[name] = result
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
