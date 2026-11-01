"""Trace the user's incline push-up recording into native SVG poses.

Usage: python trace-incline-pushup.py /path/to/отминия.mp4
Uses the same offline contour tooling as trace-knee-elbow.py.
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
OUTPUT = ROOT / "mobile/src/workouts/character/inclinePushupContours.json"


def person(rgb):
    labels = classify(rgb)
    y, x = np.indices(labels.shape)
    # The static grey support is rendered separately, behind the palms.
    # Saturated skin pixels remain part of the moving figure in this region.
    bench = (x >= 234) & (y >= 144) & (np.ptp(rgb.astype(float), axis=2) < 45)
    labels[bench] = 0
    return labels


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    args = parser.parse_args()
    if args.video.name != "отминия.mp4":
        parser.error("Extraction is calibrated for отминия.mp4")
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(args.video),
                        "-vf", "fps=30,select='between(n,120,179)',crop=320:260:124:290",
                        "-vsync", "vfr", str(Path(tmp) / "%03d.png")], check=True)
        images = [cv2.cvtColor(cv2.imread(str(p)), cv2.COLOR_BGR2RGB) for p in sorted(Path(tmp).glob("*.png"))]
    assert len(images) == 60
    top, bottom = person(images[0]), person(images[30])
    poses, masks, timeline = [], [], []
    for sample, rgb in enumerate(images):
        # Observed holds in the recording; canonical poses remove compression
        # shimmer and keep the last-to-first transition exactly continuous.
        labels = top if sample < 11 or sample >= 56 else bottom if 27 <= sample < 40 else person(rgb)
        matches = [i for i, previous in enumerate(masks) if np.count_nonzero(previous != labels) < 150]
        if matches:
            timeline.append(matches[0])
            continue
        timeline.append(len(poses))
        masks.append(labels)
        poses.append([contours(labels > 0)] + [contours(labels == colour) for colour in range(2, 6)])
    # Stable support measured from the reference. Restoring the covered areas
    # behind the hands prevents transparent holes when the forearms move.
    support = [
        ["#b5b2b5", "M258,190H286V198H278V215H305V223H278V239H309V251H234V239H266V223H239V215H266V198H258Z"],
        ["#989696", "M242,145H301Q305,145 305,149V188Q305,192 301,192H242Q238,192 238,188V149Q238,145 242,145Z"],
        ["#747473", "M241,174H302Q305,174 305,177V188Q305,192 301,192H242Q238,192 238,188V177Q238,174 241,174Z"],
    ]
    data = {"source": args.video.name, "sourceSha256": hashlib.sha256(args.video.read_bytes()).hexdigest(),
            "sourceStartSeconds": 4, "fps": 30, "duration": 2, "viewBox": [0, 0, 320, 260],
            "layers": ["skin", "tank", "shorts", "shortsShade", "hairShoes"],
            "support": support, "timeline": timeline, "poses": poses}
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{len(poses)} vector poses, {len(timeline)} samples, {OUTPUT.stat().st_size:,} bytes → {OUTPUT}")


if __name__ == "__main__":
    main()
