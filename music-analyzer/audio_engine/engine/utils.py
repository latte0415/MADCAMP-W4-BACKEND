"""
Engine 공용: 정규화·pitch 변환. onset/bass 모두 사용.
robust_norm, hz_to_midi. 외부 라이브러리/경로 의존 없음.
"""
import numpy as np


def robust_norm(
    x: np.ndarray,
    method: str = "percentile",
    valid_mask: np.ndarray | None = None,
) -> np.ndarray:
    """
    배열을 0~1 범위로 정규화.

    method:
      - "median_mad": median, MAD 기반 (01_energy 스타일)
      - "percentile": 1/99 백분위 기반 (clarity, temporal, spectral, context 스타일)
    valid_mask: None이면 np.isfinite(x)로 유효값 사용. 지정 시 해당 마스크로만 통계 계산.
    """
    if valid_mask is not None:
        arr = x[valid_mask]
    else:
        arr = x[np.isfinite(x)]
    if len(arr) < 2:
        return np.clip(np.nan_to_num(x, nan=0.5), 0, 1)

    if method == "median_mad":
        med = np.median(arr)
        mad = np.median(np.abs(arr - med))
        if mad < 1e-12:
            return np.zeros_like(x) + 0.5
        z = (x - med) / (1.4826 * mad)
        return np.clip(0.5 + z / 6, 0, 1).astype(np.float64)

    # percentile
    p1, p99 = np.percentile(arr, [1, 99])
    if p99 <= p1 or np.isnan(p99 - p1):
        return np.clip(np.nan_to_num(x, nan=0.5), 0, 1)
    out = (x - p1) / (p99 - p1)
    out = np.clip(out, 0, 1)
    return np.nan_to_num(out, nan=0.5)


def hz_to_midi(hz: float) -> float:
    """Hz → MIDI note number (A440 = 69). 0/NaN/invalid → nan."""
    if hz <= 0 or not np.isfinite(hz):
        return np.nan
    return 12.0 * (np.log2(hz) - np.log2(440.0)) + 69.0
