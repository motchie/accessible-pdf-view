# OCR evaluation data

Data and scripts to measure OCR accuracy on scanned and faxed PDFs, for the
decision in #78 to bundle Tesseract (WASM). Nobody on the project has a fax
machine or a scanner at hand, so the set is built in three layers:

1. **Synthetic pages, committed here.** Documents written for this project,
   rendered and then degraded to look scanned, photocopied or faxed. The
   ground truth is exact because the text is ours.
2. **Public datasets with ground truth, fetched by script.** Real scans. They
   are not committed: some are not ours to redistribute, and all are large.
3. **Your own scans.** Print a synthetic page, scan it at a convenience-store
   copier, send it through an internet fax service or photograph it, and score
   the result against the same ground truth.

## Quick start

```sh
npm install --no-save tesseract.js
python3 -I tests/ocr-eval/scripts/fetch_tessdata.py        # models into .cache/
node tests/ocr-eval/scripts/evaluate.mjs --lang-path tests/ocr-eval/.cache/tessdata_fast --psm 3
```

`evaluate.mjs` prints a Markdown table of character error rate (CER) per
sample and profile. Its options are listed at the top of the file:
`--profiles`, `--only`, `--psm`, `--json`, `--lang-path`, and a dataset
directory as the first argument (default: `synthetic/`).

Without `--lang-path`, tesseract.js fetches its default models from a CDN.

## 1. Synthetic pages (`synthetic/`)

`scripts/make_synthetic.py` renders each `sources/*.json` on an A4 page at
300 dpi with Noto Sans/Serif JP (downloaded once, pinned to a commit) and
writes six versions of it. Each version is a PNG or JPEG and an image-only PDF
of that image, which is what a scanner or a fax-to-mail service produces, so
the PDFs can be opened in the extension as they are.

| profile | what it imitates | file |
|---|---|---|
| `clean-300` | the rendered page, no degradation (upper bound) | PNG |
| `scan-300-gray` | flatbed scan, 300 dpi grey, ±1.2° skew, paper tone, JPEG | JPEG |
| `scan-200-skew` | cheap scanner or scan-to-mail, 200 dpi, 2–3° skew, blur, uneven light | JPEG |
| `photocopy-300-bw` | a copy of a copy, bilevel, thick strokes, toner specks, dark edge | PNG, CCITT G4 in the PDF |
| `fax-fine` | G3 fax, fine mode, 204×196 dpi bilevel, lost and smeared lines, a streak | PNG, CCITT G4 in the PDF |
| `fax-standard` | G3 fax, standard mode, 204×98 dpi | PNG, CCITT G4 in the PDF |

| source | content |
|---|---|
| `ja-fax-cover` | FAX送付状: a ruled key–value form, phone numbers, 8pt note |
| `ja-notice` | お知らせ文書 in Mincho, numbered list, dates, full-width brackets |
| `ja-invoice` | 請求書: a ruled table with right-aligned amounts in yen |
| `ja-vertical` | 縦書き, the preamble of the Constitution of Japan (not copyrightable, 著作権法第13条) |
| `mixed-tech` | Japanese with English terms, a URL, an e-mail address, a table, 0/O and 1/l/I |
| `en-fax-cover` | fax cover sheet, 7.5pt confidentiality notice |
| `en-letter` | business letter in a serif face |
| `en-invoice` | invoice with a ruled table |
| `en-declaration` | the Declaration of Independence, excerpt (public domain) |

Every name, company, number and address in the sources is made up.
`synthetic/<source>.gt.txt` is the ground truth: one line per heading,
paragraph, form row or table row, tables read row by row.

Regenerate with `pip install pillow numpy` and
`python3 tests/ocr-eval/scripts/make_synthetic.py`. The output is
deterministic: the noise is seeded from the sample and profile names. To add a
document, add a JSON file to `sources/` (blocks: `h`, `p`, `right`, `kv`,
`table`, `space`; `"vertical": true` for 縦書き) and rerun.

Licence: the sources and the generated images are part of this repository
(MIT). The two quoted texts are in the public domain. The fonts are under the
SIL Open Font License and are not committed.

## 2. Public datasets (`external/`, git-ignored)

Each `scripts/fetch_*.py` downloads a dataset and writes the same
`manifest.json` shape the synthetic set uses, so `evaluate.mjs` runs on it
unchanged: `node tests/ocr-eval/scripts/evaluate.mjs tests/ocr-eval/external/<name>`.
The scripts use only the Python standard library, plus Pillow for ISRI.

| script | data | language | ground truth | licence | committed? |
|---|---|---|---|---|---|
| `fetch_ndl_pdm.py` | NDL パブリックドメインOCR学習用データセット (part 2): real scans of Japanese books printed 1870–1960, mostly 縦書き | ja | every line typed by hand | Public Domain Mark 1.0 | no (4.8 GB archive; the script reads only the pages it samples, with HTTP range requests) |
| `fetch_isri.py` | UNLV-ISRI test sets: business letters, DOE reports, magazines, newspapers, 300 dpi bilevel | en | hand-checked page text | none stated; evaluation use | no |
| `fetch_funsd.py` | FUNSD: 199 noisy scanned and faxed forms at about 100 dpi | en | every word annotated | non-commercial research only | no |

Notes from the survey:

- **No public dataset of Japanese faxes or modern Japanese office scans with
  ground truth was found.** The NDL set is the best real Japanese source, but
  it is old print (旧字体 normalised, furigana, foxing, 縦書き), so read its
  scores as a lower bound. That gap is why the synthetic Japanese pages exist.
- NDL's part 1 (令和3年度OCRテキスト化事業分, also Public Domain Mark) keeps
  old and variant character forms as printed, so it would score Tesseract
  against characters it never outputs; part 2 is used instead.
  `lab.ndl.go.jp` was not reachable from the environment the scripts were
  written in: `fetch_ndl_pdm.py` was tested against a local server with the
  same archive layout, not against NDL itself.
- RVL-CDIP and IIT-CDIP (the tobacco-documents corpora FUNSD is drawn from)
  have no ground-truth text, only labels or noisy OCR, so they are not used.
- Since the NDL data is in the public domain, a small sample of it could be
  committed later, with NDL's requested note that it was edited.

## 3. Your own scans (`local/`, git-ignored)

Put images in `tests/ocr-eval/local/` and run
`node tests/ocr-eval/scripts/evaluate.mjs tests/ocr-eval/local`. An image is
scored against `<name>.gt.txt` beside it, or, if its name starts with a
synthetic sample's name (`ja-invoice-konbini.jpg`, `en-letter_phone.png`),
against that sample's ground truth. Ways to get real degradation without a
fax or a scanner:

- Print `synthetic/clean-300/*.pdf` and scan it on a convenience-store
  multifunction copier (scan to PDF or JPEG on a USB stick or phone).
- Send the PDF through an internet fax service to itself, or to a fax-to-mail
  number, which returns the received fax as PDF or TIFF.
- Photograph the printout with a phone. This is not a scan, but it is how
  many people will meet the extension's OCR.

Extract the image from a PDF first (for example `pdfimages -png`); the script
reads images, not PDFs.

## Metrics

All text is NFKC-normalised and whitespace is removed before comparing.

- **CER**: edit distance divided by the ground truth's length. Can exceed
  100% when the output is mostly wrong characters.
- **bag-recall**: the share of ground-truth characters found anywhere in the
  output, ignoring order. A high CER with a good bag-recall means the text was
  read but the reading order (tables, columns, form fields) differs.
- **WER**: word error rate, English only, in the JSON output.

## Baseline

Measured on 2026-11-25 with tesseract.js 7.0.0 in Node 22, `oem 1` (LSTM).
Mean CER over the nine synthetic sources (bag-recall in brackets). `psm 6` is
tesseract.js's default (a single uniform block of text); `psm 3` is
Tesseract's automatic page segmentation.

| models, psm | clean-300 | scan-300-gray | scan-200-skew | photocopy-300-bw | fax-fine | fax-standard |
|---|---:|---:|---:|---:|---:|---:|
| tessdata_fast, 6 | 24.4% (78.1%) | 26.2% (78.8%) | 26.7% (75.2%) | 23.6% (82.9%) | 22.4% (82.9%) | 34.4% (76.0%) |
| tessdata_fast, 3 | 7.6% (96.8%) | 2.9% (99.0%) | 28.5% (73.9%) | 1.8% (98.6%) | 5.5% (97.5%) | 27.0% (78.6%) |
| tessdata, 6 | 20.9% (81.4%) | 27.0% (79.2%) | 22.9% (79.2%) | 20.7% (83.2%) | 21.2% (83.0%) | 27.9% (82.7%) |
| tessdata, 3 | 2.8% (99.2%) | 2.9% (99.2%) | 30.0% (72.0%) | 1.4% (98.8%) | 3.8% (98.6%) | 12.7% (92.6%) |

`ja-vertical` alone with `jpn_vert` and `psm 5` (a vertical block):

| models | clean-300 | scan-300-gray | scan-200-skew | photocopy-300-bw | fax-fine | fax-standard |
|---|---:|---:|---:|---:|---:|---:|
| tessdata_fast | 1.1% | 2.3% | 45.2% | 2.3% | 3.8% | 10.7% |
| tessdata | 1.9% | 1.1% | 3.4% | 3.1% | 6.9% | 10.3% |

Real scans, ISRI `bus.3B` (10 English business pages, 300 dpi bilevel): mean
CER 3.7% at `psm 3` and 2.4–2.5% at `psm 6`, with either model set. The
synthetic `photocopy-300-bw` and `fax-fine` English pages land in the same
range, which suggests the degradation is not unrealistically mild.

What this says so far:

- **The page segmentation mode matters more than the model.** With
  tesseract.js's default `psm 6`, ruled tables lose about half their text
  (bag-recall 53–59% on the invoices) and vertical Japanese comes out as
  noise. `psm 3` reads the tables, and vertical text needs `jpn_vert` with
  `psm 5` or `psm 3`.
- **`psm 3` sometimes returns nothing on a skewed page.** At 200 dpi with a
  2–3° skew it returned empty or half-empty text for `en-declaration` and
  `en-letter`, where `psm 6` read them almost perfectly. Deskewing first, or
  falling back to `psm 6` when `psm 3` finds little, looks necessary.
- **Japanese needs the larger models more than English does.** On the
  Japanese faxes in standard mode (204×98 dpi), `tessdata` is markedly better
  than `tessdata_fast` (mean CER over all sources 12.7% against 27.0%). On
  English the two are close.
- **Standard-mode faxes of small Japanese text are the hard case**
  (`ja-notice` 31% CER even with `tessdata`). Fine-mode faxes and photocopies
  are read well.

Full per-sample tables: `results/2026-11-25/`.

These are first numbers from nine synthetic pages and ten real ones. Before
choosing models, add real Japanese scans (NDL, your own) and rerun.
