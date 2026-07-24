#!/usr/bin/env python3
"""Decode split base64 artifacts safely and verify the exact SHA-256."""
from __future__ import annotations

import base64
import glob
import hashlib
import re
import sys
from pathlib import Path


def clean(value: bytes) -> bytes:
    return re.sub(rb"\s+", b"", value)


def decode_strict(value: bytes) -> bytes:
    return base64.b64decode(clean(value), validate=True)


def main() -> int:
    if len(sys.argv) != 4:
        raise SystemExit("usage: decode_parts.py '<glob>' OUTPUT EXPECTED_SHA256")
    pattern, output_name, expected = sys.argv[1:]
    paths = [Path(path) for path in sorted(glob.glob(pattern))]
    if not paths:
        raise SystemExit(f"no parts matched: {pattern}")
    parts = [path.read_bytes() for path in paths]
    candidates: list[tuple[str, bytes]] = []

    try:
        candidates.append(("joined-base64-stream", decode_strict(b"".join(parts))))
    except Exception:
        pass

    try:
        candidates.append(("individually-encoded-parts", b"".join(decode_strict(part) for part in parts)))
    except Exception:
        pass

    for method, payload in candidates:
        digest = hashlib.sha256(payload).hexdigest()
        if digest == expected.lower():
            Path(output_name).write_bytes(payload)
            print(f"{output_name}: OK ({method}, {len(paths)} delar, {len(payload)} byte)")
            return 0

    details = ", ".join(f"{method}={hashlib.sha256(payload).hexdigest()}" for method, payload in candidates)
    raise SystemExit(f"no decoded candidate matched {expected}; {details or 'all decoding attempts failed'}")


if __name__ == "__main__":
    raise SystemExit(main())
