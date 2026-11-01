"""Trace the wide squat from the user's recording, including its held poses.

Usage: python trace-sumo-squat.py /path/to/присяды.mp4
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
OUTPUT = ROOT / "mobile/src/workouts/character/sumoSquatContours.json"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    args = parser.parse_args()
    if args.video.name != "присяды.mp4":
        parser.error("Extraction is calibrated for присяды.mp4")
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(args.video),
                        "-vf", "fps=30,select='between(n,93,183)',crop=220:310:180:220",
                        "-vsync", "vfr", str(Path(tmp) / "%03d.png")], check=True)
        images = [cv2.cvtColor(cv2.imread(str(p)), cv2.COLOR_BGR2RGB) for p in sorted(Path(tmp).glob("*.png"))]
    assert len(images) == 91
    standing, squat = classify(images[0]), classify(images[57])
    poses, masks, timeline = [], [], []
    for sample, rgb in enumerate(images):
        # Normalise compression noise only in the observed stationary holds.
        # The original descent and ascent are retained independently.
        labels = standing if sample < 29 or sample >= 89 else squat if 43 <= sample < 74 else classify(rgb)
        matches = [i for i, previous in enumerate(masks) if np.count_nonzero(previous != labels) < 100]
        if matches:
            timeline.append(matches[0])
            continue
        timeline.append(len(poses))
        masks.append(labels)
        # A continuous shorts underlay prevents a skin-coloured seam between
        # the independently smoothed dark panels at the bottom of the squat.
        poses.append([contours(labels > 0), contours(labels == 2),
                      contours((labels == 3) | (labels == 4)),
                      contours(labels == 4), contours(labels == 5)])
    data = {"source": args.video.name, "sourceSha256": hashlib.sha256(args.video.read_bytes()).hexdigest(),
            "sourceStartSeconds": 93 / 30, "fps": 30, "duration": 91 / 30,
            "viewBox": [0, 0, 220, 310], "sourceCrop": [180, 220, 220, 310],
            "layers": ["skin", "tank", "shorts", "shortsShade", "hairShoes"],
            "timeline": timeline, "poses": poses}
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{len(poses)} vector poses, {len(timeline)} samples, {OUTPUT.stat().st_size:,} bytes → {OUTPUT}")


if __name__ == "__main__":
    main()
