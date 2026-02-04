from __future__ import annotations
"""
Engine 공용: 정규화·pitch 변환. onset/bass 모두 사용.
robust_norm, hz_to_midi. 외부 라이브러리/경로 의존 없음.
"""
import numpy as np

from audio_engine.engine.config import DEFAULT_NORM_CONFIG, NormalizationConfig


def normalize_01(
    x: np.ndarray,
    *,
    method: str = "percentile",
    valid_mask: np.ndarray | None = None,
    config: NormalizationConfig = DEFAULT_NORM_CONFIG,
) -> np.ndarray:
    """
    0~1 정규화 유틸.

    method:
      - "minmax": min/max 기반
      - "median_mad": median, MAD 기반
      - "percentile": percentile 기반 (기본)
    """
    if valid_mask is not None:
        arr = x[valid_mask]
    else:
        arr = x[np.isfinite(x)]
    if len(arr) < 2:
        return np.clip(np.nan_to_num(x, nan=config.nan_fill), 0, 1)

    if method == "minmax":
        mn = np.nanmin(arr)
        mx = np.nanmax(arr)
        if mx <= mn or np.isnan(mx - mn):
            return np.clip(np.nan_to_num(x, nan=config.nan_fill), 0, 1)
        out = (x - mn) / (mx - mn)
        return np.clip(np.nan_to_num(out, nan=config.nan_fill), 0, 1)

    if method == "median_mad":
        med = np.median(arr)
        mad = np.median(np.abs(arr - med))
        if mad < 1e-12:
            return np.zeros_like(x) + config.nan_fill
        z = (x - med) / (config.mad_scale * mad)
        return np.clip(config.nan_fill + z / config.z_clip, 0, 1).astype(np.float64)

    # percentile
    p1, p99 = np.percentile(arr, [config.percentile_lo, config.percentile_hi])
    if p99 <= p1 or np.isnan(p99 - p1):
        return np.clip(np.nan_to_num(x, nan=config.nan_fill), 0, 1)
    out = (x - p1) / (p99 - p1)
    out = np.clip(out, 0, 1)
    return np.nan_to_num(out, nan=config.nan_fill)


def log_norm_01(
    x: np.ndarray,
    *,
    k: float = 100.0,
    config: NormalizationConfig = DEFAULT_NORM_CONFIG,
) -> np.ndarray:
    """log(1 + k*x) 후 0~1 정규화."""
    out = np.log1p(k * np.maximum(x, 0))
    return normalize_01(out, method="minmax", config=config)


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
    return normalize_01(x, method=method, valid_mask=valid_mask)


def hz_to_midi(hz: float) -> float:
    """Hz → MIDI note number (A440 = 69). 0/NaN/invalid → nan."""
    if hz <= 0 or not np.isfinite(hz):
        return np.nan
    return 12.0 * (np.log2(hz) - np.log2(440.0)) + 69.0
