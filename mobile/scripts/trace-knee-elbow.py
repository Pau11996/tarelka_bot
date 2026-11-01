"""Build native SVG contours from the user-supplied knee/elbow recording.

Usage: python trace-knee-elbow.py /path/to/video_2026-10-31_19-29-44.mp4
Requires ffmpeg, numpy, OpenCV, scipy and scikit-image (build tools only).
The application ships vector paths, not the screen recording or its UI.
See docs/design/workout-character/knee-elbow-reference.md for provenance.
"""
import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter
from skimage.measure import find_contours

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "mobile/src/workouts/character/kneeElbowContours.json"
# RGB colours in the recording. Skin compression/shading is flattened; the
# blue vest is recoloured by the React component, independently of geometry.
PALETTE = np.array([[249, 249, 249], [235, 177, 156], [66, 154, 195],
                    [32, 42, 48], [19, 30, 38], [100, 100, 99]], np.float32)


def classify(rgb):
    a = cv2.GaussianBlur(rgb.astype(np.float32), (0, 0), .8)
    labels = np.argmin(((a[:, :, None] - PALETTE) ** 2).sum(3), axis=2).astype(np.uint8)
    # Keep pale background, ground shadow and app watermark outside the asset.
    foreground = (a.min(2) < 165) | ((a[:, :, 0] - a[:, :, 1] > 22) & (a[:, :, 1] < 215))
    labels[~foreground] = 0
    labels = cv2.medianBlur(labels, 3)
    # Narrow dark/grey compression bands are not separate clothing details.
    for colour in range(2, 6):
        count, components, stats, _ = cv2.connectedComponentsWithStats((labels == colour).astype(np.uint8))
        for component in range(1, count):
            if stats[component, cv2.CC_STAT_AREA] < 25:
                region = components == component
                distances = ((a[region, None] - PALETTE) ** 2).sum(2)
                distances[:, colour] = np.inf
                labels[region] = np.argmin(distances, axis=1)
    return labels


def contours(mask):
    smooth = gaussian_filter(mask.astype(float), .85)
    paths = []
    for contour in find_contours(np.pad(smooth, 2), .5):
        xy = np.ascontiguousarray((contour[:, ::-1] - 2).astype(np.float32))
        if abs(cv2.contourArea(xy)) < 8:
            continue
        points = cv2.approxPolyDP(xy, .7, True).reshape(-1, 2)
        # Quadratic segments round pixel staircases without changing joints or
        # using independent transforms that could detach limbs from the body.
        midpoint = (points + np.roll(points, -1, axis=0)) / 2
        pair = lambda p: f"{p[0]:.1f},{p[1]:.1f}"
        path = "M" + pair(midpoint[-1])
        for p, end in zip(points, midpoint):
            path += "Q" + pair(p) + " " + pair(end)
        paths.append(path + "Z")
    return "".join(paths)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    args = parser.parse_args()
    expected = "video_2026-10-31_19-29-44.mp4"
    if args.video.name != expected:
        parser.error(f"This extraction is calibrated for {expected}")
    # 120 samples / 30 fps = one left + right cycle. The neutral hold at both
    # ends makes the loop seamless. Source timestamp of sample zero: 59/30 s.
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(args.video),
                        "-vf", "fps=30,select='between(n,59,178)',crop=230:380:180:130",
                        "-vsync", "vfr", str(Path(tmp) / "%03d.png")], check=True)
        images = [cv2.cvtColor(cv2.imread(str(p)), cv2.COLOR_BGR2RGB) for p in sorted(Path(tmp).glob("*.png"))]
    assert len(images) == 120
    poses, masks, timeline = [], [], []
    neutral = classify(images[0])
    for sample, rgb in enumerate(images):
        # Three observed standing holds are the same pose. Canonicalise the
        # subpixel compression shifts, including the last-to-first loop seam.
        labels = neutral if sample < 11 or 57 <= sample < 72 or sample >= 117 else classify(rgb)
        # The source holds still for ~0.5 s at the top and bottom. Reuse the
        # same contours there so video compression does not make them shimmer.
        matches = [i for i, previous in enumerate(masks) if np.count_nonzero(previous != labels) < 210]
        if matches:
            timeline.append(matches[0])
            continue
        timeline.append(len(poses))
        masks.append(labels)
        poses.append([contours(labels > 0)] + [contours(labels == colour) for colour in range(2, 6)])
    data = {
        "source": expected,
        "sourceSha256": hashlib.sha256(args.video.read_bytes()).hexdigest(),
        "sourceStartSeconds": 59 / 30,
        "fps": 30,
        "duration": 4,
        "viewBox": [0, 0, 230, 380],
        "layers": ["skin", "tank", "shorts", "shortsShade", "hairShoes"],
        "timeline": timeline,
        "poses": poses,
    }
    OUTPUT.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    print(f"{len(poses)} vector poses, {len(timeline)} timeline samples, {OUTPUT.stat().st_size:,} bytes → {OUTPUT}")


if __name__ == "__main__":
    main()
