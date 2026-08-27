#!/usr/bin/env python3
"""
Block until the intake form writes a *new* raw_submission.json.

Used in live mode so the assistant does not end the turn waiting for the user
to say they clicked Submit. Existing files from a prior run are ignored until
their mtime advances (Ask another question / a fresh Start harvest).

Usage:
  python scripts/wait-for-submission.py RUNTIME_DIR [--timeout 600]
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import Optional


def _mtime(path: Path) -> Optional[float]:
    try:
        if path.is_file():
            return path.stat().st_mtime
    except OSError:
        return None
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Wait for intake raw_submission.json")
    parser.add_argument("out_dir", type=Path)
    parser.add_argument("--timeout", type=int, default=600, help="Seconds to wait (default 600)")
    parser.add_argument("--interval", type=float, default=2.0)
    args = parser.parse_args()

    out_dir = args.out_dir.resolve()
    target = out_dir / "raw_submission.json"
    signal = out_dir / "RAW_SUBMISSION_READY"
    prior_target = _mtime(target)
    prior_signal = _mtime(signal)
    deadline = time.monotonic() + max(1, args.timeout)

    while time.monotonic() < deadline:
        now_signal = _mtime(signal)
        now_target = _mtime(target)
        if now_signal is not None and (prior_signal is None or now_signal > prior_signal + 0.05):
            print(f"ready {signal}")
            return 0
        if now_target is not None and (prior_target is None or now_target > prior_target + 0.05):
            print(f"ready {target}")
            return 0
        time.sleep(max(0.2, args.interval))

    print(f"timeout waiting for {target}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
