#!/usr/bin/env python3
"""Generate the Play Store icon and feature graphic from the app's own assets.

Outputs into graphics/:
  icon-512.png        512x512 32-bit PNG with alpha  (Play: app icon)
  feature-graphic.png 1024x500 24-bit PNG, no alpha  (Play: feature graphic)

Colours are sampled from app/assets/icon.png so the listing matches the app:
  #1a237e  brand blue (also the splash/adaptive-icon background in app.json)
  #1a348f  lighter blue of the icon's diagonal
  #4caf50  the check green
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

DARK = (26, 35, 126)
LIGHT = (26, 52, 143)
WHITE = (255, 255, 255)

FEATURE_W, FEATURE_H = 1024, 500
ICON_PX = 512

FONT_BOLD = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"

WORDMARK = "JoDoo"
TAGLINE = "To-do and shopping lists that work offline"
SUBLINE = "No account  ·  No ads  ·  No tracking"


def rounded(im: Image.Image, radius: int) -> Image.Image:
    """Round the corners of a square icon so it reads as an app tile."""
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([(0, 0), (im.size[0] - 1, im.size[1] - 1)],
                                           radius=radius, fill=255)
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out


def make_icon(src: Path, dst: Path) -> str:
    im = Image.open(src).convert("RGBA").resize((ICON_PX, ICON_PX), Image.LANCZOS)
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, "PNG", optimize=True)
    kb = dst.stat().st_size / 1024
    return f"{ICON_PX}x{ICON_PX} RGBA {kb:.0f}KB (Play limit 1024KB)"


def make_feature(src_mark: Path, dst: Path) -> str:
    canvas = Image.new("RGB", (FEATURE_W, FEATURE_H), DARK)
    d = ImageDraw.Draw(canvas)
    # Same diagonal as the app icon: lighter wedge toward the top-right.
    d.polygon([(0, 0), (FEATURE_W, 0), (FEATURE_W, FEATURE_H)], fill=LIGHT)

    # Use the adaptive-icon foreground (the mark on transparency) rather than
    # icon.png. icon.png carries its own blue diagonal, which collides with the
    # backdrop and reads as a stray wedge instead of an app tile.
    mark = Image.open(src_mark).convert("RGBA")
    mark = mark.crop(mark.split()[3].getbbox())
    mh = 300
    mw = round(mark.size[0] * mh / mark.size[1])
    mark = mark.resize((mw, mh), Image.LANCZOS)
    tile_x, tile_y = 118, (FEATURE_H - mh) // 2
    canvas.paste(mark, (tile_x, tile_y), mark)
    # Text column starts from a fixed point so wordmark alignment is stable
    # regardless of the mark's aspect ratio.
    tile_x, mark_w = 78, 260

    f_mark = ImageFont.truetype(FONT_BOLD, 104)
    f_tag = ImageFont.truetype(FONT_REG, 33)
    f_sub = ImageFont.truetype(FONT_REG, 26)

    x = tile_x + 260 + 62
    # Vertically centre the three-line block as a unit.
    h_mark = d.textbbox((0, 0), WORDMARK, font=f_mark)[3]
    block_h = h_mark + 26 + 33 + 20 + 26
    y = (FEATURE_H - block_h) // 2 - 8

    d.text((x, y), WORDMARK, font=f_mark, fill=WHITE)
    y += h_mark + 26
    d.text((x, y), TAGLINE, font=f_tag, fill=(226, 232, 245))
    y += 33 + 20
    d.text((x, y), SUBLINE, font=f_sub, fill=(154, 170, 214))

    dst.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dst, "PNG", optimize=True)
    kb = dst.stat().st_size / 1024
    return f"{FEATURE_W}x{FEATURE_H} RGB {kb:.0f}KB"


def main() -> int:
    assets = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("../../app/assets")
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("graphics")
    icon_src = assets / "icon.png"
    mark_src = assets / "android-icon-foreground.png"
    for p in (icon_src, mark_src):
        if not p.exists():
            print(f"missing {p}")
            return 1
    print("icon-512.png       ", make_icon(icon_src, out / "icon-512.png"))
    print("feature-graphic.png", make_feature(mark_src, out / "feature-graphic.png"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
