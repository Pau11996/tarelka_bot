"""Check every rasterised native frame against its source crop and loop seam.

Run render-reference-exercise.cjs for all four movements first.
The metric measures silhouette agreement, not individual exercise technique.
"""
import json
from pathlib import Path
import runpy

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
helpers = runpy.run_path(str(Path(__file__).with_name("trace-reference-exercises.py")))


def main():
    results = {}
    for movement, config in helpers["CONFIG"].items():
        data = json.loads((ROOT / "mobile/src/workouts/character" / config["file"]).read_text())
        out = ROOT / "outputs/workout-reference/exercises-batch" / movement
        count = len(data["timeline"])
        ious, parts = [], []
        x, y, scale = data["transform"]
        for i in range(count):
            image = cv2.imread(str(out / "rendered" / f"character-{i:03d}.png"), cv2.IMREAD_UNCHANGED)
            mask = image[:, :, 3] > 128
            _, _, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8))
            parts.append(int(sum(stats[1:, cv2.CC_STAT_AREA] > 3)))
            source = cv2.cvtColor(cv2.imread(str(out / "cycle-source" / f"{i + 1:03d}.png")), cv2.COLOR_BGR2RGB)
            reference = cv2.warpAffine((helpers["classify"](source) > 0).astype(np.uint8),
                np.float32([[scale, 0, x], [0, scale, y]]), tuple(data["canvas"]), flags=cv2.INTER_NEAREST) > 0
            ious.append(float(np.count_nonzero(mask & reference) / np.count_nonzero(mask | reference)))
        first = cv2.imread(str(out / "rendered/character-000.png"), cv2.IMREAD_UNCHANGED)
        last = cv2.imread(str(out / "rendered" / f"character-{count - 1:03d}.png"), cv2.IMREAD_UNCHANGED)
        result = {"samples": count, "poses": len(data["poses"]), "duration": data["duration"],
                  "bodyComponents": sorted(set(parts)), "meanSilhouetteIoU": float(np.mean(ious)),
                  "minSilhouetteIoU": min(ious), "worstSample": int(np.argmin(ious)),
                  "loopIdentical": bool(np.array_equal(first, last))}
        (out / "qa.json").write_text(json.dumps(result, indent=2) + "\n")
        results[movement] = result
        assert parts == [1] * count, f"{movement}: detached body parts"
        assert result["loopIdentical"], f"{movement}: loop seam changed"
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
