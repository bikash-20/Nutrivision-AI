"""Tesseract OCR wrapper — optional fallback for the vision stub.

Disabled by default. Activate via the `OCR_ENABLED=true` env var;
the system also needs `pytesseract` (pip) AND the Tesseract binary on
the host (`brew install tesseract` on macOS, `apt install tesseract-ocr`
on Debian). When any of those are missing, every function in this
module degrades gracefully to a no-op rather than crashing the route.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

log = logging.getLogger(__name__)

_ENABLED = os.environ.get("OCR_ENABLED", "").lower() in {"1", "true", "yes"}
_pytesseract = None
if _ENABLED:
    try:
        import pytesseract  # type: ignore[import-not-found]
        _pytesseract = pytesseract
    except ImportError:
        log.warning("OCR_ENABLED=true but pytesseract not installed; OCR disabled.")
        _pytesseract = None


def is_enabled() -> bool:
    """True iff the OCR backend is wired and ready to use."""
    return _pytesseract is not None


def extract_text(image_ref: str) -> str:
    """Run Tesseract on a local image path. Returns "" on any failure
    or when OCR is disabled — never raises.

    `image_ref` is treated as a filesystem path. Callers should ensure
    it points inside a trusted directory (e.g. an uploads/ folder).
    """
    if not is_enabled():
        return ""
    path = Path(image_ref)
    if not path.is_file():
        return ""
    try:
        return _pytesseract.image_to_string(path) or ""
    except Exception as exc:  # noqa: BLE001 — Tesseract errors are noisy
        log.warning("OCR failed for %r: %s", image_ref, exc)
        return ""
