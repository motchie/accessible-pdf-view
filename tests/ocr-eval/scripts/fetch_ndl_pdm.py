#!/usr/bin/env python3
"""Fetch a sample of the National Diet Library's public-domain OCR dataset
(パブリックドメインOCR学習用データセット, 令和3年度OCR処理プログラム研究開発事業分):
real scans of Japanese books printed 1870-1960, with the text of every line
typed in by hand. Vertical writing, old typefaces, furigana and foxing make it
far harder than a modern office scan, so read its scores as a lower bound.

    python3 -I tests/ocr-eval/scripts/fetch_ndl_pdm.py                       # 2 books per decade, 2 pages each
    python3 -I tests/ocr-eval/scripts/fetch_ndl_pdm.py --decades 1950 1960 --books 5 --pages 3

The archive is 4.8 GB. This reads only the members it needs with HTTP range
requests, so a default run transfers some tens of megabytes. Writes
tests/ocr-eval/external/ndl-pdm/ (git-ignored).

Licence: Public Domain Mark 1.0. NDL asks (not as a legal condition) that
users say when they have edited the data, keep the note that it is freely
reusable, and respect the original works.
https://github.com/ndl-lab/pdmocrdataset-part2
"""

from __future__ import annotations

import argparse
import random
import sys
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from pathlib import Path, PurePosixPath

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _dataset import EXTERNAL, HttpRangeFile, write_manifest  # noqa: E402

URL = "https://lab.ndl.go.jp/dataset/pdm_ocr_dataset/morpho/ndlocr_xml.zip"
DECADES = [str(d) for d in range(1870, 1970, 10)]


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def pages_from_xml(data: bytes):
    """Yield (image name, lines, vertical?) for each PAGE. Lines keep the order
    of the XML; characters NDL could not read or encode (〓) are dropped."""
    root = ET.fromstring(data)
    for page in root.iter():
        if local(page.tag) != "PAGE":
            continue
        lines, vertical = [], 0
        for line in page.iter():
            if local(line.tag) != "LINE":
                continue
            s = (line.get("STRING") or "").replace("〓", "")
            if not s.strip():
                continue
            lines.append(s)
            if line.get("DIRECTION") == "縦":
                vertical += 1
        yield page.get("IMAGENAME"), lines, vertical > len(lines) / 2


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--decades", nargs="*", default=DECADES, choices=DECADES)
    ap.add_argument("--books", type=int, default=2, help="books per decade")
    ap.add_argument("--pages", type=int, default=2, help="pages per book")
    ap.add_argument("--seed", type=int, default=78, help="which books are picked")
    ap.add_argument("--url", default=URL)
    args = ap.parse_args()

    out = EXTERNAL / "ndl-pdm"
    remote = HttpRangeFile(args.url)
    z = zipfile.ZipFile(remote)
    # <root>/<decade>/<book id>/xml/<book id>.xml and .../img/<page>.jpg
    books: dict[str, dict[str, dict]] = defaultdict(dict)
    for info in z.infolist():
        parts = PurePosixPath(info.filename).parts
        if len(parts) < 4 or info.is_dir():
            continue
        decade, book = parts[-4], parts[-3]
        if decade not in args.decades:
            continue
        entry = books[decade].setdefault(book, {"xml": None, "img": {}})
        if parts[-2] == "xml" and parts[-1].endswith(".xml"):
            entry["xml"] = info
        elif parts[-2] == "img":
            entry["img"][parts[-1]] = info

    rng = random.Random(args.seed)
    samples = {}
    for decade in sorted(books):
        ids = sorted(b for b, e in books[decade].items() if e["xml"])
        for book in rng.sample(ids, min(args.books, len(ids))):
            entry = books[decade][book]
            pages = [p for p in pages_from_xml(z.read(entry["xml"])) if p[0] in entry["img"] and len(p[1]) >= 3]
            for name, lines, vertical in rng.sample(pages, min(args.pages, len(pages))):
                sid = f"{decade}-{book}-{Path(name).stem}"
                img = out / decade / book / name
                gt = img.with_suffix(".gt.txt")
                img.parent.mkdir(parents=True, exist_ok=True)
                img.write_bytes(z.read(entry["img"][name]))
                gt.write_text("\n".join(lines) + "\n", encoding="utf-8")
                samples[sid] = {
                    "lang": "ja",
                    "vertical": vertical,
                    "title": f"NDL PD book {book} ({decade}s), {name}",
                    "ground_truth": gt.relative_to(out).as_posix(),
                    "images": {"ndl-scan": {"image": img.relative_to(out).as_posix()}},
                }
                print(f"{sid}: {len(lines)} lines{' (vertical)' if vertical else ''}", file=sys.stderr)
    print(f"transferred {remote.fetched / 1e6:.1f} MB of {remote.size / 1e9:.1f} GB", file=sys.stderr)
    write_manifest(
        out,
        samples,
        source=f"{args.url} (NDL, pdmocrdataset-part2). Edited: pages sampled, unreadable 〓 characters removed from the text.",
        license="Public Domain Mark 1.0 (https://creativecommons.org/publicdomain/mark/1.0/). Freely reusable.",
        profile_note={"ndl-scan": "Real scans of public-domain Japanese books, 1870-1960 (NDL Digital Collections)."},
    )


if __name__ == "__main__":
    main()
