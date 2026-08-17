#!/usr/bin/env python3
"""Create full-bleed, standardized derivative faces from the supplied card deck.

The production source files remain untouched in public/cards. Derived cards are
written to public/cards/trimmed with the same filenames, so the UI can switch
between variants through its one centralized asset mapper.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image


SOURCE_DIRECTORY = Path("public/cards")
OUTPUT_DIRECTORY = SOURCE_DIRECTORY / "trimmed"
OUTPUT_SIZE = (800, 1200)
BACKGROUND_DIFFERENCE_THRESHOLD = 28


def content_bounds(image: Image.Image) -> tuple[int, int, int, int]:
    """Find the supplied face's non-canvas bounds from its outer edge colours."""

    pixels = np.asarray(image.convert("RGB"))
    edge_size = 12
    border = np.concatenate(
        (
            pixels[:edge_size].reshape(-1, 3),
            pixels[-edge_size:].reshape(-1, 3),
            pixels[:, :edge_size].reshape(-1, 3),
            pixels[:, -edge_size:].reshape(-1, 3),
        ),
    )
    canvas_colour = np.median(border, axis=0)
    difference = np.max(np.abs(pixels.astype(np.int16) - canvas_colour.astype(np.int16)), axis=2)
    ys, xs = np.where(difference > BACKGROUND_DIFFERENCE_THRESHOLD)

    if len(xs) == 0 or len(ys) == 0:
        return (0, 0, image.width, image.height)

    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)


def expand_to_card_aspect(
    bounds: tuple[int, int, int, int], image: Image.Image
) -> tuple[int, int, int, int]:
    """Expand a detected face into 2:3 source bounds without cutting its corners."""

    left, top, right, bottom = bounds
    width = right - left
    height = bottom - top
    target_ratio = OUTPUT_SIZE[0] / OUTPUT_SIZE[1]

    if width / height > target_ratio:
        target_height = round(width / target_ratio)
        extra = target_height - height
        top = max(0, top - extra // 2)
        bottom = min(image.height, top + target_height)
        top = max(0, bottom - target_height)
    elif width / height < target_ratio:
        target_width = round(height * target_ratio)
        extra = target_width - width
        left = max(0, left - extra // 2)
        right = min(image.width, left + target_width)
        left = max(0, right - target_width)

    return (left, top, right, bottom)


def standardize_face(path: Path) -> tuple[tuple[int, int, int, int], Path]:
    source = Image.open(path).convert("RGB")
    bounds = expand_to_card_aspect(content_bounds(source), source)
    face = source.crop(bounds)
    full_bleed_face = face.resize(OUTPUT_SIZE, Image.Resampling.LANCZOS)

    output_path = OUTPUT_DIRECTORY / path.name
    full_bleed_face.save(output_path, "WEBP", quality=95, method=6)
    return bounds, output_path


def main() -> None:
    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    sources = sorted(SOURCE_DIRECTORY.glob("*.webp"))

    if len(sources) != 54:
        raise RuntimeError(f"Expected 54 source card files, found {len(sources)}.")

    for source in sources:
        bounds, output = standardize_face(source)
        print(f"{source.name}: {bounds} -> {output}")


if __name__ == "__main__":
    main()
