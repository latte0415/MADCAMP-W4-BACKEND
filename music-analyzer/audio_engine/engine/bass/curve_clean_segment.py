"""
피치 곡선 정제 및 지속 구간(segment) 분리.
Step A: 무의미한 흔들림 제거 + 1프레임 스파이크 제거(저주파 오검출 보호).
Step B: NaN / pitch jump 기준 segment 분리.
Step C: duration 하한 미만 segment 흡수 또는 curve에서 제거.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from audio_engine.engine.bass.constants import (
    DELTA_SEMITONE,
    JUMP_SEMITONE,
    CONFIDENCE_THRESHOLD,
    MIN_SEGMENT_DURATION_SEC,
)
from audio_engine.engine.utils import hz_to_midi


def _remove_one_frame_spikes(
    pitch_hz: np.ndarray,
    confidence: np.ndarray,
    jump_semitone: float,
) -> np.ndarray:
    """양옆 frame이 NaN이거나 전혀 다른 pitch면 해당 frame을 NaN 처리."""
    out = pitch_hz.copy()
    n = len(out)
    for i in range(1, n - 1):
        if not np.isfinite(out[i]) or out[i] <= 0:
            continue
        left = out[i - 1]
        right = out[i + 1]
        left_ok = np.isfinite(left) and left > 0
        right_ok = np.isfinite(right) and right > 0
        if not left_ok and not right_ok:
            out[i] = np.nan
            continue
        midi_i = hz_to_midi(out[i])
        if left_ok:
            delta_left = abs(midi_i - hz_to_midi(left))
            if delta_left > jump_semitone:
                if not right_ok or abs(midi_i - hz_to_midi(right)) > jump_semitone:
                    out[i] = np.nan
                    continue
        if right_ok:
            delta_right = abs(midi_i - hz_to_midi(right))
            if delta_right > jump_semitone:
                if not left_ok or abs(midi_i - hz_to_midi(left)) > jump_semitone:
                    out[i] = np.nan
    return out


def clean_and_segment_pitch_curve(
    times: np.ndarray,
    pitch_hz: np.ndarray,
    confidence: np.ndarray,
    energy: np.ndarray,
    *,
    delta_semitone: float = DELTA_SEMITONE,
    jump_semitone: float = JUMP_SEMITONE,
    confidence_threshold: float = CONFIDENCE_THRESHOLD,
    min_segment_duration_sec: float = MIN_SEGMENT_DURATION_SEC,
    absorb_short_segments: bool = True,
) -> list[dict[str, Any]]:
    """
    Step A: confidence 낮은 frame NaN, 1프레임 스파이크 제거.
    Step B: NaN / pitch jump로 segment 분리.
    Step C: min_segment_duration_sec 미만 segment는 앞/뒤에 흡수(absorb_short_segments=True)
            또는 curve에서 제거(keypoint만 유지하려면 False 시 후처리에서 제거).

    Returns:
        segments: list of {
            "start", "end",
            "pitch_median" (MIDI),
            "pitch_curve" (time, pitch_hz per frame),
            "energy_mean", "energy_peak",
            "confidence" (array),
        }
    """
    pitch = pitch_hz.copy()
    # confidence 낮은 frame → NaN
    low_conf = confidence < confidence_threshold
    pitch[low_conf] = np.nan
    # 1프레임 스파이크 제거
    pitch = _remove_one_frame_spikes(pitch, confidence, jump_semitone)

    # pitch → midi for segment boundaries (NaN, jump)
    pitch_midi = np.array([hz_to_midi(float(p)) if np.isfinite(p) and p > 0 else np.nan for p in pitch])

    # Step B: segment 경계 (NaN 또는 jump > jump_semitone)
    n = len(times)
    segment_starts: list[int] = []
    segment_ends: list[int] = []
    i = 0
    while i < n:
        if not np.isfinite(pitch_midi[i]):
            i += 1
            continue
        start = i
        j = i + 1
        while j < n:
            if not np.isfinite(pitch_midi[j]):
                break
            if abs(pitch_midi[j] - pitch_midi[j - 1]) > jump_semitone:
                break
            j += 1
        end = j
        segment_starts.append(start)
        segment_ends.append(end)
        i = j
        if i < n and not np.isfinite(pitch_midi[i]):
            i += 1

    segments: list[dict[str, Any]] = []
    for start, end in zip(segment_starts, segment_ends):
        t_seg = times[start:end]
        p_seg = pitch[start:end]
        e_seg = energy[start:end]
        c_seg = confidence[start:end]
        valid = np.isfinite(p_seg) & (p_seg > 0)
        if np.sum(valid) == 0:
            continue
        dur = float(t_seg[-1] - t_seg[0]) if len(t_seg) >= 2 else 0.0
        pitch_median_hz = np.nanmedian(p_seg[valid])
        pitch_median = hz_to_midi(pitch_median_hz)
        segments.append({
            "start": float(t_seg[0]),
            "end": float(t_seg[-1]),
            "duration": dur,
            "start_idx": start,
            "end_idx": end,
            "pitch_median": float(pitch_median),
            "pitch_curve": (t_seg.copy(), p_seg.copy()),
            "energy_mean": float(np.mean(e_seg)),
            "energy_peak": float(np.max(e_seg)),
            "confidence": c_seg.copy(),
        })

    # Step C: 짧은 segment 흡수 또는 유지(나중에 curve에서만 제거 가능)
    if min_segment_duration_sec > 0 and absorb_short_segments and len(segments) > 1:
        merged: list[dict[str, Any]] = []
        i = 0
        while i < len(segments):
            seg = segments[i]
            if seg["duration"] >= min_segment_duration_sec:
                merged.append(seg)
                i += 1
                continue
            # 짧은 segment: 다음/이전과 합침 (다음 우선)
            if i + 1 < len(segments):
                next_seg = segments[i + 1]
                t0, p0 = seg["pitch_curve"]
                t1, p1 = next_seg["pitch_curve"]
                t_comb = np.concatenate([t0, t1])
                p_comb = np.concatenate([p0, p1])
                valid = np.isfinite(p_comb) & (p_comb > 0)
                if np.sum(valid) > 0:
                    next_seg["start"] = float(t_comb[0])
                    next_seg["end"] = float(t_comb[-1])
                    next_seg["duration"] = float(t_comb[-1] - t_comb[0])
                    next_seg["start_idx"] = int(seg["start_idx"])
                    next_seg["end_idx"] = int(next_seg["end_idx"])
                    next_seg["pitch_curve"] = (t_comb, p_comb)
                    next_seg["pitch_median"] = float(hz_to_midi(np.nanmedian(p_comb[valid])))
                    next_seg["energy_mean"] = float(np.mean(np.concatenate([
                        np.atleast_1d(seg.get("energy_mean", 0)),
                        np.atleast_1d(next_seg["energy_mean"]),
                    ])))
                    next_seg["energy_peak"] = max(seg.get("energy_peak", 0), next_seg["energy_peak"])
                    c0 = seg.get("confidence")
                    c1 = next_seg.get("confidence")
                    if c0 is not None and c1 is not None:
                        next_seg["confidence"] = np.concatenate([np.atleast_1d(c0), np.atleast_1d(c1)])
                i += 1
                continue
            if merged and merged[-1]["duration"] < min_segment_duration_sec * 2:
                prev = merged[-1]
                t0, p0 = prev["pitch_curve"]
                t1, p1 = seg["pitch_curve"]
                t_comb = np.concatenate([t0, t1])
                p_comb = np.concatenate([p0, p1])
                valid = np.isfinite(p_comb) & (p_comb > 0)
                if np.sum(valid) > 0:
                    prev["end"] = float(t_comb[-1])
                    prev["duration"] = float(t_comb[-1] - t_comb[0])
                    prev["end_idx"] = int(seg["end_idx"])
                    prev["pitch_curve"] = (t_comb, p_comb)
                    prev["pitch_median"] = float(hz_to_midi(np.nanmedian(p_comb[valid])))
                    prev["energy_peak"] = max(prev["energy_peak"], seg.get("energy_peak", 0))
                    c_prev = prev.get("confidence")
                    c_seg = seg.get("confidence")
                    if c_prev is not None and c_seg is not None:
                        prev["confidence"] = np.concatenate([np.atleast_1d(c_prev), np.atleast_1d(c_seg)])
                i += 1
                continue
            merged.append(seg)
            i += 1
        segments = merged

    return segments
