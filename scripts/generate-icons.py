#!/usr/bin/env python3
"""Generate browser, PWA, and iOS icons from the supplied NutriVision artwork."""
import subprocess
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow"])
    from PIL import Image

PUBLIC = Path(__file__).resolve().parent.parent / "public"
SOURCE = PUBLIC / "NutriVision AI Healthy Food App Icon.png"
SIZES = [16, 32, 48, 72, 96, 128, 144, 152, 192, 384, 512]
RESAMPLE = Image.Resampling.LANCZOS


def load_icon(size: int) -> Image.Image:
    """Resize the supplied square artwork for an icon slot."""
    with Image.open(SOURCE) as source:
        return source.convert("RGB").resize((size, size), RESAMPLE)


def main():
    PUBLIC.mkdir(parents=True, exist_ok=True)
    if not SOURCE.is_file():
        raise FileNotFoundError(f"App icon source not found: {SOURCE}")

    for size in SIZES:
        load_icon(size).save(PUBLIC / f"icon-{size}.png", "PNG")

    for size in [16, 32, 48]:
        load_icon(size).save(PUBLIC / f"favicon-{size}.png", "PNG")

    load_icon(180).save(PUBLIC / "apple-touch-icon.png", "PNG")
    load_icon(32).save(
        PUBLIC / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32)],
    )
    print("Generated full-bleed browser, PWA, and iOS app icons.")


if __name__ == "__main__":
    main()
