"""Make isolated source clips and a numbered, sequential comparison reel."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "outputs/workout-reference/exercises-batch"
STEPS = [
    ("chair_dip", "1 / 4 · Обратные отжимания от стула"),
    ("prone_pull", "2 / 4 · Локти к бокам лёжа"),
    ("plank_pike", "3 / 4 · Из планки в перевёрнутую V"),
    ("seated_knee_tuck", "4 / 4 · Ноги к себе — от себя"),
]


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", *args], check=True)


def main():
    chapters = []
    for movement, title in STEPS:
        folder = OUT / movement
        ffmpeg("-framerate", "30", "-i", str(folder / "cycle-source/%03d.png"),
               "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-movflags", "+faststart", "-y", str(folder / "source.mp4"))
        caption = folder / "caption.txt"
        caption.write_text(title)
        chapter = folder / "chapter.mp4"
        ffmpeg("-stream_loop", "1", "-i", str(folder / "cycle.mp4"), "-vf",
               f"drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:textfile={caption}:fontsize=17:fontcolor=0x35553d:x=(w-tw)/2:y=417",
               "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", "-y", str(chapter))
        chapters.append(chapter)
    manifest = OUT / "chapters.txt"
    manifest.write_text("".join(f"file '{chapter}'\n" for chapter in chapters))
    result = OUT / "four-exercises-comparison.mp4"
    ffmpeg("-f", "concat", "-safe", "0", "-i", str(manifest), "-c", "copy", "-movflags", "+faststart", "-y", str(result))
    print(result)


if __name__ == "__main__":
    main()
