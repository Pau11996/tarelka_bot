"""Copy the crunch and static stretches from video_2026-11-01_20-55-46.mp4.

Body poses and instructional indicators have independent timelines. A static
stretch has exactly one body pose, even while arrows move and dashes fade.
"""
import argparse
import hashlib
import json
from pathlib import Path
import runpy
import tempfile

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
HELPERS = runpy.run_path(str(Path(__file__).with_name("trace-reference-exercises.py")))
POLISH = HELPERS["POLISH"]
CONFIG = {
    "crunch_reach": {
        "file": "recordedCrunchReach.json", "start": 106, "count": 120,
        "crop": [85, 260, 420, 230], "canvas": [360, 250], "transform": [3.6, 22, .84],
        "matTop": 168, "preview": .62, "components": 1,
        "holds": [[0, 28, 15], [59, 88, 75], [119, 120, 15]],
        "phases": [[0, "Лопатки на коврике"], [28, "Поднимите лопатки"], [59, "Потянитесь руками"],
                   [88, "Плавно опуститесь"], [119, "Лопатки на коврике"]],
        "cue": "Тянитесь руками к коленям · стопы на полу · опускайтесь плавно",
    },
    "hands_behind": {
        "file": "recordedHandsBehind.json", "start": 260, "count": 149,
        "crop": [120, 240, 340, 350], "canvas": [360, 380], "transform": [18.5, 12, .95],
        "preview": .4, "components": 2, "baseSample": 140, "peakSample": 50,
        "phases": [[0, "Удерживайте позу · дышите"]],
        "cue": "Руки сцеплены за спиной · плечи опущены · локти выпрямлены",
        "arrows": [[0, 60, 65, 170], [145, 80, 205, 125], [285, 80, 340, 125]],
    },
    "quad_stretch": {
        "file": "recordedQuadRight.json", "start": 548, "count": 149,
        "crop": [171, 290, 240, 330], "canvas": [360, 380], "transform": [60.5, 20, 1],
        "preview": .4, "components": 1, "baseSample": 140, "peakSample": 52,
        "phases": [[0, "Удерживайте позу · дышите"]],
        "cue": "Правая пятка к ягодице · держитесь за стену · колени рядом",
    },
    "quad_left": {
        "file": "recordedQuadLeft.json", "start": 803, "count": 149,
        "crop": [171, 290, 240, 330], "canvas": [360, 380], "transform": [60.5, 20, 1],
        "preview": .4, "components": 1, "baseSample": 138, "peakSample": 77,
        "authoredMirror": True, "comparisonStart": 32, "comparisonCount": 107,
        "annotationsOffFrom": 138,
        "phases": [[0, "Удерживайте позу · дышите"]],
        "cue": "Левая пятка к ягодице · держитесь за стену · колени рядом",
    },
}


def orange(rgb):
    r, g, b = rgb.astype(float).transpose(2, 0, 1)
    return (r - g > 55) & (g - b > 35) & (r > 180)


def thin_path(mask):
    return HELPERS["contour"](mask, smoothing=.65, min_area=1.25, fit_error=.2)


def body_paths(labels, rgb):
    result = HELPERS["paths"](labels)
    # Narrow tank straps must remain continuous when their antialiased blue
    # edge is paler than the body. Close compression gaps without widening it.
    a = rgb.astype(float)
    r, g, b = a.transpose(2, 0, 1)
    tank = (labels == 3).astype(np.uint8)
    nearby = cv2.dilate(tank, np.ones((5, 5), np.uint8)) > 0
    blue_edge = (b - r > 30) & (g - r > 20) & (b - g > 10) & (r < 195) & nearby
    tank[blue_edge] = 1
    tank = cv2.morphologyEx(tank, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    result[2] = HELPERS["contour"](tank, smoothing=1.0, min_area=4, fit_error=.65)
    return result


def indicators(images, config):
    base, peak = images[config["baseSample"]].astype(float), images[config["peakSample"]].astype(float)
    # A naturally warm skin/shading pixel is not a muscle marker. The marker
    # must also differ from the same stationary body with annotations off.
    mask = orange(peak) & (np.linalg.norm(peak - base, axis=2) > 25)
    delta = peak[mask] - base[mask]
    denominator = max(float((delta * delta).sum()), 1)
    colour = np.median(peak[mask], axis=0).round().astype(int)
    samples = []
    for sample, rgb in enumerate(images):
        opacity = float(((rgb[mask].astype(float) - base[mask]) * delta).sum() / denominator)
        # The final screen transition changes the pixels under the detector.
        # The source muscle guide has already faded out by this sample.
        if sample >= config.get("annotationsOffFrom", len(images)):
            opacity = 0
        opacity = 0 if opacity < .025 else 1 if opacity > .98 else round(min(1, opacity), 3)
        samples.append([opacity, 0, 0])
    result = [{"path": POLISH["MUSCLE_LINES"][config["name"]], "fill": "none",
               "stroke": "#" + "".join(f"{v:02x}" for v in colour), "strokeWidth": 2.5,
               "strokeDasharray": [5, 6], "strokeLinecap": "round", "samples": samples}]
    for index, (x0, y0, x1, y1) in enumerate(config.get("arrows", [])):
        signals, centres, masks = [], [], []
        for rgb in images:
            a = rgb[y0:y1, x0:x1].astype(float)
            r, g, b = a.transpose(2, 0, 1)
            signal = np.maximum(b - r - 4, 0) * ((g - r > 10) & (b > 195))
            yy, xx = np.indices(signal.shape)
            total = float(signal.sum())
            signals.append(total)
            centres.append([float((xx * signal).sum() / max(total, 1)) + x0,
                            float((yy * signal).sum() / max(total, 1)) + y0])
            masks.append((r > 110) & (b > 200) & (g > 180) & (b - r > 25))
        reference = int(np.argmax(signals))
        shape = np.zeros(images[0].shape[:2], bool)
        shape[y0:y1, x0:x1] = masks[reference]
        a = images[reference][shape].astype(float)
        # Use the saturated core, leaving edge antialiasing to native SVG.
        a = a[(a[:, 2] - a[:, 0]) >= np.percentile(a[:, 2] - a[:, 0], 50)]
        colour = np.median(a, axis=0).round().astype(int)
        samples = []
        for strength, centre in zip(signals, centres):
            opacity = strength / max(signals[reference], 1)
            if opacity < .025:
                samples.append([0, 0, 0])
            else:
                samples.append([round(min(1, opacity), 3), round(centre[0] - centres[reference][0], 2),
                                round(centre[1] - centres[reference][1], 2)])
        result.append({"path": POLISH["arrow_path"](centres[reference], [(-.84,-.54), (1,0), (-1,0)][index]),
                       "fill": "#" + "".join(f"{v:02x}" for v in colour), "samples": samples})
    return result


def support(image, name, config):
    if name == "crunch_reach":
        return HELPERS["support"]([image], name, config)
    if name in ("quad_stretch", "quad_left"):
        a = image.astype(float)
        r, g, b = a.transpose(2, 0, 1)
        y, x = np.indices(r.shape)
        region = (x < 42) if name == "quad_left" else (x > 201)
        mask = (r > 150) & (g > 200) & (b > 210) & (b - r > 10) & (region | (y > 309))
        colour = np.median(a[mask], axis=0).round().astype(int)
        # The ground line is straight; background compression and watermark
        # pixels must not create tiny teeth along this almost transparent line.
        floor = mask & (y > 309)
        yy, xx = np.where(floor)
        centre = float(np.median(yy))
        x0, x1 = float(xx.min()) - .5, float(xx.max()) + .5
        floor_path = f"M{x0 + 1},{centre - 1}H{x1 - 1}Q{x1},{centre - 1} {x1},{centre}Q{x1},{centre + 1} {x1 - 1},{centre + 1}H{x0 + 1}Q{x0},{centre + 1} {x0},{centre}Q{x0},{centre - 1} {x0 + 1},{centre - 1}Z"
        # Complete equal dashes are placed behind the body, so the palm
        # naturally hides the wall instead of becoming a dent in a dash.
        wall_x = 34 if name == "quad_left" else 208
        wall_path = "".join(POLISH["capsule"](wall_x, top, 2.4, 12) for top in range(27, 305, 22))
        return [["#" + "".join(f"{v:02x}" for v in colour), wall_path + floor_path]]
    return []


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("--exercise", choices=CONFIG, required=True)
    args = parser.parse_args()
    if args.video.name != "video_2026-11-01_20-55-46.mp4":
        parser.error("Extraction is calibrated for video_2026-11-01_20-55-46.mp4")
    config = CONFIG[args.exercise]
    config["name"] = args.exercise
    with tempfile.TemporaryDirectory() as tmp:
        images = HELPERS["extract"](args.video, config, Path(tmp))
    labels = [HELPERS["classify"](image) for image in images]
    if "baseSample" in config:
        # Never turn a stretch into a repeated bend. Only annotations animate.
        timeline = [0] * config["count"]
        poses = [POLISH["polish_pose"](body_paths(labels[config["baseSample"]], images[config["baseSample"]]), args.exercise)]
        extras = indicators(images, config)
        base = images[config["baseSample"]]
    else:
        poses, previous, timeline, extras = [], [], [], []
        for sample, original in enumerate(labels):
            current = original
            source_sample = sample
            for first, end, canonical in config["holds"]:
                if first <= sample < end:
                    current = labels[canonical]
                    source_sample = canonical
                    break
            match = next((i for i, p in enumerate(previous) if np.count_nonzero(p != current) < 12), None)
            if match is None:
                match = len(poses)
                previous.append(current)
                poses.append(POLISH["polish_pose"](body_paths(current, images[source_sample]), args.exercise))
            timeline.append(match)
        base = images[0]
    data = {"source": args.video.name, "sourceSha256": hashlib.sha256(args.video.read_bytes()).hexdigest(),
            "movement": "quad_stretch" if args.exercise == "quad_left" else args.exercise,
            "sourceStartSeconds": config["start"] / 30, "fps": 30, "duration": config["count"] / 30,
            "sourceCrop": config["crop"], "canvas": config["canvas"], "transform": config["transform"],
            "preview": config["preview"], "phases": config["phases"], "cue": config["cue"],
            "palette": HELPERS["PALETTE"], "timeline": timeline, "poses": poses,
            "support": support(base, args.exercise, config), "indicators": extras,
            "bodyComponents": config["components"], "staticBody": "baseSample" in config,
            "authoredMirror": config.get("authoredMirror", False),
            "comparisonStart": config.get("comparisonStart", 0), "comparisonCount": config.get("comparisonCount", config["count"])}
    output = ROOT / "mobile/src/workouts/character" / config["file"]
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{args.exercise}: {len(poses)} body poses, {len(timeline)} samples, {len(extras)} indicators, {output.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
