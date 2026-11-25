#!/usr/bin/env python3
"""Fetch FUNSD: 199 real English forms from the 1980s-90s, scanned or faxed at
around 100 dpi, noisy, with every word's text annotated. The closest public
match to "a fax of a form" there is, although only in English.

    python3 -I tests/ocr-eval/scripts/fetch_funsd.py             # the 50 test forms
    python3 -I tests/ocr-eval/scripts/fetch_funsd.py --split all

Writes tests/ocr-eval/external/funsd/ (git-ignored).

Licence: the authors release FUNSD for non-commercial research and education.
It is drawn from RVL-CDIP, itself from the Truth Tobacco Industry Documents.
Use it to measure, never commit it, and check the terms at
https://guillaumejaume.github.io/FUNSD/ before any other use.

Ground truth: the form's annotated fields, one per line, sorted top to bottom
and then left to right. Forms have no single reading order, so expect CER to
be pessimistic and look at bag-recall too.
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path, PurePosixPath

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _dataset import EXTERNAL, download, write_manifest  # noqa: E402

URL = "https://guillaumejaume.github.io/FUNSD/dataset.zip"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--split", choices=["testing", "training", "all"], default="testing")
    ap.add_argument("--url", default=URL)
    args = ap.parse_args()

    out = EXTERNAL / "funsd"
    zpath = download(args.url, out / "downloads" / "dataset.zip")
    splits = ["testing", "training"] if args.split == "all" else [args.split]
    samples = {}
    with zipfile.ZipFile(zpath) as z:
        names = z.namelist()
        for split in splits:
            for ann in sorted(n for n in names if f"{split}_data/annotations/" in n and n.endswith(".json")):
                stem = PurePosixPath(ann).stem
                img_name = ann.replace("/annotations/", "/images/")[: -len(".json")] + ".png"
                if img_name not in names:
                    continue
                form = json.loads(z.read(ann))["form"]
                fields = [f for f in form if f.get("text", "").strip()]
                # box is [x0, y0, x1, y1]; group into rows by the top edge.
                fields.sort(key=lambda f: (round(f["box"][1] / 15), f["box"][0]))
                img = out / split / f"{stem}.png"
                gt = img.with_suffix(".gt.txt")
                img.parent.mkdir(parents=True, exist_ok=True)
                img.write_bytes(z.read(img_name))
                gt.write_text("\n".join(f["text"].strip() for f in fields) + "\n", encoding="utf-8")
                samples[f"{split}-{stem}"] = {
                    "lang": "en",
                    "vertical": False,
                    "title": f"FUNSD {split} form {stem}",
                    "ground_truth": gt.relative_to(out).as_posix(),
                    "images": {"funsd-scan": {"image": img.relative_to(out).as_posix()}},
                }
    write_manifest(
        out,
        samples,
        source=f"{args.url} (FUNSD, Jaume et al. 2019, arXiv:1905.13538)",
        license="Non-commercial research and education only; do not redistribute.",
        profile_note={"funsd-scan": "Real noisy form scans and faxes, about 100 dpi."},
    )


if __name__ == "__main__":
    main()
