"""
L3 Features: 이벤트별 맥락 의존성 (SNR·대역 마스킹 → dependency_score).
"""
from __future__ import annotations

import numpy as np

from audio_engine.engine.onset.types import OnsetContext
from audio_engine.engine.onset.constants import (
    BAND_HZ,
    BAND_NAMES,
    DEFAULT_N_FFT,
    EVENT_WIN_SEC,
    BG_WIN_SEC,
)
from audio_engine.engine.onset.utils import robust_norm


def _hz_to_bin(f_hz: float, sr: int, n_fft: int) -> int:
    return int(f_hz * n_fft / sr)


def _get_band_energy(S: np.ndarray, sr: int, n_fft: int) -> dict[str, float]:
    """스펙트럼 S (rfft 절대값 제곱)에서 대역별 에너지."""
    n_bins = S.shape[0]
    energies = {}
    for (f_lo, f_hi), name in zip(BAND_HZ, BAND_NAMES):
        b_lo = min(_hz_to_bin(f_lo, sr, n_fft), n_bins - 1)
        b_hi = min(_hz_to_bin(f_hi, sr, n_fft), n_bins)
        energies[name.lower()] = np.sum(S[b_lo:b_hi])
    return energies


def compute_context_dependency(ctx: OnsetContext) -> tuple[np.ndarray, dict]:
    """
    OnsetContext → (scores, extras).
    scores: dependency_score 0~1 (SNR 낮을수록 높음).
    extras: snr_db, masking_low, masking_mid, masking_high.
    """
    y = ctx.y
    sr = ctx.sr
    onset_times = ctx.onset_times
    n_events = ctx.n_events
    n_fft = DEFAULT_N_FFT

    snr_db_arr = []
    masking_low_arr = []
    masking_mid_arr = []
    masking_high_arr = []

    for i in range(n_events):
        t = onset_times[i]
        ev_start = max(0, int(round((t - EVENT_WIN_SEC) * sr)))
        ev_end = min(len(y), int(round((t + EVENT_WIN_SEC) * sr)))
        seg_event = y[ev_start:ev_end]

        bg_end = ev_start
        bg_start = max(0, bg_end - int(round(BG_WIN_SEC * sr)))
        seg_bg_prev = (
            y[bg_start:bg_end]
            if bg_end > bg_start
            else np.array([])
        )
        bg_start_after = ev_end
        bg_end_after = min(
            len(y), bg_start_after + int(round(BG_WIN_SEC * sr))
        )
        seg_bg_next = (
            y[bg_start_after:bg_end_after]
            if bg_end_after > bg_start_after
            else np.array([])
        )
        if len(seg_bg_prev) > 0 and len(seg_bg_next) > 0:
            seg_bg = np.concatenate([seg_bg_prev, seg_bg_next])
        elif len(seg_bg_prev) > 0:
            seg_bg = seg_bg_prev
        elif len(seg_bg_next) > 0:
            seg_bg = seg_bg_next
        else:
            seg_bg = np.array([0.0])

        E_event = np.mean(seg_event ** 2) if len(seg_event) > 0 else 1e-10
        E_bg = np.mean(seg_bg ** 2) if len(seg_bg) > 0 else 1e-10
        E_event = max(E_event, 1e-10)
        E_bg = max(E_bg, 1e-10)
        snr_db = 10 * np.log10(E_event / E_bg)
        snr_db_arr.append(snr_db)

        if len(seg_event) < n_fft // 4:
            masking_low_arr.append(0.5)
            masking_mid_arr.append(0.5)
            masking_high_arr.append(0.5)
            continue

        if len(seg_event) < n_fft:
            seg_event_padded = np.pad(
                seg_event, (0, n_fft - len(seg_event)), mode="constant"
            )
        else:
            seg_event_padded = seg_event[:n_fft]
        S_event = np.abs(np.fft.rfft(seg_event_padded)) ** 2

        if len(seg_bg) < n_fft:
            seg_bg_padded = np.pad(
                seg_bg, (0, n_fft - len(seg_bg)), mode="constant"
            )
        else:
            seg_bg_padded = seg_bg[:n_fft]
        S_bg = np.abs(np.fft.rfft(seg_bg_padded)) ** 2

        E_event_bands = _get_band_energy(S_event, sr, n_fft)
        E_bg_bands = _get_band_energy(S_bg, sr, n_fft)

        def masking_ratio(e_bg: float, e_ev: float) -> float:
            if e_ev < 1e-10:
                return 1.0
            return min(1.0, e_bg / (e_ev + 1e-10))

        masking_low_arr.append(
            masking_ratio(E_bg_bands["low"], E_event_bands["low"])
        )
        masking_mid_arr.append(
            masking_ratio(E_bg_bands["mid"], E_event_bands["mid"])
        )
        masking_high_arr.append(
            masking_ratio(E_bg_bands["high"], E_event_bands["high"])
        )

    snr_db_arr = np.array(snr_db_arr)
    masking_low_arr = np.array(masking_low_arr)
    masking_mid_arr = np.array(masking_mid_arr)
    masking_high_arr = np.array(masking_high_arr)
    snr_norm = robust_norm(snr_db_arr, method="percentile")
    dependency_score = np.clip(1.0 - snr_norm, 0, 1)

    extras = {
        "snr_db": snr_db_arr,
        "masking_low": masking_low_arr,
        "masking_mid": masking_mid_arr,
        "masking_high": masking_high_arr,
    }
    return dependency_score, extras
