"""
L3 Features: 이벤트별 박자/반복 점수 (grid align, IOI → temporal_score).
"""
from __future__ import annotations

import librosa
import numpy as np

from audio_engine.engine.onset.types import OnsetContext
from audio_engine.engine.onset.constants import (
    DEFAULT_HOP_LENGTH,
    MIN_IOI_SEC,
    LEVEL_WEIGHT,
    GRID_MULTIPLES,
    SIGMA_BEAT,
    TEMPO_STD_BPM,
    SWING_RATIO,
)
from audio_engine.engine.onset.utils import robust_norm


def _build_grid_if_needed(ctx: OnsetContext):
    """ctx에 grid 없으면 로컬 템포·비트·그리드 생성."""
    if ctx.grid_times is not None and ctx.grid_levels is not None:
        return ctx.grid_times, ctx.grid_levels, ctx.bpm
    y, sr = ctx.y, ctx.sr
    hop_length = DEFAULT_HOP_LENGTH
    onset_env = ctx.onset_env
    bpm = ctx.bpm
    tempo_dynamic = librosa.feature.tempo(
        y=y, sr=sr, aggregate=None, std_bpm=TEMPO_STD_BPM
    )
    tempo_times = librosa.times_like(tempo_dynamic, sr=sr)
    onset_env_times = librosa.times_like(onset_env, sr=sr, hop_length=hop_length)
    tempo_dynamic = np.interp(
        onset_env_times,
        tempo_times,
        np.nan_to_num(tempo_dynamic, nan=bpm),
    )
    _, beats_dynamic = librosa.beat.beat_track(
        y=y,
        sr=sr,
        hop_length=hop_length,
        bpm=tempo_dynamic,
        units="time",
        trim=False,
    )
    beats_dynamic = np.asarray(beats_dynamic).flatten()
    if len(beats_dynamic) < 4:
        _, beats_dynamic = librosa.beat.beat_track(
            y=y, sr=sr, hop_length=hop_length, units="time", trim=False
        )
        beats_dynamic = np.asarray(beats_dynamic).flatten()
    beats_dynamic = np.sort(beats_dynamic)
    grid_times, grid_levels = _build_variable_grid(beats_dynamic, SWING_RATIO)
    return grid_times, grid_levels, bpm


def _build_variable_grid(beats: np.ndarray, swing_ratio: float = 1.0):
    grid_times = []
    grid_levels = []
    for k in range(len(beats) - 1):
        b0, b1 = beats[k], beats[k + 1]
        span = b1 - b0
        if span <= 0:
            continue
        grid_times.append(b0)
        grid_levels.append(1)
        grid_times.append(b0 + span * 0.5)
        grid_levels.append(2)
        for f in [0.25, 0.5, 0.75]:
            grid_times.append(b0 + span * f)
            grid_levels.append(4)
        if swing_ratio != 1.0:
            long_8 = span * swing_ratio / (1.0 + swing_ratio)
            short_8 = span / (1.0 + swing_ratio)
            grid_times.extend([b0 + long_8, b0 + long_8 + short_8])
            grid_levels.extend([8, 8])
        else:
            for f in [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]:
                grid_times.append(b0 + span * f)
                grid_levels.append(8)
        for f in np.arange(0.0625, 1.0, 0.0625):
            grid_times.append(b0 + span * f)
            grid_levels.append(16)
    grid_times.append(beats[-1])
    grid_levels.append(1)
    return np.array(grid_times), np.array(grid_levels)


def _get_repr_ioi(prev: float, next_: float) -> float:
    if np.isfinite(prev) and np.isfinite(next_):
        if prev < MIN_IOI_SEC and next_ < MIN_IOI_SEC:
            return np.nan
        if prev < MIN_IOI_SEC:
            return next_
        if next_ < MIN_IOI_SEC:
            return prev
        return (prev + next_) / 2
    return prev if np.isfinite(prev) else next_


def compute_temporal(ctx: OnsetContext) -> tuple[np.ndarray, dict]:
    """
    OnsetContext → (scores, extras).
    scores: temporal_score 0~1.
    extras: grid_align_score, repetition_score, ioi_prev, ioi_next.
    """
    onset_times = ctx.onset_times
    strengths = ctx.strengths
    bpm = ctx.bpm

    grid_times, grid_levels, bpm_used = _build_grid_if_needed(ctx)
    beat_length = 60.0 / max(bpm_used, 40)
    tau_tight = beat_length * 0.06

    grid_align_scores = []
    for t in onset_times:
        dists = np.abs(t - grid_times)
        idx = np.argmin(dists)
        d = dists[idx]
        level = int(grid_levels[idx])
        w = LEVEL_WEIGHT.get(level, 0.5)
        base = np.exp(-d / tau_tight)
        grid_align_scores.append(base * w)
    grid_align_score = np.clip(np.array(grid_align_scores), 0, 1)

    deltas = np.diff(onset_times)
    ioi_prev = np.concatenate([[np.nan], deltas])
    ioi_next = np.concatenate([deltas, [np.nan]])
    ioi_per_event = np.array(
        [_get_repr_ioi(ioi_prev[i], ioi_next[i]) for i in range(len(onset_times))]
    )
    beat_len = 60.0 / max(bpm, 40)
    grid_multiples = np.array(GRID_MULTIPLES)

    def rep_score(ioi_val):
        if not np.isfinite(ioi_val) or ioi_val < MIN_IOI_SEC:
            return 0.5
        ioi_beat = ioi_val / beat_len
        if ioi_beat > 2.5:
            return 0.5
        best = 0.0
        for mult in grid_multiples:
            s = np.exp(-np.abs(ioi_beat - mult) / SIGMA_BEAT)
            best = max(best, s)
        return float(best)

    repetition_score = np.clip(
        np.array([rep_score(v) for v in ioi_per_event]), 0, 1
    )

    strength_norm = np.clip(
        (strengths - strengths.min()) / (strengths.max() - strengths.min() + 1e-8),
        0,
        1,
    )
    strength_weight = 0.85 + 0.15 * strength_norm
    temporal_score_raw = grid_align_score * repetition_score * strength_weight
    temporal_score = robust_norm(temporal_score_raw, method="percentile")

    extras = {
        "grid_align_score": grid_align_score,
        "repetition_score": repetition_score,
        "ioi_prev": ioi_prev,
        "ioi_next": ioi_next,
    }
    return temporal_score, extras
