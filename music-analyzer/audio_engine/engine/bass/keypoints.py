"""
베이스 키포인트: pitch_turn, leap, accent.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from audio_engine.engine.bass.constants import (
    LEAP_SEMITONE_THRESHOLD,
    ACCENT_PERCENTILE,
)
from audio_engine.engine.utils import hz_to_midi


def extract_bass_keypoints(
    segments: list[dict[str, Any]],
    times: np.ndarray,
    pitch_hz: np.ndarray,
    energy: np.ndarray,
    *,
    leap_semitone_threshold: float = LEAP_SEMITONE_THRESHOLD,
    accent_percentile: float = ACCENT_PERCENTILE,
) -> list[dict[str, Any]]:
    """
    segment 내 pitch/energy에서 turn, leap, accent 추출.

    Returns:
        list of {"time": t, "type": "pitch_turn"|"leap"|"accent", "pitch": midi?, "energy": e?}
    """
    keypoints: list[dict[str, Any]] = []
    seen_t: set[float] = set()

    def add(t: float, typ: str, pitch: float | None = None, energy_val: float | None = None):
        t_round = round(float(t), 4)
        if t_round in seen_t:
            return
        seen_t.add(t_round)
        entry: dict[str, Any] = {"time": t_round, "type": typ}
        if pitch is not None and np.isfinite(pitch):
            entry["pitch"] = round(float(pitch), 2)
        if energy_val is not None and np.isfinite(energy_val):
            entry["energy"] = round(float(energy_val), 4)
        keypoints.append(entry)

    # accent: 전역 energy percentile 기준 로컬 피크
    if len(energy) > 0 and np.any(np.isfinite(energy)):
        th = np.nanpercentile(energy[np.isfinite(energy)], accent_percentile)
        for i in range(1, len(times) - 1):
            if not np.isfinite(energy[i]):
                continue
            if energy[i] >= th and energy[i] >= energy[i - 1] and energy[i] >= energy[i + 1]:
                p_midi = hz_to_midi(pitch_hz[i]) if np.isfinite(pitch_hz[i]) and pitch_hz[i] > 0 else None
                add(times[i], "accent", p_midi, float(energy[i]))

    for seg in segments:
        t_seg, p_seg = seg["pitch_curve"]
        t_seg = np.asarray(t_seg)
        p_seg = np.asarray(p_seg)
        valid = np.isfinite(p_seg) & (p_seg > 0)
        if np.sum(valid) < 3:
            continue
        midi = np.array([hz_to_midi(float(p)) for p in p_seg])
        start_idx = int(seg.get("start_idx", 0))
        end_idx = int(seg.get("end_idx", len(times)))
        e_seg = energy[start_idx:end_idx] if start_idx < len(energy) and end_idx <= len(energy) else np.array([])
        if len(e_seg) != len(t_seg):
            e_seg = np.zeros(len(t_seg))

        # pitch_turn: 기울기 부호 변경
        for i in range(1, len(t_seg) - 1):
            if not np.isfinite(midi[i]) or not np.isfinite(midi[i - 1]) or not np.isfinite(midi[i + 1]):
                continue
            slope_prev = midi[i] - midi[i - 1]
            slope_next = midi[i + 1] - midi[i]
            if slope_prev * slope_next < 0:
                e_val = float(e_seg[i]) if i < len(e_seg) else None
                add(t_seg[i], "pitch_turn", float(midi[i]), e_val)

        # leap: interval > threshold
        for i in range(1, len(t_seg)):
            if not np.isfinite(midi[i]) or not np.isfinite(midi[i - 1]):
                continue
            delta = abs(midi[i] - midi[i - 1])
            if delta >= leap_semitone_threshold:
                e_val = float(e_seg[i]) if i < len(e_seg) else None
                add(t_seg[i], "leap", float(midi[i]), e_val)

    keypoints.sort(key=lambda x: x["time"])
    return keypoints
