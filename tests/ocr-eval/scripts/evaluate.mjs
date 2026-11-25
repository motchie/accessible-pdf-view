#!/usr/bin/env node
// Run Tesseract (tesseract.js, the WASM build the extension will bundle) over
// a dataset and score it against the ground truth.
//
//   npm install --no-save tesseract.js
//   node tests/ocr-eval/scripts/evaluate.mjs                          # the synthetic set
//   node tests/ocr-eval/scripts/evaluate.mjs tests/ocr-eval/external/ndl-pdm
//   node tests/ocr-eval/scripts/evaluate.mjs --profiles fax-fine fax-standard --only ja-invoice
//   node tests/ocr-eval/scripts/evaluate.mjs --psm 6 --json results.json
//   node tests/ocr-eval/scripts/evaluate.mjs tests/ocr-eval/local      # your own scans, see loadManifest
//   node tests/ocr-eval/scripts/evaluate.mjs --lang-path tests/ocr-eval/.cache/tessdata_fast
//
// A dataset is a directory with a manifest.json:
//   { "samples": { "<id>": { "lang": "ja" | "en" | "ja+en", "vertical": bool,
//       "ground_truth": "<path>", "images": { "<profile>": { "image": "<path>" } } } } }
// make_synthetic.py and the fetch_*.py scripts all write this shape.
//
// Scores, all after Unicode NFKC normalisation:
//   CER        character error rate: edit distance / ground-truth length, with
//              all whitespace removed (Japanese has no spaces to count, and
//              Tesseract adds spaces between kanji).
//   bag-recall share of ground-truth characters found anywhere in the output,
//              ignoring order. When CER is high but this is good, the
//              characters were read and the reading order (tables, columns)
//              is what went wrong.
//   WER        word error rate, English only.

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { dir: path.join(here, "..", "synthetic"), profiles: null, only: null, psm: null, json: null, langPath: null };
  let list = null;
  for (const a of argv) {
    if (a === "--profiles" || a === "--only") { list = a.slice(2); opts[list] = []; continue; }
    if (a === "--psm" || a === "--json" || a === "--lang-path") { list = a; continue; }
    if (list === "--psm") { opts.psm = a; list = null; continue; }
    if (list === "--json") { opts.json = a; list = null; continue; }
    if (list === "--lang-path") { opts.langPath = a; list = null; continue; }
    if (list) { opts[list].push(a); continue; }
    opts.dir = a;
  }
  return opts;
}

export function normalize(s) {
  return s.normalize("NFKC").replace(/\s+/gu, "");
}

export function levenshtein(a, b) {
  const A = [...a], B = [...b];
  let prev = Array.from({ length: B.length + 1 }, (_, i) => i);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[B.length];
}

export function bagRecall(gt, out) {
  const counts = new Map();
  for (const c of out) counts.set(c, (counts.get(c) ?? 0) + 1);
  let hit = 0;
  const g = [...gt];
  for (const c of g) {
    const n = counts.get(c) ?? 0;
    if (n > 0) { hit++; counts.set(c, n - 1); }
  }
  return g.length ? hit / g.length : 1;
}

function words(s) {
  return s.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}$%.,'/-]+/u).filter(Boolean);
}

function wer(gt, out) {
  const g = words(gt), o = words(out);
  // Levenshtein over word arrays.
  let prev = Array.from({ length: o.length + 1 }, (_, i) => i);
  for (let i = 1; i <= g.length; i++) {
    const cur = [i];
    for (let j = 1; j <= o.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (g[i - 1] === o[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return g.length ? prev[o.length] / g.length : 0;
}

const IMAGE = /\.(png|jpe?g|tiff?|webp|bmp)$/i;

// A directory without a manifest.json: your own scans or photos. Each image
// is scored against <name>.gt.txt beside it or, when its name starts with a
// synthetic sample's name (ja-invoice-konbini.jpg), against that sample's
// ground truth. So you can print synthetic/clean-300/*.pdf, scan or fax the
// paper, drop the results in tests/ocr-eval/local/ and run this on it.
async function loadManifest(dir) {
  try {
    return JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const synthDir = path.join(here, "..", "synthetic");
  const synth = JSON.parse(await readFile(path.join(synthDir, "manifest.json"), "utf8"));
  const ids = Object.keys(synth.samples).sort((a, b) => b.length - a.length);
  const samples = {};
  for (const name of await readdir(dir)) {
    if (!IMAGE.test(name)) continue;
    const stem = name.replace(IMAGE, "");
    const own = path.join(dir, `${stem}.gt.txt`);
    const match = ids.find((id) => stem === id || stem.startsWith(`${id}-`) || stem.startsWith(`${id}_`));
    let ground_truth, lang = "ja", vertical = false;
    try {
      await readFile(own);
      ground_truth = `${stem}.gt.txt`;
      if (match) ({ lang, vertical } = synth.samples[match]);
    } catch {
      if (!match) { console.error(`skipping ${name}: no ${stem}.gt.txt and no synthetic sample of that name`); continue; }
      ({ lang, vertical } = synth.samples[match]);
      ground_truth = path.relative(dir, path.join(synthDir, synth.samples[match].ground_truth));
    }
    samples[stem] = { lang, vertical, ground_truth, images: { local: { image: name } } };
  }
  return { samples };
}

function tessLang(sample) {
  if (sample.vertical) return "jpn_vert";
  if (sample.lang === "en") return "eng";
  return "jpn+eng";
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let createWorker;
  try {
    ({ createWorker } = await import("tesseract.js"));
  } catch {
    console.error("tesseract.js is not installed. Run: npm install --no-save tesseract.js");
    process.exit(1);
  }
  const manifest = await loadManifest(opts.dir);
  const workers = new Map();
  const getWorker = async (lang) => {
    if (!workers.has(lang)) {
      const w = await createWorker(lang, 1, {
        cacheMethod: "none",
        // A directory of uncompressed .traineddata files, such as a checkout of
        // tesseract-ocr/tessdata_fast. Without it, tesseract.js fetches its
        // default (tessdata "best_int") from a CDN.
        ...(opts.langPath ? { langPath: path.resolve(opts.langPath), gzip: false } : {}),
      });
      if (opts.psm) await w.setParameters({ tessedit_pageseg_mode: opts.psm });
      workers.set(lang, w);
    }
    return workers.get(lang);
  };

  const rows = [];
  for (const [id, sample] of Object.entries(manifest.samples)) {
    if (opts.only && !opts.only.includes(id)) continue;
    const gt = await readFile(path.join(opts.dir, sample.ground_truth), "utf8");
    for (const [profile, { image }] of Object.entries(sample.images)) {
      if (opts.profiles && !opts.profiles.includes(profile)) continue;
      const lang = tessLang(sample);
      const worker = await getWorker(lang);
      const t0 = performance.now();
      const { data } = await worker.recognize(path.join(opts.dir, image));
      const ms = performance.now() - t0;
      const g = normalize(gt), o = normalize(data.text);
      const row = {
        id, profile, lang,
        cer: g.length ? levenshtein(g, o) / g.length : 0,
        bagRecall: bagRecall(g, o),
        wer: sample.lang === "en" ? wer(gt, data.text) : null,
        seconds: ms / 1000,
        text: data.text,
      };
      rows.push(row);
      console.error(`${id} ${profile}: CER ${(row.cer * 100).toFixed(1)}%  bag-recall ${(row.bagRecall * 100).toFixed(1)}%  ${row.seconds.toFixed(1)}s`);
    }
  }
  for (const w of workers.values()) await w.terminate();

  // Markdown summary: CER per sample and profile, then the mean per profile.
  const profiles = [...new Set(rows.map((r) => r.profile))];
  const ids = [...new Set(rows.map((r) => r.id))];
  const pct = (v) => (v == null ? "" : `${(v * 100).toFixed(1)}%`);
  const lines = [];
  lines.push(`CER (lower is better), bag-recall in brackets. Engine: tesseract.js, models: ${opts.langPath ? path.basename(path.resolve(opts.langPath)) : "default"}, psm ${opts.psm ?? "default"}.`, "");
  lines.push(`| sample | ${profiles.join(" | ")} |`);
  lines.push(`|---|${profiles.map(() => "---:").join("|")}|`);
  for (const id of ids) {
    const cells = profiles.map((p) => {
      const r = rows.find((x) => x.id === id && x.profile === p);
      return r ? `${pct(r.cer)} (${pct(r.bagRecall)})` : "";
    });
    lines.push(`| ${id} | ${cells.join(" | ")} |`);
  }
  const mean = (p, k) => {
    const rs = rows.filter((r) => r.profile === p);
    return rs.reduce((s, r) => s + r[k], 0) / rs.length;
  };
  lines.push(`| **mean** | ${profiles.map((p) => `**${pct(mean(p, "cer"))}** (${pct(mean(p, "bagRecall"))})`).join(" | ")} |`);
  console.log(lines.join("\n"));
  if (opts.json) await writeFile(opts.json, JSON.stringify(rows, null, 2) + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
