#!/usr/bin/env python3
"""
CLI Script to clean up files in UPLOAD_FOLDER older than RETENTION_HOURS (default: 24h).
"""
import argparse
import os
import sys

# Ensure products/ocr_engine directory is on sys.path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from retention import cleanup_expired_assets


def main():
    parser = argparse.ArgumentParser(description="Purge expired assets from UPLOAD_FOLDER.")
    parser.add_argument(
        "--retention-hours",
        type=int,
        default=None,
        help="Retention period in hours (default: RETENTION_HOURS env var or 24)",
    )
    parser.add_argument(
        "--upload-folder",
        type=str,
        default=None,
        help="Directory to clean (default: UPLOAD_FOLDER config or env)",
    )
    args = parser.parse_args()

    count = cleanup_expired_assets(
        retention_hours=args.retention_hours, upload_folder=args.upload_folder
    )
    print(f"Purged {count} file(s) older than retention cutoff.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

