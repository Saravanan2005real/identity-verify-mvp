"""
Data Retention Management for AI OCR Engine.
Independent of ML libraries (PyTorch, TensorFlow, OpenCV, PaddleOCR) for fast CLI execution.
"""
import os
import time
import logging

logger = logging.getLogger(__name__)


def cleanup_expired_assets(retention_hours: int = None, upload_folder: str = None) -> int:
    """
    Retention Policy Procedure:
    Purges temporary verification images, face crops, and debug files older than RETENTION_HOURS (default: 24h).
    Returns count of removed files.
    """
    if retention_hours is None:
        try:
            retention_hours = int(os.getenv("RETENTION_HOURS", "24"))
        except (ValueError, TypeError):
            retention_hours = 24

    upload_dir = upload_folder or os.getenv("UPLOAD_FOLDER") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "ocr_uploads")
    if not upload_dir or not os.path.exists(upload_dir):
        return 0

    now = time.time()
    cutoff = now - (retention_hours * 3600)
    removed_count = 0

    try:
        for fname in os.listdir(upload_dir):
            fpath = os.path.join(upload_dir, fname)
            if not os.path.isfile(fpath):
                continue
            # Check modification time
            try:
                mtime = os.path.getmtime(fpath)
                if mtime < cutoff:
                    os.remove(fpath)
                    removed_count += 1
            except Exception as del_err:
                logger.warning(f"[Cleanup Error on {fname}]: {del_err}")
    except Exception as scan_err:
        logger.warning(f"[Cleanup Scan Error]: {scan_err}")

    return removed_count

