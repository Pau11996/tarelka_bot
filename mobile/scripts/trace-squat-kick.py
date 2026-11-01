"""Trace both alternating squat/kick repetitions from the supplied recording.

Usage: python trace-squat-kick.py /path/to/присядысногой.mp4
Build-only dependencies are shared with trace-knee-elbow.py.
"""
import argparse
import hashlib
import json
from pathlib import Path
import runpy
import subprocess
import tempfile

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
helpers = runpy.run_path(str(Path(__file__).with_name("trace-knee-elbow.py")))
contours, classify = helpers["contours"], helpers["classify"]
OUTPUT = ROOT / "mobile/src/workouts/character/squatKickContours.json"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    args = parser.parse_args()
    if args.video.name != "присядысногой.mp4":
        parser.error("Extraction is calibrated for присядысногой.mp4")
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(args.video),
                        "-vf", "fps=30,select='between(n,85,189)',crop=250:342:170:240",
                        "-vsync", "vfr", str(Path(tmp) / "%03d.png")], check=True)
        images = [cv2.cvtColor(cv2.imread(str(p)), cv2.COLOR_BGR2RGB) for p in sorted(Path(tmp).glob("*.png"))]
    assert len(images) == 105
    squat = classify(images[0])
    other_squat = classify(images[54])
    poses, masks, timeline = [], [], []
    for sample, rgb in enumerate(images):
        # Join with both feet already down; a standing seam could cut through
        # the returning leg's last step. These bottom holds are stationary.
        labels = squat if sample < 6 or sample == 104 else other_squat if 52 <= sample <= 57 else classify(rgb)
        # Deduplicate compression noise during holds, but keep the two leg
        # actions distinct: their shorts and thigh occlusion really differ.
        matches = [i for i, previous in enumerate(masks) if np.count_nonzero(previous != labels) < 130]
        if matches:
            timeline.append(matches[0])
            continue
        timeline.append(len(poses))
        masks.append(labels)
        poses.append([contours(labels > 0)] + [contours(labels == colour) for colour in range(2, 6)])
    data = {"source": args.video.name, "sourceSha256": hashlib.sha256(args.video.read_bytes()).hexdigest(),
            "sourceStartSeconds": 85 / 30, "fps": 30, "duration": 3.5,
            "viewBox": [0, 0, 250, 342], "sourceCrop": [170, 240, 250, 342],
            "layers": ["skin", "tank", "shorts", "shortsShade", "hairShoes"],
            "timeline": timeline, "poses": poses}
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{len(poses)} vector poses, {len(timeline)} samples, {OUTPUT.stat().st_size:,} bytes → {OUTPUT}")


if __name__ == "__main__":
    main()
