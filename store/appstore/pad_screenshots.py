#!/usr/bin/env python3
"""Pad Jodoo phone screenshots to 1290x2796 for the App Store listing.

Apple's required iPhone screenshot slot (6.7" display) accepts exactly
1290x2796 (portrait). Source captures are 877x2048 (ratio 1:2.34), taller
than Apple's 1:2.167, so we scale to fit the height and pad the sides -
same technique as store/play/pad_screenshots.py, which this is a copy of
with Apple's dimensions: the padding replicates each row's edge pixel
outward so the fill matches the UI at that height instead of banding one
flat colour. Keep the two scripts in step if the technique changes.

Usage:
    ~/.venvs/imaging/bin/python pad_screenshots.py ../play/screenshots/phone screenshots/iphone-6.7
"""

import sys
from pathlib import Path

from PIL import Image

TARGET_W, TARGET_H = 1290, 2796


def pad(src: Path, dst: Path) -> str:
    im = Image.open(src)
    im = im.convert("RGB")  # no alpha, per App Store requirement
    ow, oh = im.size

    # Scale to fit inside the target box, preserving aspect ratio.
    scale = min(TARGET_W / ow, TARGET_H / oh)
    nw, nh = round(ow * scale), round(oh * scale)
    im = im.resize((nw, nh), Image.LANCZOS)

    canvas = Image.new("RGB", (TARGET_W, TARGET_H), (255, 255, 255))
    ox, oy = (TARGET_W - nw) // 2, (TARGET_H - nh) // 2
    canvas.paste(im, (ox, oy))

    # Edge-replicate horizontally: a 1px column stretched sideways repeats that
    # row's exact colour, so the seam is invisible at every height.
    if ox > 0:
        left = im.crop((0, 0, 1, nh)).resize((ox, nh), Image.NEAREST)
        canvas.paste(left, (0, oy))
        right_w = TARGET_W - (ox + nw)
        right = im.crop((nw - 1, 0, nw, nh)).resize((right_w, nh), Image.NEAREST)
        canvas.paste(right, (ox + nw, oy))

    # Same trick vertically, in case a source is ever wider than the target.
    if oy > 0:
        top = canvas.crop((0, oy, TARGET_W, oy + 1)).resize((TARGET_W, oy), Image.NEAREST)
        canvas.paste(top, (0, 0))
        bot_h = TARGET_H - (oy + nh)
        bot = canvas.crop((0, oy + nh - 1, TARGET_W, oy + nh)).resize((TARGET_W, bot_h), Image.NEAREST)
        canvas.paste(bot, (0, oy + nh))

    dst.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dst, "PNG", optimize=True)
    return f"{ow}x{oh} -> scaled {nw}x{nh} -> padded {TARGET_W}x{TARGET_H}"


def main() -> int:
    src_dir, dst_dir = Path(sys.argv[1]), Path(sys.argv[2])
    files = sorted(p for p in src_dir.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"})
    if not files:
        print(f"no images found in {src_dir}")
        return 1
    for i, src in enumerate(files, start=1):
        dst = dst_dir / f"{i:02d}-{src.stem}.png"
        print(f"{src.name:24} {pad(src, dst)}  -> {dst.name}")
    print(f"\n{len(files)} file(s) written to {dst_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
