"""
Other 출력을 streams_sections_cnn.json 내 other 필드 스키마로 변환.
"""
from __future__ import annotations

from typing import Any


def build_other_output(
    other_curve: list[dict[str, Any]],
    other_keypoints: list[dict[str, Any]],
    other_regions: list[dict[str, Any]],
    other_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    other_curve + other_keypoints + other_regions + meta → JSON 호환 dict.

    Returns:
        {"other_curve": [...], "other_keypoints": [...], "other_regions": [...], "other_meta": {...}}
    """
    meta = other_meta or {}
    return {
        "other_curve": other_curve,
        "other_keypoints": other_keypoints,
        "other_regions": other_regions,
        "other_meta": meta,
    }
