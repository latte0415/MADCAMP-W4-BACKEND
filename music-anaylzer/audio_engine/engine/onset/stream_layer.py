"""
스트림 → 레이어(P0/P1/P2) 매핑.
레이어는 스트림의 속성. 스트림 1개 = 레이어 1개.
"""
from __future__ import annotations

from typing import Any

import numpy as np


def assign_layer_to_streams(streams: list[dict[str, Any]]) -> dict[str, str]:
    """
    stream["id"] -> "P0" | "P1" | "P2"

    규칙 (우선순위 P0 > P1 > P2):
    - P0 (Main Impact): band in {low, mid}, density 낮음, strength_median 높음
    - P1 (Pattern/Groove): duration 길다, density 높다, IOI 안정적
    - P2 (Decorative): 나머지 (duration 짧음, IOI 불안정)
    """
    if not streams:
        return {}

    out: dict[str, str] = {}
    med_density = float(np.median([s.get("density", 0) or 0 for s in streams]))
    med_strength = float(np.median([s.get("strength_median", 0) or 0 for s in streams]))
    med_duration = float(
        np.median(
            [
                (s.get("end", 0) or 0) - (s.get("start", 0) or 0)
                for s in streams
            ]
        )
    )
    ioi_stability: list[float] = []
    for s in streams:
        m_ioi = s.get("median_ioi") or 0
        std_ioi = s.get("ioi_std") or 0
        if m_ioi > 0.001:
            ioi_stability.append(std_ioi / m_ioi)
        else:
            ioi_stability.append(1.0)
    med_stability = float(np.median(ioi_stability))

    for s in streams:
        sid = s.get("id", "")
        band = s.get("band", "")
        density = s.get("density", 0) or 0
        strength_median = s.get("strength_median", 0) or 0
        duration = (s.get("end", 0) or 0) - (s.get("start", 0) or 0)
        m_ioi = s.get("median_ioi") or 0
        std_ioi = s.get("ioi_std") or 0
        stability = std_ioi / m_ioi if m_ioi > 0.001 else 1.0

        if band in ("low", "mid") and density < med_density * 1.2 and strength_median > med_strength * 0.8:
            out[sid] = "P0"
        elif duration > med_duration * 0.8 and density > med_density * 0.7 and stability < med_stability * 1.5:
            if sid not in out:
                out[sid] = "P1"
        else:
            if sid not in out:
                out[sid] = "P2"

    return out
