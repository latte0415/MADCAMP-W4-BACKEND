"""
Vocal 출력을 streams_sections_cnn.json 내 vocal 필드 스키마로 변환.
"""
from __future__ import annotations

from typing import Any


def build_vocal_output(
    vocal_curve: list[dict[str, Any]],
    vocal_keypoints: list[dict[str, Any]],
    vocal_curve_meta: dict[str, Any] | None = None,
    vocal_phrases: list[dict[str, Any]] | None = None,
    vocal_turns: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    vocal_curve + vocal_keypoints + (선택) vocal_phrases / vocal_turns + meta → JSON 호환 dict.
    USE_PHRASE=False 시 vocal_turns만 사용 (phrase 없이 Turn 포인트만).
    """
    meta = vocal_curve_meta or {}
    out: dict[str, Any] = {
        "vocal_curve": vocal_curve,
        "vocal_keypoints": vocal_keypoints,
        "vocal_curve_meta": meta,
    }
    if vocal_phrases is not None:
        out["vocal_phrases"] = vocal_phrases
    if vocal_turns is not None:
        out["vocal_turns"] = vocal_turns
    return out
