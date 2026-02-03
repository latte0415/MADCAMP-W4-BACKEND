"""
L3 Features: 이벤트별 스펙트럼 포커스 (centroid/bandwidth/flatness → focus_score).
"""
from __future__ import annotations

import librosa
import numpy as np

from audio_engine.engine.onset.types import OnsetContext
from audio_engine.engine.onset.constants import DEFAULT_N_FFT
from audio_engine.engine.onset.utils import robust_norm


def compute_spectral(ctx: OnsetContext) -> tuple[np.ndarray, dict]:
    """
    OnsetContext → (scores, extras).
    scores: focus_score 0~1 (포커스 높을수록 또렷한 타격).
    extras: centroids, bandwidths, flatnesses (원값).
    """
    y = ctx.y
    sr = ctx.sr
    duration = ctx.duration
    onset_times = ctx.onset_times
    n_events = ctx.n_events
    n_fft = DEFAULT_N_FFT

    centroids = []
    bandwidths = []
    flatnesses = []

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
        start_sample = max(0, int(round(mid_prev * sr)))
        end_sample = min(len(y), int(round(mid_next * sr)))
        seg = y[start_sample:end_sample]

        if len(seg) < n_fft // 4:
            centroids.append(np.nan)
            bandwidths.append(np.nan)
            flatnesses.append(np.nan)
            continue
        if len(seg) < n_fft:
            seg = np.pad(
                seg, (0, n_fft - len(seg)), mode="constant", constant_values=0
            )
        S = np.abs(
            librosa.stft(seg[:n_fft], n_fft=n_fft, hop_length=n_fft // 2)
        ) ** 2
        if S.size == 0:
            centroids.append(np.nan)
            bandwidths.append(np.nan)
            flatnesses.append(np.nan)
            continue
        cent = librosa.feature.spectral_centroid(S=S, sr=sr)
        bw = librosa.feature.spectral_bandwidth(S=S, sr=sr, centroid=cent)
        flat = librosa.feature.spectral_flatness(S=S)
        centroids.append(float(np.nanmean(cent)))
        bandwidths.append(float(np.nanmean(bw)))
        flatnesses.append(float(np.nanmean(flat)))

    centroids = np.array(centroids)
    bandwidths = np.array(bandwidths)
    flatnesses = np.array(flatnesses)
    valid = (
        np.isfinite(centroids)
        & np.isfinite(bandwidths)
        & np.isfinite(flatnesses)
    )
    flat_norm = robust_norm(flatnesses, method="percentile", valid_mask=valid)
    bw_norm = robust_norm(bandwidths, method="percentile", valid_mask=valid)
    focus_score = 1.0 - 0.5 * flat_norm - 0.5 * bw_norm
    focus_score = np.clip(focus_score, 0, 1)
    focus_score = np.nan_to_num(focus_score, nan=0.5)

    extras = {
        "centroids": centroids,
        "bandwidths": bandwidths,
        "flatnesses": flatnesses,
    }
    return focus_score, extras
