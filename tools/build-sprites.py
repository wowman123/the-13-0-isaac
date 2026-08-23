#!/usr/bin/env python3
"""
Generate assets/sprites/<COLLECTIBLE_ID>.png from a directory of item art.

    python3 tools/build-sprites.py "/path/to/sprites"

Two layouts are understood:

  * a flat directory of "Item Name.png" / "Item_Name.png"
  * an HD pack with "1_Passive Items" / "2_Active Items" subdirectories

Only items present in data/items.json are emitted, so the repo carries the art
the site actually renders rather than a whole pack.

Source art is the game's own 32x32 sprites. They are scaled with NEAREST and
padded to a common box, which keeps the pixel grid intact — smooth resampling
turns pixel art to mush, and inconsistent padding makes a tall item and a wide
one render at very different apparent sizes in the same row.

Requires Pillow. A one-off asset step, not part of `npm run check`.
"""

import json
import re
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("build-sprites: needs Pillow (pip install Pillow)")

BOX = 64
PAD = 2
HD_DIRS = ["1_Passive Items", "2_Active Items"]

ROOT = Path(__file__).resolve().parent.parent


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower().replace("&", "and"))


def strip_article(s: str) -> str:
    return re.sub(r"^the", "", norm(s))


def build_index(source: Path) -> dict:
    """name-key -> file, tolerant of the article and of either layout."""
    files = []
    hd = [source / d for d in HD_DIRS if (source / d).is_dir()]
    for folder in (hd or [source]):
        files += [f for f in folder.rglob("*") if f.suffix.lower() in (".png", ".webp")]

    if not files:
        sys.exit(f"build-sprites: no image files under {source}")

    index = {}
    for f in files:
        index.setdefault(norm(f.stem), f)
        index.setdefault(strip_article(f.stem), f)
    return index


def render(src: Path, dest: Path) -> None:
    im = Image.open(src).convert("RGBA")
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)

    inner = BOX - PAD * 2
    # Integer scaling where it fits, so the pixel grid survives.
    scale = min(inner / im.width, inner / im.height)
    scale = max(1, int(scale)) if scale >= 1 else scale
    size = (max(1, round(im.width * scale)), max(1, round(im.height * scale)))
    im = im.resize(size, Image.NEAREST)

    canvas = Image.new("RGBA", (BOX, BOX), (0, 0, 0, 0))
    canvas.paste(im, ((BOX - size[0]) // 2, (BOX - size[1]) // 2), im)
    canvas.save(dest, "PNG", optimize=True)


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit('usage: python3 tools/build-sprites.py "<path to sprite source>"')

    index = build_index(Path(sys.argv[1]))
    out_dir = ROOT / "assets/sprites"
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob("*.png"):
        stale.unlink()

    items = json.loads((ROOT / "data/items.json").read_text())["items"]
    manifest, missing = {}, []

    for item in items:
        src = index.get(norm(item["name"])) or index.get(strip_article(item["name"]))
        if not src:
            missing.append(item["name"])
            continue
        render(src, out_dir / f"{item['id']}.png")
        manifest[item["id"]] = f"{item['id']}.png"

    (ROOT / "data/sprites.json").write_text(
        json.dumps({"box": BOX, "count": len(manifest), "sprites": sorted(manifest)}, indent=2) + "\n"
    )

    total = sum(f.stat().st_size for f in out_dir.glob("*.png"))
    print(f"build-sprites: {len(manifest)} of {len(items)} items have art ({total / 1024:.0f} KB)")
    if missing:
        print(f"  {len(missing)} without art: {', '.join(missing[:10])}")


if __name__ == "__main__":
    main()
