#!/usr/bin/env python3
"""Render the documents in ../sources as page images, then degrade them so they
look scanned, photocopied or faxed. Every output keeps the source's text as its
ground truth, so OCR accuracy can be measured without a scanner or a fax.

    python3 tests/ocr-eval/scripts/make_synthetic.py            # all sources, all profiles
    python3 tests/ocr-eval/scripts/make_synthetic.py --only ja-invoice --profiles fax-standard

Needs Pillow and NumPy (pip install pillow numpy). The Noto CJK fonts are
downloaded once into tests/ocr-eval/.cache/fonts (SIL Open Font License), so
the output is the same on every machine. Randomness is seeded from the sample
and profile names: running it twice gives the same pixels.

Writes, for each source and profile:
    synthetic/<profile>/<source>.png|.jpg   the page image
    synthetic/<profile>/<source>.pdf        the same image as an image-only PDF
and synthetic/<source>.gt.txt, the ground truth, plus synthetic/manifest.json.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "sources"
OUT = ROOT / "synthetic"
FONT_CACHE = ROOT / ".cache" / "fonts"

# Pinned to a commit so the rendered pixels do not change under us.
NOTO_COMMIT = "f8d157532fbfaeda587e826d4cd5b21a49186f7c"
FONTS = {
    "sans": ("NotoSansJP-Regular.otf", "Sans/SubsetOTF/JP/NotoSansJP-Regular.otf"),
    "serif": ("NotoSerifJP-Regular.otf", "Serif/SubsetOTF/JP/NotoSerifJP-Regular.otf"),
    "sans-bold": ("NotoSansJP-Bold.otf", "Sans/SubsetOTF/JP/NotoSansJP-Bold.otf"),
    "serif-bold": ("NotoSerifJP-Bold.otf", "Serif/SubsetOTF/JP/NotoSerifJP-Bold.otf"),
}

DPI = 300  # the clean master is rendered at this resolution
A4_MM = (210, 297)
MARGIN_MM = 22
NO_LINE_START = set("、。，．,.)）」』】〕・ー？！?!:;：；%％")
NO_LINE_END = set("(（「『【〔")


def mm(v: float) -> int:
    return round(v / 25.4 * DPI)


def pt(v: float) -> int:
    return round(v / 72 * DPI)


def font_path(kind: str) -> Path:
    name, rel = FONTS[kind]
    path = FONT_CACHE / name
    if not path.exists():
        FONT_CACHE.mkdir(parents=True, exist_ok=True)
        url = f"https://raw.githubusercontent.com/notofonts/noto-cjk/{NOTO_COMMIT}/{rel}"
        print(f"downloading {url}", file=sys.stderr)
        with urllib.request.urlopen(url) as r:
            path.write_bytes(r.read())
    return path


_font_cache: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def font(kind: str, size_pt: float) -> ImageFont.FreeTypeFont:
    key = (kind, pt(size_pt))
    if key not in _font_cache:
        _font_cache[key] = ImageFont.truetype(str(font_path(kind)), key[1])
    return _font_cache[key]


# ---------------------------------------------------------------- layout


def wrap(text: str, f: ImageFont.FreeTypeFont, width: int) -> list[str]:
    """Break text into lines no wider than width. Breaks between any two
    CJK characters, and only at spaces inside Latin words."""
    tokens: list[str] = []
    buf = ""
    for ch in text:
        if ch.isascii() and not ch.isspace():
            buf += ch
            continue
        if buf:
            tokens.append(buf)
            buf = ""
        tokens.append(ch)
    if buf:
        tokens.append(buf)

    lines: list[str] = []
    line = ""
    for tok in tokens:
        cand = line + tok
        if f.getlength(cand) <= width or not line:
            line = cand
            continue
        # Simple kinsoku: pull a forbidden line-start onto this line,
        # push a forbidden line-end onto the next.
        if tok in NO_LINE_START:
            line = cand
            continue
        carry = ""
        while line and line[-1] in NO_LINE_END:
            carry = line[-1] + carry
            line = line[:-1]
        lines.append(line.rstrip())
        line = (carry + tok).lstrip()
    if line.strip():
        lines.append(line.rstrip())
    return lines


@dataclass
class Page:
    img: Image.Image
    draw: ImageDraw.ImageDraw
    y: int
    left: int
    right: int


def new_page() -> Page:
    w, h = mm(A4_MM[0]), mm(A4_MM[1])
    img = Image.new("L", (w, h), 255)
    return Page(img, ImageDraw.Draw(img), mm(MARGIN_MM), mm(MARGIN_MM), w - mm(MARGIN_MM))


def draw_line(pg: Page, text: str, f, align: str = "left", x0: int | None = None, x1: int | None = None):
    x0 = pg.left if x0 is None else x0
    x1 = pg.right if x1 is None else x1
    w = f.getlength(text)
    if align == "center":
        x = x0 + (x1 - x0 - w) / 2
    elif align == "right":
        x = x1 - w
    else:
        x = x0
    pg.draw.text((x, pg.y), text, font=f, fill=0)


def render_horizontal(doc: dict) -> tuple[Image.Image, list[str]]:
    pg = new_page()
    base = doc.get("font", "sans")
    gt: list[str] = []
    for b in doc["blocks"]:
        if "space" in b:
            pg.y += mm(b["space"])
            continue
        size = b.get("size", 10.5)
        align = b.get("align", "left")
        if "h" in b:
            f = font(base + "-bold", size)
            for line in wrap(b["h"], f, pg.right - pg.left):
                draw_line(pg, line, f, align)
                pg.y += round(f.size * 1.5)
            pg.y += round(f.size * 0.3)
            gt.append(b["h"])
        elif "p" in b or "right" in b:
            text = b.get("p", b.get("right"))
            if "right" in b:
                align = "right"
            f = font(base, size)
            for line in wrap(text, f, pg.right - pg.left):
                draw_line(pg, line, f, align)
                pg.y += round(f.size * 1.6)
            pg.y += round(f.size * 0.4)
            gt.append(text)
        elif "kv" in b:
            f = font(base, size)
            label_w = max(f.getlength(k) for k, _ in b["kv"]) + mm(8)
            row_h = round(f.size * 2.1)
            for k, v in b["kv"]:
                top = pg.y
                pg.y += round((row_h - f.size) / 2.4)
                draw_line(pg, k, f, x0=pg.left + mm(2))
                draw_line(pg, v, f, x0=pg.left + int(label_w) + mm(2))
                pg.y = top + row_h
                pg.draw.line((pg.left, pg.y, pg.right, pg.y), fill=0, width=3)
                gt.append(f"{k} {v}")
            pg.y += mm(2)
        elif "table" in b:
            f = font(base, size)
            fb = font(base + "-bold", size)
            widths = b.get("widths") or [1 / len(b["table"][0])] * len(b["table"][0])
            aligns = b.get("align") or ["left"] * len(widths)
            total = pg.right - pg.left
            xs = [pg.left]
            for w in widths:
                xs.append(xs[-1] + round(w * total))
            xs[-1] = pg.right
            row_h = round(f.size * 2.0)
            top = pg.y
            for r, row in enumerate(b["table"]):
                y0 = pg.y
                pg.y += round((row_h - f.size) / 2.4)
                for c, cell in enumerate(row):
                    a = "left" if r == 0 else aligns[c]
                    draw_line(pg, cell, fb if r == 0 else f, a, xs[c] + mm(2), xs[c + 1] - mm(2))
                pg.y = y0 + row_h
                pg.draw.line((pg.left, y0, pg.right, y0), fill=0, width=4 if r <= 1 else 2)
                gt.append(" ".join(row))
            pg.draw.line((pg.left, pg.y, pg.right, pg.y), fill=0, width=4)
            for x in xs:
                pg.draw.line((x, top, x, pg.y), fill=0, width=2)
            pg.y += mm(3)
        else:
            raise ValueError(f"unknown block {b}")
        if pg.y > pg.img.height - mm(MARGIN_MM):
            raise ValueError(f"{doc['title']}: content does not fit on one page")
    return pg.img, gt


# Characters drawn rotated, or nudged, in vertical writing.
V_ROTATE = set("ー—…()（）「」『』〜～-")
V_SHIFT = set("、。，．")
V_SMALL = set("ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ")


def render_vertical(doc: dict) -> tuple[Image.Image, list[str]]:
    pg = new_page()
    f = font(doc.get("font", "serif"), doc.get("size", 12))
    cell = round(f.size * 1.05)
    col_w = round(f.size * 1.8)
    top = mm(MARGIN_MM)
    bottom = pg.img.height - mm(MARGIN_MM)
    per_col = (bottom - top) // cell
    x = pg.right - col_w
    gt: list[str] = []
    for b in doc["blocks"]:
        text = b["p"]
        gt.append(text)
        cols: list[str] = []
        cur = ""
        for ch in text:
            if len(cur) >= per_col and ch not in NO_LINE_START:
                cols.append(cur)
                cur = ""
            cur += ch
        cols.append(cur)
        for col in cols:
            for i, ch in enumerate(col):
                y = top + i * cell
                if ch in V_ROTATE:
                    tile = Image.new("L", (cell, cell), 255)
                    ImageDraw.Draw(tile).text((cell / 2, cell / 2), ch, font=f, fill=0, anchor="mm")
                    tile = tile.rotate(-90, fillcolor=255)
                    pg.img.paste(0, (x, y), ImageOps.invert(tile))
                    continue
                dx, dy = 0, 0
                if ch in V_SHIFT:
                    dx, dy = round(f.size * 0.6), round(-f.size * 0.6)
                elif ch in V_SMALL:
                    dx, dy = round(f.size * 0.1), round(-f.size * 0.1)
                pg.draw.text((x + cell / 2 + dx, y + cell / 2 + dy), ch, font=f, fill=0, anchor="mm")
            x -= col_w
            if x < pg.left:
                raise ValueError(f"{doc['title']}: content does not fit on one page")
        x -= col_w // 2  # paragraph gap
    return pg.img, gt


# ---------------------------------------------------------------- degradation


def rng_for(*parts: str) -> np.random.Generator:
    seed = int.from_bytes(hashlib.sha256("/".join(parts).encode()).digest()[:8], "big")
    return np.random.default_rng(seed)


def resample(img: Image.Image, xdpi: float, ydpi: float) -> Image.Image:
    w = round(img.width * xdpi / DPI)
    h = round(img.height * ydpi / DPI)
    return img.resize((w, h), Image.Resampling.BOX)


def rotate(img: Image.Image, deg: float) -> Image.Image:
    return img.rotate(deg, resample=Image.Resampling.BICUBIC, fillcolor=255, expand=False)


def as_array(img: Image.Image) -> np.ndarray:
    return np.asarray(img, dtype=np.float32)


def to_img(a: np.ndarray) -> Image.Image:
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "L")


def illumination(shape, rng, strength: float) -> np.ndarray:
    """A smooth, slightly uneven light field like a flatbed or a phone scan."""
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = rng.uniform(0.2, 0.8) * w, rng.uniform(0.2, 0.8) * h
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / math.hypot(w, h)
    return 1.0 - strength * d


def speckle(a: np.ndarray, rng, density: float, value: float) -> np.ndarray:
    mask = rng.random(a.shape) < density
    a = a.copy()
    a[mask] = value
    return a


def threshold(a: np.ndarray, t: float) -> Image.Image:
    return Image.fromarray(np.where(a < t, 0, 255).astype(np.uint8), "L").convert("1", dither=Image.Dither.NONE)


def p_clean(img, rng):
    return img, DPI, DPI


def p_scan_gray(img, rng):
    """Flatbed scan, 300 dpi grey: small skew, softness, paper tone, JPEG."""
    img = rotate(img, rng.uniform(-1.2, 1.2))
    img = img.filter(ImageFilter.GaussianBlur(0.8))
    a = as_array(img)
    a = 235 - (235 - 20) * (1 - a / 255)  # paper is not white, ink is not black
    a *= illumination(a.shape, rng, 0.12)
    a += rng.normal(0, 2.5, a.shape)
    return to_img(a), DPI, DPI


def p_scan_200_skew(img, rng):
    """Cheap scanner or scan-to-mail at 200 dpi: more skew, more blur."""
    img = rotate(img, rng.choice([-1, 1]) * rng.uniform(2.0, 3.0))
    img = img.filter(ImageFilter.GaussianBlur(1.3))
    img = resample(img, 200, 200)
    a = as_array(img)
    a = 225 - (225 - 35) * (1 - a / 255)
    a *= illumination(a.shape, rng, 0.2)
    a += rng.normal(0, 4, a.shape)
    return to_img(a), 200, 200


def p_photocopy(img, rng):
    """A copy of a copy, scanned bilevel at 300 dpi: thickened strokes, toner
    specks, a dark band at the edge."""
    img = rotate(img, rng.uniform(-0.8, 0.8))
    img = img.filter(ImageFilter.GaussianBlur(1.6))
    a = as_array(img)
    a += rng.normal(0, 18, a.shape)
    h, w = a.shape
    edge = np.zeros_like(a)
    band = mm(4)
    edge[:, :band] = np.linspace(-200, 0, band)[None, :]
    a += edge
    a = speckle(a, rng, 0.0008, 0)
    return threshold(a, 170), DPI, DPI


def fax(img, rng, ydpi: float):
    img = rotate(img, rng.uniform(-0.6, 0.6))
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    img = resample(img, 204, ydpi)
    a = as_array(img)
    a += rng.normal(0, 22, a.shape)
    a = speckle(a, rng, 0.0015, 0)
    a = speckle(a, rng, 0.002, 255)
    h, w = a.shape
    # Lines lost or smeared in transmission.
    for _ in range(int(rng.integers(2, 6))):
        y = int(rng.integers(0, h))
        a[y, :] = 255 if rng.random() < 0.6 else a[max(y - 1, 0), :]
    # A faint vertical streak from a dirty read head.
    x = int(rng.integers(w // 4, 3 * w // 4))
    a[:, x : x + 2] -= 90
    bw = threshold(a, 140)
    # Viewers show fax pixels as square-ish by repeating rows. Do it here so
    # the image has a single resolution and the PDF has the right size.
    bw = bw.resize((bw.width, round(bw.height * 204 / ydpi)), Image.Resampling.NEAREST)
    return bw, 204, 204


def p_fax_fine(img, rng):
    """G3 fax, fine mode: 204 x 196 dpi, bilevel, transmission noise."""
    return fax(img, rng, 196)


def p_fax_standard(img, rng):
    """G3 fax, standard mode: 204 x 98 dpi. Half the vertical resolution;
    small kanji are often illegible even to people."""
    return fax(img, rng, 98)


PROFILES = {
    "clean-300": (p_clean, "png", "Rendered page, no degradation (upper bound)."),
    "scan-300-gray": (p_scan_gray, "jpg", "Flatbed scan, 300 dpi grey, slight skew, JPEG."),
    "scan-200-skew": (p_scan_200_skew, "jpg", "200 dpi grey, 2-3 degree skew, blur, uneven light."),
    "photocopy-300-bw": (p_photocopy, "png", "Photocopy scanned bilevel at 300 dpi, toner specks."),
    "fax-fine": (p_fax_fine, "png", "G3 fax fine mode, 204x196 dpi bilevel, line noise."),
    "fax-standard": (p_fax_standard, "png", "G3 fax standard mode, 204x98 dpi bilevel, line noise."),
}


def save(img: Image.Image, dpi: int, ext: str, base: Path):
    base.parent.mkdir(parents=True, exist_ok=True)
    img_path = base.with_suffix("." + ext)
    if ext == "jpg":
        img.save(img_path, quality=60, dpi=(dpi, dpi))
    else:
        img.save(img_path, optimize=True, dpi=(dpi, dpi))
    # An image-only PDF, like a scanner or a fax-to-mail service makes.
    # Reopening the file lets Pillow embed the JPEG as is (DCTDecode), and a
    # bilevel image goes in as CCITT G4, as a fax-to-PDF service would store it.
    with Image.open(img_path) as saved:
        saved.save(base.with_suffix(".pdf"), resolution=dpi, title=base.stem)
    return img_path


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", nargs="*", help="source names (without .json)")
    ap.add_argument("--profiles", nargs="*", choices=list(PROFILES), help="profiles to render")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    sources = sorted(SOURCES.glob("*.json"))
    if args.only:
        sources = [s for s in sources if s.stem in args.only]
    profiles = args.profiles or list(PROFILES)

    manifest_path = args.out / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"samples": {}}
    manifest["profiles"] = {k: v[2] for k, v in PROFILES.items()}
    for src in sources:
        doc = json.loads(src.read_text(encoding="utf-8"))
        clean, gt = (render_vertical if doc.get("vertical") else render_horizontal)(doc)
        gt_path = args.out / f"{src.stem}.gt.txt"
        gt_path.parent.mkdir(parents=True, exist_ok=True)
        gt_path.write_text("\n".join(gt) + "\n", encoding="utf-8")
        entry = manifest["samples"].setdefault(src.stem, {"images": {}})
        entry.update(
            lang=doc["lang"],
            title=doc["title"],
            vertical=bool(doc.get("vertical")),
            ground_truth=gt_path.relative_to(args.out).as_posix(),
        )
        for name in profiles:
            fn, ext, _ = PROFILES[name]
            img, dpi, _ = fn(clean, rng_for(src.stem, name))
            path = save(img, dpi, ext, args.out / name / src.stem)
            entry["images"][name] = {"image": path.relative_to(args.out).as_posix(), "dpi": dpi}
            print(f"{path.relative_to(ROOT)}  {img.width}x{img.height}")
    manifest["samples"] = dict(sorted(manifest["samples"].items()))
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
