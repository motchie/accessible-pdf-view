"""Shared helpers for the fetch_*.py scripts: downloads, an HTTP file that
zipfile can read in place, and the manifest that evaluate.mjs reads.

Downloaded data goes under tests/ocr-eval/external/, which git ignores: these
datasets are not ours to redistribute, or are too large to commit.
"""

from __future__ import annotations

import io
import json
import shutil
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXTERNAL = ROOT / "external"
USER_AGENT = "accessible-pdf-view-ocr-eval/1.0"


def download(url: str, dest: Path) -> Path:
    """Download url to dest unless it is already there."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    print(f"downloading {url}", file=sys.stderr)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)
    tmp.rename(dest)
    return dest


class HttpRangeFile(io.RawIOBase):
    """A read-only, seekable file backed by HTTP Range requests, so zipfile can
    pull a few members out of a multi-gigabyte archive without downloading it."""

    def __init__(self, url: str, block: int = 1 << 20):
        self.url = url
        self.pos = 0
        self.block = block
        self.cache: dict[int, bytes] = {}
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req) as r:
            self.size = int(r.headers["Content-Length"])
            if r.headers.get("Accept-Ranges", "").lower() != "bytes":
                print("warning: server does not advertise byte ranges", file=sys.stderr)
        self.fetched = 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=io.SEEK_SET):
        if whence == io.SEEK_SET:
            self.pos = offset
        elif whence == io.SEEK_CUR:
            self.pos += offset
        else:
            self.pos = self.size + offset
        return self.pos

    def _block(self, i: int) -> bytes:
        if i not in self.cache:
            start = i * self.block
            end = min(start + self.block, self.size) - 1
            req = urllib.request.Request(self.url, headers={"User-Agent": USER_AGENT, "Range": f"bytes={start}-{end}"})
            with urllib.request.urlopen(req) as r:
                if r.status != 206:
                    raise IOError(f"expected 206 Partial Content, got {r.status}")
                data = r.read()
            self.fetched += len(data)
            if len(self.cache) > 64:
                self.cache.pop(next(iter(self.cache)))
            self.cache[i] = data
        return self.cache[i]

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        n = max(0, min(n, self.size - self.pos))
        out = bytearray()
        while n > 0:
            i, off = divmod(self.pos, self.block)
            chunk = self._block(i)[off : off + n]
            out += chunk
            self.pos += len(chunk)
            n -= len(chunk)
        return bytes(out)

    def readinto(self, b):
        data = self.read(len(b))
        b[: len(data)] = data
        return len(data)


def write_manifest(out: Path, samples: dict, *, source: str, license: str, profile_note: dict):
    """Write the manifest.json that evaluate.mjs reads."""
    manifest = {
        "source": source,
        "license": license,
        "profiles": profile_note,
        "samples": dict(sorted(samples.items())),
    }
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out / 'manifest.json'} ({len(samples)} samples)", file=sys.stderr)
