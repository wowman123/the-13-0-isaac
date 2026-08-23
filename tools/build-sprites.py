#!/usr/bin/env python3
"""
Generate assets/sprites/<COLLECTIBLE_ID>.png from an extracted HD sprite pack.

    python3 tools/build-sprites.py "/path/to/TBOI HD Sprites"

Only items present in data/ratings.psv are emitted, so the repo carries the ~180
sprites the site actually renders rather than the whole pack. Source art is
512x512 with inconsistent padding, so each sprite is trimmed to its alpha
bounding box and fitted into a common box - otherwise a tall item and a wide one
render at wildly different apparent sizes in the same row.

Requires Pillow. This is a one-off asset step, not part of `npm run check`.
"""

import json
import os
import re
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("build-sprites: needs Pillow (pip install Pillow)")

BOX = 64          # output canvas, 2x the largest on-screen size
PAD = 2           # breathing room inside the canvas
SEARCH_DIRS = ["1_Passive Items", "2_Active Items"]

# The pack's filename does not always match the in-game collectible name.
OVERRIDES = {
    "COLLECTIBLE_ODD_MUSHROOM_LARGE": "Odd Mushroom (fat)",
}

ROOT = Path(__file__).resolve().parent.parent


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower().replace("&", "and"))


def no_the(s: str) -> str:
    return re.sub(r"^the", "", norm(s))


def build_index(pack: Path):
    exact, loose = {}, {}
    for d in SEARCH_DIRS:
        folder = pack / d
        if not folder.is_dir():
            sys.exit(f"build-sprites: {folder} not found - is that the pack root?")
        for f in folder.iterdir():
            if f.suffix.lower() not in (".png", ".webp"):
                continue
            exact.setdefault(norm(f.stem), f)
            loose.setdefault(no_the(f.stem), f)
    return exact, loose


def read_items():
    items = []
    for line in (ROOT / "data/ratings.psv").read_text().splitlines():
        if line.startswith("COLLECTIBLE_"):
            parts = line.split("|")
            items.append((parts[0], parts[1]))
    return items


def render(src: Path, dest: Path):
    im = Image.open(src).convert("RGBA")
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)

    inner = BOX - PAD * 2
    scale = min(inner / im.width, inner / im.height)
    size = (max(1, round(im.width * scale)), max(1, round(im.height * scale)))
    im = im.resize(size, Image.LANCZOS)

    canvas = Image.new("RGBA", (BOX, BOX), (0, 0, 0, 0))
    canvas.paste(im, ((BOX - size[0]) // 2, (BOX - size[1]) // 2), im)
    canvas.save(dest, "PNG", optimize=True)


def main():
    if len(sys.argv) < 2:
        sys.exit('usage: python3 tools/build-sprites.py "<path to TBOI HD Sprites>"')

    pack = Path(sys.argv[1])
    exact, loose = build_index(pack)
    out_dir = ROOT / "assets/sprites"
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest, missing = {}, []
    for item_id, name in read_items():
        key = OVERRIDES.get(item_id, name)
        src = exact.get(norm(key)) or loose.get(no_the(key))
        if not src:
            missing.append((item_id, name))
            continue
        render(src, out_dir / f"{item_id}.png")
        manifest[item_id] = f"{item_id}.png"

    (ROOT / "data/sprites.json").write_text(
        json.dumps({"box": BOX, "count": len(manifest), "sprites": sorted(manifest)}, indent=2) + "\n"
    )

    total = sum(f.stat().st_size for f in out_dir.glob("*.png"))
    print(f"build-sprites: {len(manifest)} sprites written ({total / 1024:.0f} KB total)")
    if missing:
        print(f"  {len(missing)} without art - add them to OVERRIDES:")
        for item_id, name in missing:
            print(f"    {name}  ({item_id})")
        sys.exit(1)


if __name__ == "__main__":
    main()
