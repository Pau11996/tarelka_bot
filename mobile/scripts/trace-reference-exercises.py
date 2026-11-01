"""Extract native vector demonstrations from the user's упражнения.mp4.

Each calibrated interval is processed independently and retains source timing.
Only the vest is recoloured; skin shading and support geometry are preserved.
Build tools: ffmpeg, numpy, OpenCV, scipy, scikit-image.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import runpy

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter, distance_transform_edt, binary_fill_holes
from scipy.interpolate import splprep, splev
from skimage.measure import find_contours

ROOT = Path(__file__).resolve().parents[2]
POLISH = runpy.run_path(str(Path(__file__).with_name("workout-vector-polish.py")))
CONFIG = {
    "chair_dip": {
        "file": "recordedChairDip.json", "start": 136, "count": 90,
        "crop": [150, 290, 280, 260], "canvas": [360, 380],
        "transform": [12, 38, 1.2], "preview": .6,
        "holds": [[0, 27, 0], [42, 73, 54], [88, 90, 0]],
        "phases": [[0, "Руки выпрямлены"], [27, "Согните локти"],
                   [42, "Задержитесь внизу"], [73, "Выпрямите руки"], [88, "Руки выпрямлены"]],
        "cue": "Ладони на краю стула · таз рядом с опорой · стопы на полу",
    },
    "prone_pull": {
        "file": "recordedPronePull.json", "start": 305, "count": 61,
        "crop": [90, 300, 400, 160], "canvas": [360, 220], "matTop": 102,
        "transform": [0, 30, .9], "preview": .6,
        "holds": [[0, 14, 0], [30, 44, 36], [59, 61, 0]],
        "phases": [[0, "Руки вытянуты"], [14, "Локти к бокам"],
                   [30, "Локти у корпуса"], [44, "Руки вперёд"], [59, "Руки вытянуты"]],
        "cue": "Ноги на коврике · тяните локти к рёбрам · голова продолжает спину",
    },
    "plank_pike": {
        "file": "recordedPlankPike.json", "start": 566, "count": 121,
        "crop": [90, 290, 400, 250], "canvas": [360, 290], "matTop": 191,
        "transform": [0, 22, .9], "preview": .62,
        "outlineFitError": .4,  # Preserve the small fingertip contact at both palm angles.
        "holds": [[0, 30, 0], [62, 89, 75], [120, 121, 0]],
        "phases": [[0, "Планка"], [30, "Таз вверх и назад"], [62, "Перевёрнутая V"],
                   [89, "Вернитесь в планку"], [120, "Планка"]],
        "cue": "Отталкивайтесь ладонями · поднимайте таз · сохраняйте опору стоп",
    },
    "seated_knee_tuck": {
        "file": "recordedSeatedKneeTuck.json", "start": 790, "count": 60,
        "crop": [90, 270, 400, 200], "canvas": [360, 270], "matTop": 164,
        "transform": [0, 35, .9], "preview": .15,
        "holds": [[0, 14, 8], [30, 45, 36], [59, 60, 8]],
        "phases": [[0, "Колени к груди"], [14, "Вытяните ноги"], [30, "Ноги над полом"],
                   [45, "Подтяните колени"], [59, "Колени к груди"]],
        "cue": "Ладони на коврике · обе ноги вместе · стопы остаются над полом",
    },
}
# Colours measured in the supplied recording. Labels 1/2 retain the original
# two skin tones. Clothing underlays overlap so their seams cannot expose skin.
SOURCE_PALETTE = np.array([[249, 249, 249], [247, 194, 175], [232, 175, 155],
                           [65, 154, 196], [30, 39, 48], [19, 30, 38],
                           [101, 99, 99], [55, 59, 62]], np.float32)
PALETTE = ["#f7c2af", "#e8af9b", "#589565", "#1e2730", "#131e26", "#656363", "#373b3e"]


def classify(rgb):
    a = cv2.GaussianBlur(rgb.astype(np.float32), (0, 0), .35)
    distance = ((a[:, :, None] - SOURCE_PALETTE) ** 2).sum(3)
    labels = (np.argmin(distance[:, :, 1:], axis=2) + 1).astype(np.uint8)
    saturation = np.ptp(a, axis=2)
    foreground = (a.min(2) < 215) & ((saturation > 25) | (a.max(2) < 145))
    mat = (a[:, :, 0] > 130) & (a[:, :, 1] > 190) & (a[:, :, 2] > 205) & (a[:, :, 2] - a[:, :, 0] > 15)
    foreground &= ~mat
    # Pale antialiasing along straps and the neck still belongs to the body.
    # Close one-pixel compression cracks before assigning its material.
    foreground = cv2.morphologyEx(foreground.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)).astype(bool)
    labels[~foreground] = 0
    # Background lettering is much paler than the figure. Remove only tiny
    # isolated compression specks, keeping fingers and clothing details.
    n, components, stats, _ = cv2.connectedComponentsWithStats((labels > 0).astype(np.uint8))
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] < 6:
            labels[components == i] = 0
    return labels


def contour(mask, smoothing=1.05, min_area=3, fit_error=.48):
    mask = mask.astype(bool).copy()
    holes = binary_fill_holes(mask) & ~mask
    if holes.any():
        n, parts, stats, _ = cv2.connectedComponentsWithStats(holes.astype(np.uint8))
        for part in range(1, n):
            if stats[part, cv2.CC_STAT_AREA] < 18:
                mask[parts == part] = True
    paths = []
    for edge in find_contours(np.pad(gaussian_filter(mask.astype(float), smoothing), 2), .5):
        xy = np.ascontiguousarray((edge[:, ::-1] - 2).astype(np.float32))
        if abs(cv2.contourArea(xy)) < min_area:
            continue
        # A periodic smoothing spline removes the source pixel staircase.
        # Its RMS fitting allowance stays below half a source px, keeping fingertips,
        # soles and clothing edges while avoiding hundreds of tiny bends.
        incoming, outgoing = xy - np.roll(xy, 4, axis=0), np.roll(xy, -4, axis=0) - xy
        cosine = (incoming * outgoing).sum(1) / np.maximum(np.linalg.norm(incoming, axis=1) * np.linalg.norm(outgoing, axis=1), .001)
        weights = np.where(cosine < .5, 3., 1.)
        # Give small caps (fingertips/nose) and contact extrema extra weight.
        # Long edges can become smooth without shortening a hand or rounding
        # the sole away from its original ground line.
        extrema = ((xy - xy.min(0)) < .15).any(1) | ((xy.max(0) - xy) < .15).any(1)
        weights[extrema] = 4.
        spline, _ = splprep(xy.T, w=weights, s=len(xy) * fit_error ** 2, per=True)
        knots = np.unique(spline[0][3:-3])
        pair = lambda p: f"{p[0]:.2f},{p[1]:.2f}"
        path = "M" + pair(splev(knots[0], spline))
        # Convert each polynomial span exactly to cubic Bezier controls. The
        # same position and tangent on both sides make every join smooth.
        for start, end in zip(knots, knots[1:]):
            a, b = np.array(splev(start, spline)), np.array(splev(end, spline))
            da, db = np.array(splev(start, spline, der=1)), np.array(splev(end, spline, der=1))
            step = (end - start) / 3
            path += "C" + pair(a + da * step) + " " + pair(b - db * step) + " " + pair(b)
        paths.append(path + "Z")
    return "".join(paths)


def paths(labels, outline_fit_error=.48):
    labels = labels.copy()
    grey = (labels == 6) | (labels == 7)
    n, parts, _, _ = cv2.connectedComponentsWithStats(grey.astype(np.uint8))
    depth = distance_transform_edt(grey)
    valid_grey = np.zeros_like(grey)
    for part in range(1, n):
        region = parts == part
        if np.count_nonzero(region & (depth > 1.5)) >= 10:
            valid_grey |= region
    discarded = grey & ~valid_grey
    # Assign compression bands to the adjacent fabric/skin, including the
    # dark-grey layer, rather than leaving tiny skin holes in the shorts.
    if discarded.any():
        nearest = distance_transform_edt(discarded | (labels == 0), return_distances=False, return_indices=True)
        labels[discarded] = labels[tuple(nearest[:, discarded])]
    body = labels > 0
    # Colour layers and the silhouette used to shrink independently. That
    # exposed the skin underpaint below shoes and along dark shorts. Extend
    # materials only across the outer edge; native clipping supplies the one
    # shared boundary, while interior clothing/skin boundaries stay in place.
    edge = distance_transform_edt(body) < 1.6
    def material(mask, solid=False, min_area=7):
        if not mask.any():
            return ""
        # Antialiased black shorts may be classified as a few grey pixels.
        # Keep grey only in substantial hair/shoe components, before growing
        # its outside edge (otherwise those specks become grey scallops).
        n, parts, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8))
        depth = distance_transform_edt(mask)
        for part in range(1, n):
            region = parts == part
            if stats[part, cv2.CC_STAT_AREA] < min_area or (solid and np.count_nonzero(region & (depth > 1.5)) < 10):
                mask = mask & ~region
        mask = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)) > 0
        extended = mask | (edge & (distance_transform_edt(~mask) < 2.6))
        return contour(extended, smoothing=1.05, fit_error=.65)
    return [contour(body, fit_error=outline_fit_error), material(labels == 2, min_area=30), material(labels == 3),
            material((labels == 4) | (labels == 5)), material(labels == 5),
            material((labels == 6) | (labels == 7), solid=True), material(labels == 7)]


def support(images, movement, config):
    if movement == "chair_dip":
        # Union of the visible chair in all poses. Restore the tiny part of
        # the seat hidden by the fixed palm, behind the moving figure.
        masks = []
        for rgb in images:
            a = rgb.astype(float)
            y, x = np.indices(a.shape[:2])
            masks.append((np.ptp(a, axis=2) < 16) & (a.min(2) > 145) & (a.max(2) < 220) & (x < 124) & (y > 70))
        mask = np.mean(masks, axis=0) > .5
        mask[169:182, 108:123] = True
        return [["#b0b0b2", contour(mask)]]
    # Measure its visible front edge and far-right corner. The symmetric
    # trapezoid also restores the far-left corner hidden by the body. Ignore
    # pale blue antialiasing on the vest above the actual mat plane.
    a = np.median(images, axis=0)
    mat = (a[:, :, 0] > 130) & (a[:, :, 1] > 190) & (a[:, :, 2] > 205) & (a[:, :, 2] - a[:, :, 0] > 15)
    top = config["matTop"]
    mat[:top] = False
    y, x = np.where(mat)
    left, right, bottom = x.min() - .5, x.max() + .5, y.max() + .5
    far_right = np.where(mat[top])[0].max() + .5
    far_left = left + right - far_right
    path = f"M{far_left},{top - .5}H{far_right}L{right},{bottom}H{left}Z"
    colour = np.median(a[mat], axis=0).round().astype(int)
    return [["#" + "".join(f"{v:02x}" for v in colour), path]]


def extract(video, config, directory):
    x, y, width, height = config["crop"]
    start, count = config["start"], config["count"]
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(video),
                    "-vf", f"fps=30,select='between(n,{start},{start + count - 1})',crop={width}:{height}:{x}:{y}",
                    "-vsync", "vfr", str(directory / "%03d.png")], check=True)
    images = [cv2.cvtColor(cv2.imread(str(p)), cv2.COLOR_BGR2RGB) for p in sorted(directory.glob("*.png"))]
    assert len(images) == count
    return images


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("--exercise", choices=CONFIG, required=True)
    args = parser.parse_args()
    if args.video.name != "упражнения.mp4":
        parser.error("Extraction is calibrated for упражнения.mp4")
    config = CONFIG[args.exercise]
    with tempfile.TemporaryDirectory() as tmp:
        images = extract(args.video, config, Path(tmp))
    labels = [classify(image) for image in images]
    poses, masks, timeline = [], [], []
    for sample, original in enumerate(labels):
        current = original
        for start, end, canonical in config["holds"]:
            if start <= sample < end:
                current = labels[canonical]
                break
        # Keep every distinct moving pose. Only near-identical compression
        # changes are deduplicated; no temporal interpolation changes the action.
        match = next((i for i, previous in enumerate(masks) if np.count_nonzero(previous != current) < 12), None)
        if match is not None:
            timeline.append(match)
        else:
            timeline.append(len(poses))
            masks.append(current)
            poses.append(POLISH["polish_pose"](paths(current, config.get("outlineFitError", .48)), args.exercise))
    data = {"source": args.video.name, "sourceSha256": hashlib.sha256(args.video.read_bytes()).hexdigest(),
            "movement": args.exercise, "sourceStartSeconds": config["start"] / 30,
            "fps": 30, "duration": config["count"] / 30, "sourceCrop": config["crop"],
            "canvas": config["canvas"], "transform": config["transform"], "preview": config["preview"],
            "phases": config["phases"], "cue": config["cue"], "palette": PALETTE,
            "support": support(images, args.exercise, config), "timeline": timeline, "poses": poses}
    output = ROOT / "mobile/src/workouts/character" / config["file"]
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{args.exercise}: {len(poses)} poses, {len(timeline)} samples, {output.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
