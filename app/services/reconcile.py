"""Reconcile Gemini + HF detections into a single ranked list.

Pure function — no I/O, no globals. Takes two parallel arrays
(`gemini_items` from `GeminiClient.detect`, `hf_labels` from
`HFClient.classify`) and returns the merged `list[DetectedItem]`.

Merge rules:
  1. If both sources agree on a food (case-insensitive substring match)
     → keep one item, take the higher confidence, scale HF 0–1 → 0–100.
  2. Gemini-only items pass through unchanged.
  3. HF-only items are kept with `confidence = score * 100`.

If both sources are empty the result is empty; the route returns an
empty detection list rather than substituting fixture data.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

from app.models.schemas import DetectedItem

# Scale HF classifier scores (0–1) into the same 0–100 range Gemini uses.
_HF_SCORE_SCALE = 100.0


def merge(
    gemini_items: Iterable[DetectedItem],
    hf_labels: Iterable[tuple[str, float]],
) -> list[DetectedItem]:
    """Confidence-weighted vote between Gemini and HF."""
    gemini_list = list(gemini_items)
    hf_list = list(hf_labels)

    if not gemini_list and not hf_list:
        return []

    used_hf: set[int] = set()
    out: list[DetectedItem] = []
    for g in gemini_list:
        # Find the best matching HF label (case-insensitive substring).
        match_idx = -1
        for i, (label, _score) in enumerate(hf_list):
            if i in used_hf:
                continue
            if _matches(g.name, label):
                match_idx = i
                break
        if match_idx == -1:
            out.append(g)
            continue
        hf_label, hf_score = hf_list[match_idx]
        used_hf.add(match_idx)
        # Higher confidence wins; HF scaled to 0–100.
        hf_conf = hf_score * _HF_SCORE_SCALE
        if hf_conf > g.confidence:
            # Prefer HF's label when it's the stronger signal — Gemini
            # classifications often read as the user's meal ("chicken
            # biryani") while HF emits the taxonomy leaf
            # ("chicken_biryani"). Both are equivalent for our purposes.
            out.append(
                DetectedItem(
                    name=_normalize_label(hf_label),
                    name_bn=g.name_bn,
                    confidence=hf_conf,
                    grams=g.grams,
                    note=g.note,
                    bbox=g.bbox,
                )
            )
        else:
            out.append(g)

    # Remaining HF-only items.
    for i, (label, score) in enumerate(hf_list):
        if i in used_hf:
            continue
        out.append(
            DetectedItem(
                name=_normalize_label(label),
                confidence=score * _HF_SCORE_SCALE,
                grams=100.0,
            )
        )
    return out


def _matches(a: str, b: str) -> bool:
    """Case-insensitive bidirectional substring match. Either side may
    contain the other — handles "chicken biryani" ↔ "chicken_biryani"
    and "biryani" ↔ "chicken biryani rice"."""
    a_l = a.lower()
    b_l = b.lower().replace("_", " ")
    return a_l in b_l or b_l in a_l


_NORMALIZE_RE = re.compile(r"\s+")
_LABEL_SPLIT_RE = re.compile(r"[,_]")


def _normalize_label(label: str) -> str:
    """Convert HF taxonomy labels to a display-friendly form.

    `chicken_biryani` → `Chicken biryani`. Falls back to title-casing
    the raw label when no underscore/space is present.
    """
    cleaned = label.strip().replace("_", " ").replace("-", " ")
    cleaned = _NORMALIZE_RE.sub(" ", cleaned).strip()
    if not cleaned:
        return label
    # `chicken biryani rice,cooked` → drop the comma-trailing suffix.
    parts = [p.strip() for p in _LABEL_SPLIT_RE.split(cleaned) if p.strip()]
    if not parts:
        return cleaned
    return parts[0].title()