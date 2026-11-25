#!/usr/bin/env python3
"""Download Tesseract's trained models for English, Japanese and vertical
Japanese into tests/ocr-eval/.cache/<variant>/, for evaluate.mjs --lang-path.

    python3 -I tests/ocr-eval/scripts/fetch_tessdata.py               # fast and tessdata
    python3 -I tests/ocr-eval/scripts/fetch_tessdata.py --variants tessdata_fast

Variants (all Apache-2.0, from github.com/tesseract-ocr):
  tessdata_fast  small integer LSTM models (jpn 2.5 MB): the likely ones to bundle
  tessdata       integer "best" LSTM plus the legacy engine (jpn 36 MB); its
                 LSTM part is what tesseract.js downloads by default (4.0.0_best_int)
tessdata_best (float models) does not run in tesseract.js, so it is not offered.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _dataset import ROOT, download  # noqa: E402

LANGS = ["eng", "jpn", "jpn_vert"]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--variants", nargs="*", default=["tessdata_fast", "tessdata"], choices=["tessdata_fast", "tessdata"])
    args = ap.parse_args()
    for v in args.variants:
        for lang in LANGS:
            download(
                f"https://raw.githubusercontent.com/tesseract-ocr/{v}/main/{lang}.traineddata",
                ROOT / ".cache" / v / f"{lang}.traineddata",
            )
        print(f"--lang-path {(ROOT / '.cache' / v).relative_to(ROOT.parent.parent)}")


if __name__ == "__main__":
    main()
