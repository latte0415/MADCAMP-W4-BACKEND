"""
Vocal 키포인트: vocal_curve에서 Δpitch/Δt, Δenergy/Δt 기반으로 의미 있는 변화 지점 추출.
vocal_keypoint := |Δpitch/Δt| > th_pitch OR |Δenergy/Δt| > th_energy
"""
from __future__ import annotations

from typing import Any

import numpy as np

# 기본 임계값 (경험적; 조정 가능)
PITCH_SLOPE_THRESHOLD_MIDI_PER_SEC = 24.0  # semitones per second
ENERGY_SLOPE_THRESHOLD_PER_SEC = 2.0      # norm amp change per second (0~1 scale)


def compute_vocal_keypoints(
    vocal_curve: list[dict[str, Any]],
    pitch_slope_th: float = PITCH_SLOPE_THRESHOLD_MIDI_PER_SEC,
    energy_slope_th: float = ENERGY_SLOPE_THRESHOLD_PER_SEC,
) -> list[dict[str, Any]]:
    """
    vocal_curve (시간순)에서 변화율이 임계를 넘는 지점을 키포인트로 반환.

    Returns:
        [{"t": float, "type": "pitch_change"|"energy_change", "score": float}, ...]
    """
    if len(vocal_curve) < 3:
        return []

    t = np.array([p["t"] for p in vocal_curve], dtype=np.float64)
    pitch = np.array([p.get("pitch", 0) or 0 for p in vocal_curve], dtype=np.float64)
    amp = np.array([p.get("amp", 0) or 0 for p in vocal_curve], dtype=np.float64)

    dt = np.diff(t)
    dt = np.where(dt <= 0, np.nan, dt)
    dpitch = np.diff(pitch)
    damp = np.diff(amp)
    slope_pitch = np.abs(dpitch / dt)
    slope_energy = np.abs(damp / dt)
    # 키포인트 시각은 구간 끝 (i+1)
    t_mid = (t[:-1] + t[1:]) / 2

    keypoints: list[dict[str, Any]] = []
    for i in range(len(slope_pitch)):
        if not np.isfinite(dt[i]) or dt[i] <= 0:
            continue
        ti = round(float(t_mid[i]), 4)
        if np.isfinite(slope_pitch[i]) and slope_pitch[i] >= pitch_slope_th:
            keypoints.append({
                "t": ti,
                "type": "pitch_change",
                "score": round(float(slope_pitch[i]), 4),
            })
        if np.isfinite(slope_energy[i]) and slope_energy[i] >= energy_slope_th:
            keypoints.append({
                "t": ti,
                "type": "energy_change",
                "score": round(float(slope_energy[i]), 4),
            })

    # 시간순 정렬
    keypoints.sort(key=lambda x: x["t"])
    return keypoints
