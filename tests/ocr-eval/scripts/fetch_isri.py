#!/usr/bin/env python3
"""Fetch the UNLV-ISRI OCR test sets: real English documents from the early
1990s (business letters, Department of Energy reports, magazines, newspapers),
scanned at 300 dpi bilevel, with hand-checked ground-truth text. These are the
sets Tesseract has long been measured on.

    python3 -I tests/ocr-eval/scripts/fetch_isri.py                 # bus.3B, 20 pages
    python3 -I tests/ocr-eval/scripts/fetch_isri.py --sets bus doe3 --limit 0   # every page

Writes tests/ocr-eval/external/isri/ (git-ignored). Needs Pillow to turn the
Group 4 TIFFs into PNGs that tesseract.js reads.

Licence: the data was published by the Information Science Research Institute
(UNLV) for OCR evaluation and is mirrored by the Tesseract project; no
licence is stated. Do not commit it to this repository.
"""

from __future__ import annotations

import argparse
import io
import sys
import tarfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _dataset import EXTERNAL, download, write_manifest  # noqa: E402

BASE = "https://sourceforge.net/projects/isri-ocr-evaluation-tools-alt/files"
SETS = {
    "bus": "business letters and reports",
    "doe3": "Department of Energy technical reports",
    "mag": "magazine articles",
    "news": "newspaper articles",
}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sets", nargs="*", default=["bus"], choices=list(SETS))
    ap.add_argument("--limit", type=int, default=20, help="pages per set; 0 for all")
    args = ap.parse_args()

    from PIL import Image

    out = EXTERNAL / "isri"
    samples = {}
    for name in args.sets:
        tgz = download(f"{BASE}/{name}.3B.tar.gz", out / "downloads" / f"{name}.3B.tar.gz")
        with tarfile.open(tgz) as tar:
            members = {m.name: m for m in tar.getmembers() if m.isfile()}
            tifs = sorted(n for n in members if n.endswith(".3B.tif"))
            if args.limit:
                # Spread the pages over the set rather than taking the first few.
                step = max(1, len(tifs) // args.limit)
                tifs = tifs[::step][: args.limit]
            for tif in tifs:
                txt = tif[: -len(".tif")] + ".txt"
                if txt not in members:
                    continue
                stem = Path(tif).name[: -len(".3B.tif")]
                sid = f"{name}-{stem}"
                png = out / name / f"{stem}.png"
                gt = out / name / f"{stem}.gt.txt"
                png.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(members[tif]) as f:
                    Image.open(io.BytesIO(f.read())).save(png, optimize=True)
                with tar.extractfile(members[txt]) as f:
                    gt.write_text(f.read().decode("latin-1"), encoding="utf-8")
                samples[sid] = {
                    "lang": "en",
                    "vertical": False,
                    "title": f"{SETS[name]}, {stem}",
                    "ground_truth": gt.relative_to(out).as_posix(),
                    "images": {"scan-300-bw": {"image": png.relative_to(out).as_posix(), "dpi": 300}},
                }
    write_manifest(
        out,
        samples,
        source=f"{BASE} (UNLV-ISRI OCR test data, 3B = 300 dpi bilevel)",
        license="No licence stated; for evaluation only, do not redistribute.",
        profile_note={"scan-300-bw": "Real 300 dpi bilevel scans (Group 4 TIFF converted to PNG)."},
    )


if __name__ == "__main__":
    main()
