"""Distinguishable logging for external HTTP failures.

The 5 nutrition/vision clients used to `log.warning(...)` on every error
indistinguishably — a typo in `GEMINI_BASE_URL` looked the same in
production logs as a 30-second transient timeout. This module gives the
clients a single `log_http_failure()` helper that:

  - `WARNING` for transient `httpx.HTTPStatusError` 5xx and connect/
    read/timeout network errors (likely self-healing)
  - `ERROR` with a rate-limit hint for 429 (investigate quota)
  - `ERROR` with a config hint for 401/403 (likely bad/missing key)
  - `ERROR` for any other unexpected exception

Callers: `gemini_client`, `hf_client`, `off_client`, `usda_client`,
`fruityvice_client`.
"""

from __future__ import annotations

import logging

import httpx

_log = logging.getLogger(__name__)


def log_http_failure(provider: str, exc: Exception, *, image_ref: str = "") -> None:
    """Log an external-API failure with severity graded by the error
    class. `provider` is a short label like `"Gemini"` or `"OFF"`."""
    suffix = " during image analysis" if image_ref else ""
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if status == 429:
            _log.error(
                "%s rate-limited (429)%s — back off or check the provider quota.",
                provider,
                suffix,
            )
        elif status in (401, 403):
            _log.error(
                "%s auth failed (%d)%s — check %s_API_KEY/HF_API_TOKEN env var.",
                provider,
                status,
                suffix,
                provider.upper(),
            )
        elif status >= 500:
            _log.warning(
                "%s %d server error%s: %s", provider, status, suffix, exc
            )
        else:
            # 4xx other than 401/403/429 — bad request shape, worth a warning.
            _log.warning(
                "%s %d client error%s: %s", provider, status, suffix, exc
            )
    elif isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout)):
        _log.warning("%s network error%s: %s", provider, suffix, exc)
    elif isinstance(exc, httpx.HTTPError):
        _log.warning("%s http error%s: %s", provider, suffix, exc)
    else:
        # Unexpected — log with stack trace so the on-call has a chance.
        _log.exception("%s unexpected error%s: %s", provider, suffix, exc)
