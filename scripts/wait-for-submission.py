#!/usr/bin/env python3
"""
Block until the intake form writes raw_submission.json.

Used in live mode so the assistant does not end the turn waiting for the user
to say they clicked Submit.

Usage:
  python scripts/wait-for-submission.py RUNTIME_DIR [--timeout 600]
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Wait for intake raw_submission.json")
    parser.add_argument("out_dir", type=Path)
    parser.add_argument("--timeout", type=int, default=600, help="Seconds to wait (default 600)")
    parser.add_argument("--interval", type=float, default=2.0)
    args = parser.parse_args()

    out_dir = args.out_dir.resolve()
    target = out_dir / "raw_submission.json"
    signal = out_dir / "RAW_SUBMISSION_READY"
    deadline = time.monotonic() + max(1, args.timeout)

    while time.monotonic() < deadline:
        if target.is_file() or signal.is_file():
            path = target if target.is_file() else signal
            print(f"ready {path}")
            return 0
        time.sleep(max(0.2, args.interval))

    print(f"timeout waiting for {target}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
