"""
대역 분류: 곡 전체 스펙트럼(적응형) + 고정 Hz를 혼합해 저/중/고 경계 산출.
"""
from __future__ import annotations

import numpy as np

from audio_engine.engine.onset.constants import (
    DEFAULT_N_FFT,
    BAND_HZ_FIXED_LOW_MID,
    BAND_HZ_FIXED_MID_HIGH,
    BAND_BLEND_ALPHA,
    BAND_ADAPTIVE_LOW_MID_RANGE,
    BAND_ADAPTIVE_MID_HIGH_RANGE,
    BAND_CUMULATIVE_PERCENTILES,
)


def compute_band_hz(
    y: np.ndarray,
    sr: int,
    n_fft: int = DEFAULT_N_FFT,
    *,
    alpha: float = BAND_BLEND_ALPHA,
    low_mid_range: tuple[float, float] = BAND_ADAPTIVE_LOW_MID_RANGE,
    mid_high_range: tuple[float, float] = BAND_ADAPTIVE_MID_HIGH_RANGE,
    percentiles: tuple[float, float] = BAND_CUMULATIVE_PERCENTILES,
) -> list[tuple[float, float]]:
    """
    곡 전체 STFT로 주파수별 에너지 누적 → 33%, 66% 해당 Hz 계산 후,
    고정 경계와 블렌딩·클리핑하여 저/중/고 3구간 (f_lo, f_hi) 리스트 반환.

    반환: [(low_lo, low_hi), (mid_lo, mid_hi), (high_lo, high_hi)]
    """
    n_frames = max(1, len(y) // n_fft)
    y_trim = y[: n_frames * n_fft]
    frames = y_trim.reshape(n_frames, n_fft)
    S = np.abs(np.fft.rfft(frames, axis=1)) ** 2
    if S.size == 0:
        return [(20, BAND_HZ_FIXED_LOW_MID), (BAND_HZ_FIXED_LOW_MID, BAND_HZ_FIXED_MID_HIGH), (BAND_HZ_FIXED_MID_HIGH, min(10000, sr // 2))]
    power_per_freq = np.sum(S, axis=0)
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)
    total = float(np.sum(power_per_freq))
    if total <= 0:
        return [(20, BAND_HZ_FIXED_LOW_MID), (BAND_HZ_FIXED_LOW_MID, BAND_HZ_FIXED_MID_HIGH), (BAND_HZ_FIXED_MID_HIGH, min(10000, sr // 2))]
    cum = np.cumsum(power_per_freq)
    p33 = total * (percentiles[0] / 100.0)
    p66 = total * (percentiles[1] / 100.0)
    idx_33 = np.searchsorted(cum, p33, side="left")
    idx_66 = np.searchsorted(cum, p66, side="left")
    f_low_mid_adaptive = float(freqs[min(idx_33, len(freqs) - 1)])
    f_mid_high_adaptive = float(freqs[min(idx_66, len(freqs) - 1)])
    f_low_mid_adaptive = np.clip(f_low_mid_adaptive, low_mid_range[0], low_mid_range[1])
    f_mid_high_adaptive = np.clip(f_mid_high_adaptive, mid_high_range[0], mid_high_range[1])
    f_low_mid = alpha * f_low_mid_adaptive + (1.0 - alpha) * BAND_HZ_FIXED_LOW_MID
    f_mid_high = alpha * f_mid_high_adaptive + (1.0 - alpha) * BAND_HZ_FIXED_MID_HIGH
    nyq = min(10000.0, sr / 2.0)
    return [
        (20.0, f_low_mid),
        (f_low_mid, f_mid_high),
        (f_mid_high, nyq),
    ]
