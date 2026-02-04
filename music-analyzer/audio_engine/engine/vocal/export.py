"""
Vocal 출력을 streams_sections_cnn.json 내 vocal 필드 스키마로 변환.
"""
from __future__ import annotations

from typing import Any


def build_vocal_output(
    vocal_curve: list[dict[str, Any]],
    vocal_keypoints: list[dict[str, Any]],
    vocal_curve_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    vocal_curve + vocal_keypoints + meta → JSON 호환 dict.

    Returns:
        {"vocal_curve": [...], "vocal_keypoints": [...], "vocal_curve_meta": {...}}
    """
    meta = vocal_curve_meta or {}
    return {
        "vocal_curve": vocal_curve,
        "vocal_keypoints": vocal_keypoints,
        "vocal_curve_meta": meta,
    }
