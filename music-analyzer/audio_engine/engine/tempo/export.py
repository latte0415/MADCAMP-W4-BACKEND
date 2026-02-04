"""
BPM·마디 결과 → JSON용 dict 구성.
"""
from __future__ import annotations

from typing import Any

import numpy as np


def build_tempo_output(
    bpm: float,
    bars: list[dict[str, Any]],
    beat_times: np.ndarray | list[float] | None = None,
    duration_sec: float | None = None,
) -> dict[str, Any]:
    """
    BPM·마디·비트 시각을 streams_sections 등에서 참조할 수 있는 형식으로 변환.

    Returns:
        {"bpm": float, "bars": [...], "beats": [...], "duration_sec": float}
    """
    out: dict[str, Any] = {
        "bpm": round(float(bpm), 2),
        "bars": bars,
    }
    if beat_times is not None:
        bt = np.asarray(beat_times).flatten()
        out["beats"] = [round(float(t), 4) for t in bt]
    if duration_sec is not None:
        out["duration_sec"] = round(float(duration_sec), 4)
    return out
