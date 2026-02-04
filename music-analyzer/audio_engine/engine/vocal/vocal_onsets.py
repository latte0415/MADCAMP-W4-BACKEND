"""
Vocal onset 추출 (독립 모듈).
madmom RNN onset activation에서 peak만 뽑아, Turn과 별도로 "살짝 얹는" 용도.
- phrase/Turn 로직과 무관.
- 입력: activation (vocal_curve와 동일 그리드), t 또는 duration.
- 출력: [{ t, type: "onset", strength, score }], 개수 제한(20초당 N개, 최소 거리).
"""
from __future__ import annotations

from typing import Any

import numpy as np

# 20초당 최대 onset 개수 (Turn보다 많아도 됨, "살짝 얹기")
ONSETS_PER_20SEC = 16
# 인접 onset 최소 간격(초)
MIN_ONSET_DISTANCE_SEC = 0.22
# peak로 인정할 최소 strength (activation 0~1; 낮추면 더 많이 잡힘)
MIN_ONSET_STRENGTH = 0.05


def compute_vocal_onsets(
    t: np.ndarray,
    activation: np.ndarray,
    duration_sec: float | None = None,
    max_per_20sec: int = ONSETS_PER_20SEC,
    min_distance_sec: float = MIN_ONSET_DISTANCE_SEC,
    min_strength: float = MIN_ONSET_STRENGTH,
) -> list[dict[str, Any]]:
    """
    activation 곡선에서 local max = onset 후보.
    - min_strength 이상인 peak만
    - 이미 고른 점과 min_distance_sec 이상 떨어진 것만 추가
    - 20초당 max_per_20sec 개로 cap
    """
    if len(t) < 3 or len(activation) != len(t):
        return []
    act = np.asarray(activation, dtype=np.float64)
    peaks: list[tuple[float, float]] = []
    for i in range(1, len(act) - 1):
        if act[i] >= act[i - 1] and act[i] >= act[i + 1] and act[i] >= min_strength:
            peaks.append((float(t[i]), float(act[i])))
    if not peaks:
        return []
    peaks.sort(key=lambda x: x[1], reverse=True)
    dur = duration_sec if duration_sec is not None else (float(t[-1]) - float(t[0]) + 0.02)
    max_n = min(len(peaks), int(round(dur / 20.0 * max_per_20sec)))
    chosen: list[tuple[float, float]] = []
    for (ti, strength) in peaks:
        if len(chosen) >= max_n:
            break
        if any(abs(ti - c[0]) < min_distance_sec for c in chosen):
            continue
        chosen.append((ti, strength))
    chosen.sort(key=lambda x: x[0])
    return [
        {"t": round(ti, 4), "type": "onset", "strength": round(strength, 4), "score": round(strength, 4)}
        for ti, strength in chosen
    ]


def compute_vocal_onsets_from_amp(
    t: np.ndarray,
    amp: np.ndarray,
    duration_sec: float | None = None,
    max_per_20sec: int = ONSETS_PER_20SEC,
    min_distance_sec: float = MIN_ONSET_DISTANCE_SEC,
    min_strength: float = 0.03,
) -> list[dict[str, Any]]:
    """
    activation 없을 때 fallback: amp 곡선에서 local max = onset 후보.
    madmom 실패 시에도 onset을 뽑기 위함.
    """
    if len(t) < 3 or len(amp) != len(t):
        return []
    amp_arr = np.asarray(amp, dtype=np.float64)
    peaks: list[tuple[float, float]] = []
    for i in range(1, len(amp_arr) - 1):
        if amp_arr[i] >= amp_arr[i - 1] and amp_arr[i] >= amp_arr[i + 1] and amp_arr[i] >= min_strength:
            peaks.append((float(t[i]), float(amp_arr[i])))
    if not peaks:
        return []
    peaks.sort(key=lambda x: x[1], reverse=True)
    dur = duration_sec if duration_sec is not None else (float(t[-1]) - float(t[0]) + 0.02)
    max_n = min(len(peaks), int(round(dur / 20.0 * max_per_20sec)))
    chosen: list[tuple[float, float]] = []
    for (ti, strength) in peaks:
        if len(chosen) >= max_n:
            break
        if any(abs(ti - c[0]) < min_distance_sec for c in chosen):
            continue
        chosen.append((ti, strength))
    chosen.sort(key=lambda x: x[0])
    return [
        {"t": round(ti, 4), "type": "onset", "strength": round(strength, 4), "score": round(strength, 4)}
        for ti, strength in chosen
    ]
