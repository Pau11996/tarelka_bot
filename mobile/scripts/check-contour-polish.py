"""Check native renders for detached parts, altered timing and skin at soles."""
import json
from pathlib import Path
import runpy

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
FOLDER = ROOT / "outputs/workout-reference/contour-polish"
POLISH = runpy.run_path(str(Path(__file__).with_name("workout-vector-polish.py")))
FILES = {
    "hands_behind": "recordedHandsBehind.json", "quad_stretch": "recordedQuadRight.json",
    "quad_left": "recordedQuadLeft.json", "crunch_reach": "recordedCrunchReach.json",
    "chair_dip": "recordedChairDip.json", "prone_pull": "recordedPronePull.json",
    "plank_pike": "recordedPlankPike.json", "seated_knee_tuck": "recordedSeatedKneeTuck.json",
}


def main():
    results = {}
    for name, file in FILES.items():
        data = json.loads((ROOT / "mobile/src/workouts/character" / file).read_text())
        old = json.loads((FOLDER / "before" / file).read_text())
        assert data["timeline"] == old["timeline"] and data["duration"] == old["duration"]
        folder = FOLDER / ("quad_stretch_left" if name == "quad_left" else name)
        frames, overlap, components, sole_skin = [], [], [], []
        for i in range(len(data["timeline"])):
            before = cv2.imread(str(folder / f"before-{i:03d}.png"), cv2.IMREAD_UNCHANGED)
            after = cv2.imread(str(folder / f"after-{i:03d}.png"), cv2.IMREAD_UNCHANGED)
            frames.append(after)
            a, b = before[:, :, 3] > 128, after[:, :, 3] > 128
            overlap.append(float(np.count_nonzero(a & b) / np.count_nonzero(a | b)))
            _, _, stats, _ = cv2.connectedComponentsWithStats(b.astype(np.uint8))
            components.append(int(np.count_nonzero(stats[1:, cv2.CC_STAT_AREA] > 3)))
            tx, ty, s = data["transform"]
            for x0, x1, ground in POLISH["SOLES"].get(name, []):
                yy, xx = np.indices(b.shape)
                region = (xx > tx+s*(x0+4)) & (xx < tx+s*(x1-4)) & (yy > ty+s*(ground-1.2))
                # OpenCV uses BGRA: the warm skin underpaint has R-G > 20.
                skin = after[:, :, 2].astype(float)-after[:, :, 1] > 20
                sole_skin.append(int(np.count_nonzero(region & b & skin)))
        expected = 2 if name == "hands_behind" else 1
        static = all(np.array_equal(frames[0], f) for f in frames)
        assert components == [expected] * len(frames), (name, "detached body part")
        assert np.array_equal(frames[0], frames[-1]), (name, "loop seam")
        assert static == data.get("staticBody", False), (name, "unexpected motion")
        assert min(overlap) > .97, (name, "outline changed too far from the source pose", min(overlap))
        assert not any(sole_skin), (name, "skin exposed underneath shoe", max(sole_skin))
        results[name] = {"samples": len(frames), "bodyComponents": expected, "staticBody": static,
                         "loopIdentical": True, "timelineUnchanged": True,
                         "minSilhouetteIoUWithPrevious": min(overlap),
                         "meanSilhouetteIoUWithPrevious": float(np.mean(overlap)),
                         "maxSkinPixelsAtSole": max(sole_skin, default=0)}
    (FOLDER / "qa.json").write_text(json.dumps(results, indent=2) + "\n")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
