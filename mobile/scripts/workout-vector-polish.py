"""Clean vector details calibrated in the source crop's coordinates.

Compression is not anatomy: short uniform dashes, straight soles and smooth
vest seams are drawn as geometry. Body motion and annotation clocks are kept.
"""
import re
import numpy as np


def pair(p):
    return f"{p[0]:.2f},{p[1]:.2f}"


def split_curve(p, t):
    a = p[:-1] * (1 - t) + p[1:] * t
    b = a[:-1] * (1 - t) + a[1:] * t
    c = b[0] * (1 - t) + b[1] * t
    return np.array([p[0], a[0], b[0], c]), np.array([c, b[1], a[2], p[3]])


def flatten_sole(path, region):
    """Replace only the bottom arc by rounded corners and a straight sole.

    Split cubic curves exactly at the repair boundary, retaining every other
    part of the silhouette. The same boundary is used for body and shoe fill.
    """
    x0, x1, ground = region
    threshold = ground - 2.3
    result = []
    for sub in path.split("M")[1:]:
        values = list(map(float, re.findall(r"-?\d+(?:\.\d+)?", sub)))
        position = np.array(values[:2]); curves = []
        for j in range(2, len(values), 6):
            p = np.vstack([position, np.array(values[j:j+6]).reshape(3, 2)])
            position = p[-1]
            # A cubic may enter/leave the bottom band between its endpoints.
            y = p[:, 1]
            roots = np.roots([-y[0]+3*y[1]-3*y[2]+y[3], 3*y[0]-6*y[1]+3*y[2],
                              -3*y[0]+3*y[1], y[0]-threshold])
            cuts = sorted(float(r.real) for r in roots if abs(r.imag)<1e-7 and 1e-7<r.real<1-1e-7)
            rest, previous = p, 0
            for t in cuts:
                first, rest = split_curve(rest, (t-previous)/(1-previous))
                curves.append(first); previous = t
            curves.append(rest)
        def inside(p):
            mid = split_curve(p, .5)[0][-1]
            return x0 < mid[0] < x1 and mid[1] >= threshold - 1e-5
        if not any(map(inside, curves)):
            result.append("M" + sub); continue
        outside = next((i for i,p in enumerate(curves) if not inside(p)), None)
        if outside is None:
            result.append("M" + sub); continue
        curves = curves[outside:] + curves[:outside]
        clean, i = [], 0
        while i < len(curves):
            if not inside(curves[i]):
                clean.append(curves[i]); i += 1; continue
            a = curves[i][0]
            while i < len(curves) and inside(curves[i]):
                b = curves[i][-1]; i += 1
            sign = np.sign(b[0]-a[0]); radius = min(2.4, abs(b[0]-a[0])/5)
            u = np.array([a[0]+sign*radius, ground]); v = np.array([b[0]-sign*radius, ground])
            clean.extend([
                np.array([a, [a[0], ground-.6], [u[0]-sign*.8, ground], u]),
                np.array([u, u+(v-u)/3, u+2*(v-u)/3, v]),
                np.array([v, [v[0]+sign*.8, ground], [b[0], ground-.6], b]),
            ])
        result.append("M"+pair(clean[0][0])+"".join("C"+" ".join(map(pair,p[1:])) for p in clean)+"Z")
    return "".join(result)


def without_region(path, region):
    x0, y0, x1, y1 = region
    result = []
    for part in path.split("M")[1:]:
        xy = np.array(list(map(float, re.findall(r"-?\d+(?:\.\d+)?", part)))).reshape(-1, 2)
        centre = xy.mean(0)
        if not (x0 < centre[0] < x1 and y0 < centre[1] < y1):
            result.append("M"+part)
    return "".join(result)


# Smooth vest boundaries follow the original arm openings and fabric hem.
# The two rear-view slivers are the vest visible outside the lowered arms.
VESTS = {
    "hands_behind": (
        "M91,81C104,78 114,88 121,98C127,107 129,111 128,120C126,134 125,147 127,162"
        "C111,163 99,163 88,160C93,144 91,131 89,119C98,123 107,122 112,115"
        "C117,107 117,99 112,92C106,84 99,82 91,83Z"
        "M230,79C234,86 240,89 247,89C254,89 259,85 261,79L264,80"
        "C260,92 260,104 260,116C260,130 254,140 252,153C251,155 251,157 251,159"
        "L244,159C243,145 239,138 236,127C233,114 234,103 234,95"
        "C234,89 232,84 229,80Z"
        "M223,141C222,146 221,151 220,157L226,159C225,153 224,147 223,141Z"
        "M271,141C272,148 272,153 274,157L268,159C269,153 270,147 271,141Z"
    ),
    "quad_stretch": (
        "M100,81C110,77 119,80 126,85C134,91 137,100 139,110"
        "C138,121 134,132 130,145C129,149 129,153 129,156"
        "C120,156 111,154 100,151C104,139 109,127 116,116"
        "C126,114 131,108 130,100C129,91 123,85 116,83"
        "C106,81 100,84 97,92C94,98 93,104 93,110"
        "L91,110C91,97 94,87 100,81Z"
    ),
    "quad_left": (
        "M142,81C132,77 123,80 116,85C108,91 105,100 103,110"
        "C104,121 108,132 112,145C113,149 113,153 113,156"
        "C123,156 132,154 142,151C138,139 133,127 126,116"
        "C116,114 111,108 112,100C113,91 119,85 126,83"
        "C136,81 142,84 145,92C148,98 149,104 149,110"
        "L151,110C151,97 148,87 142,81Z"
    ),
}

SOLES = {
    "hands_behind": [(89, 133, 326.5), (217, 241, 331), (250, 276, 331)],
    "quad_stretch": [(96, 137, 307.5)],
    "quad_left": [(103, 145, 307.5)],
    "chair_dip": [(219, 264, 242.5)],
    "crunch_reach": [(299, 354, 189.5)],
}


def polish_pose(pose, name):
    if name in VESTS:
        pose[2] = VESTS[name]
    for region in SOLES.get(name, []):
        # Only repair a sole if this recording's contour actually reaches it.
        # This also keeps an obsolete calibration from flattening another part.
        x0, x1, y = region
        pose[0] = flatten_sole(pose[0], region)
        pose[5] = flatten_sole(pose[5], region)
        pose[6] = without_region(pose[6], (x0-3, y-5, x1+3, y+5))
        # A single uniform rubber strip replaces the broken dark compression
        # islands; the shared silhouette clips heel and toe precisely.
        pose[6] += f"M{x0},{y-1.3}C{x0+10},{y-1.3} {x1-10},{y-1.3} {x1},{y-1.3}C{x1},{y} {x1},{y+1} {x1},{y+1}C{x1-10},{y+1} {x0+10},{y+1} {x0},{y+1}Z"
    return pose


MUSCLE_LINES = {
    "hands_behind": "M89,88C89,82 95,82 100,82C108,82 113,90 113,97C113,107 105,111 97,117"
                    "M228,82C221,82 213,85 212,92C211,100 215,107 216,112"
                    "M266,82C273,82 281,85 282,92C283,100 279,107 278,112",
    "quad_stretch": "M119,168C119,179 119.5,190 119,201C118.5,211 116.5,219 113,226",
    "quad_left": "M123,168C123,179 122.5,190 123,201C123.5,211 125.5,219 130,226",
}


def capsule(x, y, width, height):
    """Exact uniform dash with semicircular ends, expressed as SVG curves."""
    r = width / 2
    return (f"M{x-r},{y+r}V{y+height-r}Q{x-r},{y+height} {x},{y+height}"
            f"Q{x+r},{y+height} {x+r},{y+height-r}V{y+r}Q{x+r},{y} {x},{y}Q{x-r},{y} {x-r},{y+r}Z")


def arrow_path(centre, direction):
    """One clean rounded arrow, keeping the source's measured travel path."""
    # Polygon tip/head/stem in local coordinates; quadratic corners round
    # every join without the ragged silhouette of a compressed source frame.
    points = np.array([[-10,-2], [2,-2], [2,-5], [9,0], [2,5], [2,2], [-10,2]], float)
    angle = np.arctan2(direction[1], direction[0])
    rotation = np.array([[np.cos(angle),-np.sin(angle)],[np.sin(angle),np.cos(angle)]])
    points = points @ rotation.T + centre
    first, commands = None, []
    for i,p in enumerate(points):
        previous, following = points[i-1], points[(i+1)%len(points)]
        before = p+(previous-p)/np.linalg.norm(previous-p)*.65
        after = p+(following-p)/np.linalg.norm(following-p)*.65
        if first is None:
            first = before; commands.append("M"+pair(before))
        else:
            commands.append("L"+pair(before))
        commands.append("Q"+pair(p)+" "+pair(after))
    return "".join(commands)+"Z"
