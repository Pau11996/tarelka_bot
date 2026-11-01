"""Join the four native/source comparisons in the original exercise order."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "outputs/workout-reference/november-stretches"


def main():
    names = ["crunch_reach", "hands_behind", "quad_stretch", "quad_left"]
    manifest = OUT / "chapters.txt"
    manifest.write_text("".join(f"file '{OUT / name / 'cycle.mp4'}'\n" for name in names for _ in range(2)))
    result = OUT / "four-exercises-comparison.mp4"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(manifest),
                    "-c", "copy", "-movflags", "+faststart", "-y", str(result)], check=True)
    print(result)


if __name__ == "__main__":
    main()
