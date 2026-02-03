"""
베이스 에너지 엔벨로프 (프레임 기반).
pitch와 동일 frame grid에서 short RMS → log → robust_norm.
"""
from __future__ import annotations

import numpy as np
from scipy.signal import butter, filtfilt

from audio_engine.engine.utils import robust_norm
from audio_engine.engine.bass.constants import (
    BASS_HOP_LENGTH,
    BASS_BANDPASS_HZ,
    BASS_ENERGY_WIN_LENGTH,
)


def compute_bass_energy_envelope(
    y: np.ndarray,
    sr: int,
    n_frames: int,
    *,
    hop_length: int = BASS_HOP_LENGTH,
    win_length: int = BASS_ENERGY_WIN_LENGTH,
    bandpass_hz: tuple[float, float] | None = BASS_BANDPASS_HZ,
) -> np.ndarray:
    """
    pitch와 동일한 frame 개수만큼 프레임 중심에서 short RMS 계산.
    bandpass(선택) → RMS → log → robust_norm(median_mad).

    Returns:
        energy: (n_frames,) 0~1 정규화, pitch와 동일 길이.
    """
    if bandpass_hz is not None:
        f_lo, f_hi = bandpass_hz
        nyq = sr / 2.0
        low = max(1.0 / nyq, f_lo / nyq)
        high = min(1.0 - 1e-6, f_hi / nyq)
        b, a = butter(2, [low, high], btype="band")
        y = filtfilt(b, a, y.astype(np.float64))

    half = win_length // 2
    n = len(y)
    rms_list: list[float] = []
    for i in range(n_frames):
        center_sample = i * hop_length
        start_s = max(0, center_sample - half)
        end_s = min(n, center_sample + half)
        seg = y[start_s:end_s]
        rms = float(np.sqrt(np.mean(seg ** 2))) if len(seg) > 0 else 0.0
        rms_list.append(rms)
    rms_arr = np.array(rms_list)
    log_rms = np.log(1e-10 + rms_arr)
    energy = robust_norm(log_rms, method="median_mad")
    return energy
