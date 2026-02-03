"""
L3 Features: 이벤트별 에너지 점수 (RMS·대역 에너지 → energy_score, band_*).
"""
from __future__ import annotations

import numpy as np

from audio_engine.engine.onset.types import OnsetContext
from audio_engine.engine.onset.constants import (
    BAND_HZ,
    BAND_NAMES,
    DEFAULT_N_FFT,
)
from audio_engine.engine.onset.utils import robust_norm


def _hz_to_bin(f_hz: float, sr: int, n_fft: int) -> int:
    return int(f_hz * n_fft / sr)


def compute_energy(
    ctx: OnsetContext,
    band_hz: list[tuple[float, float]] | None = None,
) -> tuple[np.ndarray, dict]:
    """
    OnsetContext → (scores, extras).
    band_hz: 저/중/고 3구간 (f_lo, f_hi) 리스트. None이면 constants.BAND_HZ 사용.
    """
    y = ctx.y
    sr = ctx.sr
    duration = ctx.duration
    onset_times = ctx.onset_times
    n_events = ctx.n_events
    n_fft = DEFAULT_N_FFT
    bands = band_hz if band_hz is not None and len(band_hz) == 3 else BAND_HZ

    rms_per_event = []
    left_sec_arr = []
    right_sec_arr = []
    band_energy = {name: [] for name in BAND_NAMES}

    for i in range(n_events):
        mid_prev = (
            0.0
            if i == 0
            else (onset_times[i - 1] + onset_times[i]) / 2
        )
        mid_next = (
            duration
            if i == n_events - 1
            else (onset_times[i] + onset_times[i + 1]) / 2
        )
        left_sec_arr.append(onset_times[i] - mid_prev)
        right_sec_arr.append(mid_next - onset_times[i])
        start_sample = max(0, int(round(mid_prev * sr)))
        end_sample = min(len(y), int(round(mid_next * sr)))
        seg = y[start_sample:end_sample]
        if len(seg) == 0:
            rms_per_event.append(0.0)
            for name in BAND_NAMES:
                band_energy[name].append(0.0)
            continue
        rms = np.sqrt(np.mean(seg ** 2))
        rms_per_event.append(rms)
        if len(seg) < n_fft // 4:
            for name in BAND_NAMES:
                band_energy[name].append(0.0)
            continue
        if len(seg) < n_fft:
            seg = np.pad(
                seg, (0, n_fft - len(seg)), mode="constant", constant_values=0
            )
        S = np.abs(np.fft.rfft(seg[:n_fft])) ** 2
        n_bins = len(S)
        for (f_lo, f_hi), name in zip(bands, BAND_NAMES):
            b_lo = min(_hz_to_bin(f_lo, sr, n_fft), n_bins - 1)
            b_hi = min(_hz_to_bin(f_hi, sr, n_fft), n_bins)
            band_energy[name].append(np.sum(S[b_lo:b_hi]))

    rms_per_event = np.array(rms_per_event)
    left_sec_arr = np.array(left_sec_arr)
    right_sec_arr = np.array(right_sec_arr)
    for name in BAND_NAMES:
        band_energy[name] = np.array(band_energy[name])

    log_rms = np.log(1e-10 + rms_per_event)
    energy_score = robust_norm(log_rms, method="median_mad")
    E_norm_low = robust_norm(band_energy["Low"], method="median_mad")
    E_norm_mid = robust_norm(band_energy["Mid"], method="median_mad")
    E_norm_high = robust_norm(band_energy["High"], method="median_mad")

    deltas = np.diff(onset_times)
    gap_prev = np.concatenate([[np.inf], deltas])
    overlap_prev = np.zeros(n_events, dtype=bool)
    for i in range(1, n_events):
        overlap_prev[i] = gap_prev[i] < (
            left_sec_arr[i] + right_sec_arr[i - 1]
        )

    extras = {
        "rms_per_event": rms_per_event,
        "log_rms": log_rms,
        "E_norm_low": E_norm_low,
        "E_norm_mid": E_norm_mid,
        "E_norm_high": E_norm_high,
        "left_sec_arr": left_sec_arr,
        "right_sec_arr": right_sec_arr,
        "overlap_prev": overlap_prev,
        "band_energy": band_energy,
    }
    return energy_score, extras
