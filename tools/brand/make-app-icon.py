#!/usr/bin/env python3
"""
Generate the macOS-style app icon source images for Helix CRM.

Apple HIG review finding 7 (top-ten item 7): the previous icon was an opaque
white square with the mark inset — macOS itself masks a square source into a
rounded rectangle, so the flat square edges looked wrong. The owner (Walker)
decided the icon should instead READ as a rounded-rect on its own: the four
Helix marks on a plain WHITE background, no ring, no border, no drop shadow
(a hairline shadow was explicitly rejected). This script draws that rounded
square itself (rather than relying on macOS's own mask) so the PNG we hand to
`tauri icon` already looks correct before the OS ever touches it, and so the
same source can be inspected/reused for Windows/Linux where nothing does the
masking for us.

The exact numbers, and why they are what they are:

  CANVAS_SIZE = 1024        Apple's icon source template is a 1024x1024 PNG
                             (App Icon "1024pt @1x" in Xcode/Icon Composer
                             terms); `tauri icon` also expects a 1024-ish
                             square source to downsample from.

  CORNER_RADIUS_PCT = 0.2237  Apple's own 1024pt icon template uses a
                             "squircle" superellipse, but its continuous
                             corner is well approximated by a simple rounded
                             rectangle at ~22.37% of the icon's width for the
                             corner radius (≈229px at 1024). Using a plain
                             rounded-rect (not a true squircle) is a
                             deliberate simplification: at this radius the
                             visual difference from a superellipse is small,
                             and it keeps this script dependency-free.

  MARK_WIDTH_PCT = 0.62     The four marks, as a group, should occupy about
                             62% of the icon's width, centred. This leaves
                             comfortable, even breathing room on all sides
                             (the marks are ~9% taller than they are wide, so
                             scaling by width keeps them from ever touching
                             the rounded corners).

  SUPERSAMPLE = 4           The rounded-rect mask is rendered at 4x
                             (4096x4096) and downsampled with LANCZOS to
                             1024x1024, so the corner curve is antialiased
                             instead of jagged. The mark artwork itself is
                             also resized with LANCZOS for the same reason.

Sources considered (see assets/brand/):
  - helix-logo-icon-white.png : marks already flattened onto white — fine
    for a quick look, but not usable for compositing (no alpha).
  - helix-logo-square.png     : transparent, but marks are semi-opaque and
    it carries a baked-in ring/border we don't want.
  - helix-logo-source.png     : marks with a heavy black ring baked onto
    white — has the ring we're explicitly told not to use.
  - helix-logo.png            : transparent background, true per-pixel
    alpha, marks drawn cleanly — but ALSO carries a thin black rounded-rect
    ring baked in near the outer edge of the canvas. USED HERE: we crop out
    only the four-mark cluster (tight bounding box, well inside the ring's
    position) and discard the ring entirely, then draw our own rounded
    square around the marks per the owner's spec.

Dark variant (assets/brand/app-icon-macos-dark.png):
  Same geometry, but the background is the app's own dark-theme canvas
  colour, #141414 (src/styles/tokens.css, [data-theme="dark"] --color-bg —
  "the guide's near-black"), not pure black. The four marks are lightened by
  blending ~18% toward white so they keep comfortable contrast against that
  near-black surface (the raw mark colours already clear 3:1, except the
  brand red at 3.71:1, which is thin for a mark that has to "read"; the
  lightened set clears >4.5:1 across all four).

  IMPORTANT: this dark variant is NOT wired into the build. Tauri cannot
  ship a separate dark-mode app icon without an Icon Composer (.icon)
  bundle, which this project does not have yet. It is kept here, ready to
  drop in once code signing / Icon Composer packaging lands.

Usage:
    python3 tools/brand/make-app-icon.py

Requires Pillow (`pip install pillow`).
"""

from __future__ import annotations

import os

from PIL import Image, ImageDraw

# ---------------------------------------------------------------------------
# Geometry constants — see module docstring for the reasoning behind each.
# ---------------------------------------------------------------------------
CANVAS_SIZE = 1024
CORNER_RADIUS_PCT = 0.2237  # ~229px at 1024 — Apple's 1024pt template radius
MARK_WIDTH_PCT = 0.62  # the four marks occupy ~62% of the canvas width
SUPERSAMPLE = 4  # render the rounded-rect mask at 4x, then downsample

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BRAND_DIR = os.path.join(REPO_ROOT, "assets", "brand")
SOURCE_MARKS = os.path.join(BRAND_DIR, "helix-logo.png")
OUT_LIGHT = os.path.join(BRAND_DIR, "app-icon-macos.png")
OUT_DARK = os.path.join(BRAND_DIR, "app-icon-macos-dark.png")

# Tight bounding box (with a small safety pad) of just the four marks inside
# helix-logo.png, found by isolating each mark's flat colour and excluding
# the black ring and its antialiased fringe (which are both near-grayscale,
# unlike the marks, which are all saturated hues). The ring itself sits at
# roughly x:80-2077, y:80-2079 in that 2158x2160 source — far outside this
# box — so cropping this box drops the ring entirely without masking.
MARKS_CROP_BOX = (423, 332, 1732, 1754)  # (left, top, right, bottom)

# Near-black dark-theme canvas colour, taken from src/styles/tokens.css
# ([data-theme="dark"] --color-bg: #141414, "the guide's near-black") rather
# than inventing a new value.
DARK_BG = (0x14, 0x14, 0x14)
LIGHT_BG = (0xFF, 0xFF, 0xFF)

# How much to blend each mark colour toward white for the dark variant.
DARK_MARK_LIGHTEN = 0.18


def load_marks() -> Image.Image:
    """Crop the four Helix marks (with true alpha, no ring) out of the
    transparent brand source."""
    src = Image.open(SOURCE_MARKS).convert("RGBA")
    return src.crop(MARKS_CROP_BOX)


def lighten_marks(marks: Image.Image, amount: float) -> Image.Image:
    """Blend the RGB of every pixel toward white by `amount` (0-1), leaving
    alpha untouched. Used only for the dark-background variant so the marks
    keep good contrast on the near-black canvas."""
    r, g, b, a = marks.split()
    out_channels = []
    for chan in (r, g, b):
        out_channels.append(chan.point(lambda v: round(v + (255 - v) * amount)))
    out_channels.append(a)
    return Image.merge("RGBA", out_channels)


def rounded_rect_mask(size: int, radius: int, supersample: int) -> Image.Image:
    """Antialiased single-channel mask: opaque inside a rounded rect, fully
    transparent outside. Drawn at `supersample`x and downsampled with
    LANCZOS so the corner curve is smooth rather than jagged."""
    big_size = size * supersample
    big_radius = radius * supersample
    mask = Image.new("L", (big_size, big_size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        (0, 0, big_size - 1, big_size - 1), radius=big_radius, fill=255
    )
    return mask.resize((size, size), Image.LANCZOS)


def make_icon(bg_color: tuple[int, int, int], marks: Image.Image, out_path: str) -> None:
    size = CANVAS_SIZE
    radius = round(size * CORNER_RADIUS_PCT)

    # Opaque background square, full canvas.
    base = Image.new("RGBA", (size, size), bg_color + (255,))

    # Resize the marks so their group width is ~62% of the canvas, keeping
    # their native aspect ratio (they are ~9% taller than wide).
    target_w = round(size * MARK_WIDTH_PCT)
    scale = target_w / marks.width
    target_h = round(marks.height * scale)
    marks_resized = marks.resize((target_w, target_h), Image.LANCZOS)

    dest_x = (size - target_w) // 2
    dest_y = (size - target_h) // 2
    base.alpha_composite(marks_resized, dest=(dest_x, dest_y))

    # Mask the whole thing into a rounded square; everything outside is
    # fully transparent.
    mask = rounded_rect_mask(size, radius, SUPERSAMPLE)
    base.putalpha(mask)

    base.save(out_path)
    print(f"wrote {out_path} ({size}x{size}, radius={radius}px, marks={target_w}x{target_h})")


def main() -> None:
    marks = load_marks()

    make_icon(LIGHT_BG, marks, OUT_LIGHT)

    dark_marks = lighten_marks(marks, DARK_MARK_LIGHTEN)
    make_icon(DARK_BG, dark_marks, OUT_DARK)


if __name__ == "__main__":
    main()
