"""
L3 Features: 이벤트별 어택 명확도 (attack time → clarity_score).
"""
from __future__ import annotations

import numpy as np
from scipy.ndimage import uniform_filter1d, median_filter

from audio_engine.engine.onset.types import OnsetContext
from audio_engine.engine.onset.constants import (
    CLARITY_ATTACK_MIN_MS,
    CLARITY_ATTACK_MAX_MS,
)
from audio_engine.engine.onset.utils import robust_norm


def _get_attack_time(
    y_segment: np.ndarray,
    sr: int,
    min_ms: float = CLARITY_ATTACK_MIN_MS,
    max_ms: float = CLARITY_ATTACK_MAX_MS,
) -> float:
    """10% → 90% attack time (ms)."""
    env = np.abs(y_segment).astype(np.float64)
    smooth_size = min(11, max(3, len(env) // 30))
    if smooth_size >= 3 and smooth_size % 2 == 0:
        smooth_size += 1
    if smooth_size >= 3:
        env = uniform_filter1d(env, size=smooth_size, mode="nearest")
    peak_idx = np.argmax(env)
    peak_val = env[peak_idx]
    if peak_val < 1e-7:
        return max(min_ms, (1 / sr) * 1000)
    before_peak = env[:peak_idx]
    local_min_idx = 0
    min_samples = max(2, int(0.002 * sr))
    if len(before_peak) >= 3:
        for i in range(1, len(before_peak) - 1):
            if (
                before_peak[i] <= before_peak[i - 1]
                and before_peak[i] <= before_peak[i + 1]
            ):
                dist_ok = (peak_idx - i) >= min_samples
                depth_ok = before_peak[i] < (0.3 * peak_val)
                if dist_ok and depth_ok:
                    local_min_idx = i
    pre_peak_env = env[local_min_idx : peak_idx + 1]
    if len(pre_peak_env) < 2:
        return max(min_ms, (1 / sr) * 1000)
    t10_val = 0.1 * peak_val
    t90_val = 0.9 * peak_val
    try:
        idx10 = np.where(pre_peak_env >= t10_val)[0][0]
        if idx10 > 0:
            v0, v1 = pre_peak_env[idx10 - 1], pre_peak_env[idx10]
            t10 = (idx10 - 1) + (t10_val - v0) / (v1 - v0 + 1e-10)
        else:
            t10 = 0.0
        idx90 = np.where(pre_peak_env >= t90_val)[0][0]
        if idx90 > 0:
            v0, v1 = pre_peak_env[idx90 - 1], pre_peak_env[idx90]
            t90 = (idx90 - 1) + (t90_val - v0) / (v1 - v0 + 1e-10)
        else:
            t90 = 0.0
        attack_samples = max(t90 - t10, 1.0)
        attack_time_ms = (attack_samples / sr) * 1000
        return float(np.clip(attack_time_ms, min_ms, max_ms))
    except Exception:
        return max(min_ms, (1 / sr) * 1000)


def compute_clarity(ctx: OnsetContext) -> tuple[np.ndarray, dict]:
    """
    OnsetContext → (scores, extras).
    scores: clarity_score 0~1.
    extras: attack_times_ms.
    """
    y = ctx.y
    sr = ctx.sr
    onset_times = ctx.onset_times
    strengths = ctx.strengths

    deltas = np.diff(onset_times)
    gap_prev = np.concatenate([[np.inf], deltas])
    gap_next = np.concatenate([deltas, [np.inf]])

    attack_times = []
    for i in range(len(onset_times)):
        pre_sec = min(0.05, 0.45 * gap_prev[i])
        post_sec = min(0.02, 0.45 * gap_next[i])
        start_sample = max(0, int(round((onset_times[i] - pre_sec) * sr)))
        end_sample = min(len(y), int(round((onset_times[i] + post_sec) * sr)))
        y_seg = y[start_sample:end_sample]
        a_time = _get_attack_time(y_seg, sr)
        attack_times.append(a_time)

    attack_times = np.array(attack_times)
    attack_times = median_filter(attack_times, size=3, mode="nearest")

    safe_attack = np.clip(attack_times, 0.1, None)
    clarity_raw = strengths * (1.0 / safe_attack)
    clarity_score = robust_norm(clarity_raw, method="percentile")
    clarity_score = np.clip(
        clarity_score,
        np.percentile(clarity_score, 1),
        np.percentile(clarity_score, 99),
    )

    extras = {"attack_times_ms": attack_times}
    return clarity_score, extras


def compute_clarity_scores_for_times(
    y: np.ndarray,
    times: np.ndarray,
    strengths: np.ndarray,
    sr: int,
) -> np.ndarray:
    """
    Band wav + onset times/strengths로 clarity_score 배열 계산.
    KeyOnsetSelector 3차(선택)용. compute_clarity와 동일한 attack-time + strength/safe_attack 로직.
    """
    if len(times) == 0:
        return np.array([])
    times = np.asarray(times, dtype=float)
    if strengths is None or len(strengths) != len(times):
        strengths = np.ones(len(times))
    strengths = np.asarray(strengths, dtype=float)
    n = len(y)
    deltas = np.diff(times)
    gap_prev = np.concatenate([[np.inf], deltas])
    gap_next = np.concatenate([deltas, [np.inf]])
    attack_times = []
    for i in range(len(times)):
        pre_sec = min(0.05, 0.45 * gap_prev[i])
        post_sec = min(0.02, 0.45 * gap_next[i])
        start_sample = max(0, int(round((times[i] - pre_sec) * sr)))
        end_sample = min(n, int(round((times[i] + post_sec) * sr)))
        y_seg = y[start_sample:end_sample]
        a_time = _get_attack_time(y_seg, sr)
        attack_times.append(a_time)
    attack_times = np.array(attack_times)
    attack_times = median_filter(attack_times, size=3, mode="nearest")
    safe_attack = np.clip(attack_times, 0.1, None)
    clarity_raw = strengths * (1.0 / safe_attack)
    clarity_score = robust_norm(clarity_raw, method="percentile")
    clarity_score = np.clip(
        clarity_score,
        np.percentile(clarity_score, 1),
        np.percentile(clarity_score, 99),
    )
    return clarity_score
