"""
피치 곡선 정제 및 note 구간 분리.
Step A: confidence/스파이크 제거.
Step B: 경계 = (NaN / pitch jump) + energy onset → onset 하나당 노트 후보 1개 (고정 창 NOTE_WIN).
Step C: 최소 지속 시간 미만만 이전 음에 병합. energy_peak 감소 시 병합 안 함 (별도 노트).
Step D: decay_end, attack_time, decay_time, pitch_center/min/max 계산.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import librosa
from scipy.signal import find_peaks

from audio_engine.engine.bass.constants import (
    JUMP_SEMITONE,
    CONFIDENCE_THRESHOLD,
    MIN_SEGMENT_DURATION_SEC,
    MIN_NOTE_DURATION_SEC,
    NOTE_WIN_SEC,
    DECAY_ENERGY_RATIO,
    ENERGY_DROP_NO_MERGE_RATIO,
    ENERGY_PEAK_MIN_DISTANCE_FRAMES,
    ENERGY_PEAK_HEIGHT_PERCENTILE,
    ENERGY_ONSET_LOOKBACK_FRAMES,
    ENERGY_RISE_DERIV_PERCENTILE,
    ENERGY_RISE_MIN_GAP_FRAMES,
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
    jump_semitone: float = JUMP_SEMITONE,
    confidence_threshold: float = CONFIDENCE_THRESHOLD,
    min_segment_duration_sec: float = MIN_SEGMENT_DURATION_SEC,
    absorb_short_segments: bool = True,
    min_note_duration_sec: float = MIN_NOTE_DURATION_SEC,
    decay_energy_ratio: float = DECAY_ENERGY_RATIO,
    sr: int | None = None,
    hop_length: int | None = None,
) -> list[dict[str, Any]]:
    """
    Step A: confidence 낮은 frame NaN, 1프레임 스파이크 제거.
    Step B: energy onset(derivative > threshold)으로 segment 경계.
    Step C: min_note_duration_sec 미만 segment는 이전 note에 흡수.
    Step D: decay_end, attack_time, decay_time, pitch_center/min/max.

    Returns:
        notes: list of {
            "start", "end", "duration", "start_idx", "end_idx",
            "pitch_curve", "pitch_center", "pitch_min", "pitch_max",
            "pitch_median", "energy_curve", "energy_peak", "energy_mean",
            "attack_time", "decay_time", "confidence",
        }
    """
    pitch = pitch_hz.copy()
    low_conf = confidence < confidence_threshold
    pitch[low_conf] = np.nan
    pitch = _remove_one_frame_spikes(pitch, confidence, jump_semitone)

    n = len(times)
    if n == 0:
        return []

    # Step B-1: NaN / pitch jump 기준 경계 (pitch 연속 구간의 시작 인덱스)
    pitch_midi = np.array([hz_to_midi(float(p)) if np.isfinite(p) and p > 0 else np.nan for p in pitch])
    pitch_boundaries: set[int] = {0}
    i = 0
    while i < n:
        if not np.isfinite(pitch_midi[i]):
            i += 1
            continue
        pitch_boundaries.add(i)
        j = i + 1
        while j < n:
            if not np.isfinite(pitch_midi[j]):
                break
            if abs(pitch_midi[j] - pitch_midi[j - 1]) > jump_semitone:
                break
            j += 1
        i = j
        if i < n and not np.isfinite(pitch_midi[i]):
            i += 1

    # Step B-2: energy peak → onset + energy 상승 시작 → onset (같은 피치 반복 노트 분리)
    energy_finite = np.asarray(energy, dtype=np.float64)
    energy_finite[~np.isfinite(energy_finite)] = 0.0
    onset_set: set[int] = set()

    lookback = max(1, min(ENERGY_ONSET_LOOKBACK_FRAMES, n // 2))
    lookback_rise = max(10, min(ENERGY_ONSET_LOOKBACK_FRAMES, n // 2))
    height_th = float(np.nanpercentile(energy_finite[energy_finite > 0], ENERGY_PEAK_HEIGHT_PERCENTILE)) if np.any(energy_finite > 0) else 0.0
    distance_frames = max(1, min(ENERGY_PEAK_MIN_DISTANCE_FRAMES, n // 4))

    # (a) 골(local min) 다음 상승 구간의 시작을 onset으로 (피크가 둔해도 attack 포착)
    neg_energy = -energy_finite
    valleys, _ = find_peaks(neg_energy, distance=max(2, distance_frames))
    rise_th = 0.03  # energy가 골 대비 이만큼 상승하면 onset
    for v in valleys:
        v_val = float(energy_finite[v])
        for j in range(v + 1, min(v + lookback_rise, n)):
            if energy_finite[j] - v_val >= rise_th:
                onset_set.add(j)
                break
    # (a') 피크 앞 최소점도 onset 후보로 추가
    peaks, _ = find_peaks(energy_finite, height=height_th, distance=distance_frames)
    for p in peaks:
        start = max(0, p - lookback)
        window = energy_finite[start : p + 1]
        if len(window) == 0:
            continue
        onset_rel = int(np.argmin(window))
        onset_set.add(start + onset_rel)

    # (b) energy 상승 시작(derivative) → onset 후보
    diff = np.diff(energy_finite)
    pos_diff = diff[diff > 0]
    deriv_th = float(np.percentile(pos_diff, ENERGY_RISE_DERIV_PERCENTILE)) if len(pos_diff) > 0 else 0.0
    rise = np.zeros(n, dtype=bool)
    rise[1:] = diff > max(deriv_th, 1e-9)
    min_gap = max(1, min(ENERGY_RISE_MIN_GAP_FRAMES, n // 10))
    i = 0
    while i < n:
        if not rise[i]:
            i += 1
            continue
        onset_set.add(i)
        i += 1
        while i < n and rise[i]:
            i += 1
        i += min_gap

    # (c) librosa onset_detect on energy envelope (노트 수 확보)
    if sr is not None and hop_length is not None and n > hop_length:
        onset_frames = librosa.onset.onset_detect(
            onset_envelope=energy_finite,
            sr=sr,
            hop_length=hop_length,
            units="frames",
            delta=0.03,
            wait=2,
        )
        for idx in onset_frames:
            if 0 <= idx < n:
                onset_set.add(int(idx))

    # Step B-3: onset 하나당 노트 후보 1개 (고정 창 NOTE_WIN). min_dur 무시로 경계 축소 안 함.
    all_starts = sorted(pitch_boundaries | onset_set)
    frame_dur = float(times[1] - times[0]) if len(times) >= 2 and times[1] > times[0] else 0.01
    note_win_frames = max(2, int(NOTE_WIN_SEC / frame_dur))
    segment_starts = all_starts
    segment_ends = [min(s + note_win_frames, n) for s in segment_starts]

    # pitch NaN이어도 에너지 있으면 노트 후보 유지 (원인 A 대응: pyin 누락 구간도 노트로 남김)
    segments: list[dict[str, Any]] = []
    energy_floor = 1e-12
    for start_idx, end_idx in zip(segment_starts, segment_ends):
        if start_idx >= end_idx:
            continue
        t_seg = times[start_idx:end_idx]
        p_seg = pitch[start_idx:end_idx]
        e_seg = energy[start_idx:end_idx]
        c_seg = confidence[start_idx:end_idx]
        valid = np.isfinite(p_seg) & (p_seg > 0)
        has_energy = np.max(e_seg) > energy_floor if len(e_seg) > 0 else False
        if np.sum(valid) == 0 and not has_energy:
            continue
        dur = float(t_seg[-1] - t_seg[0]) if len(t_seg) >= 2 else 0.0
        if np.sum(valid) == 0:
            pitch_median = pitch_min = pitch_max = float("nan")
        else:
            pitch_median_hz = np.nanmedian(p_seg[valid])
            pitch_median = hz_to_midi(pitch_median_hz)
            p_midi_seg = np.array([hz_to_midi(float(x)) if np.isfinite(x) and x > 0 else np.nan for x in p_seg])
            valid_midi = np.isfinite(p_midi_seg)
            pitch_min = float(np.nanmin(p_midi_seg[valid_midi])) if np.any(valid_midi) else pitch_median
            pitch_max = float(np.nanmax(p_midi_seg[valid_midi])) if np.any(valid_midi) else pitch_median
        segments.append({
            "start": float(t_seg[0]),
            "end": float(t_seg[-1]),
            "duration": dur,
            "start_idx": start_idx,
            "end_idx": end_idx,
            "pitch_median": float(pitch_median),
            "pitch_center": float(pitch_median),
            "pitch_min": pitch_min,
            "pitch_max": pitch_max,
            "pitch_curve": (t_seg.copy(), p_seg.copy()),
            "energy_mean": float(np.mean(e_seg)),
            "energy_peak": float(np.max(e_seg)),
            "confidence": c_seg.copy(),
        })

    # Step C: 짧은 segment만 이전 note에 흡수. energy_peak 감소 시 병합 안 함 (별도 노트 유지).
    min_dur = min_note_duration_sec if min_note_duration_sec > 0 else min_segment_duration_sec
    if min_dur > 0 and absorb_short_segments and len(segments) > 1:
        merged: list[dict[str, Any]] = []
        i = 0
        while i < len(segments):
            seg = segments[i]
            if seg["duration"] >= min_dur:
                merged.append(seg)
                i += 1
                continue
            if i + 1 < len(segments):
                next_seg = segments[i + 1]
                # 다음 구간 peak이 현재 대비 크게 낮으면 병합 안 함 (energy_drop = 별도 노트)
                peak_cur = seg.get("energy_peak") or 0.0
                peak_next = next_seg.get("energy_peak") or 0.0
                if peak_cur > 1e-12 and peak_next < peak_cur * ENERGY_DROP_NO_MERGE_RATIO:
                    merged.append(seg)
                    i += 1
                    continue
                t0, p0 = seg["pitch_curve"]
                t1, p1 = next_seg["pitch_curve"]
                t_comb = np.concatenate([t0, t1])
                p_comb = np.concatenate([p0, p1])
                valid = np.isfinite(p_comb) & (p_comb > 0)
                next_seg["start"] = float(t_comb[0])
                next_seg["end"] = float(t_comb[-1])
                next_seg["duration"] = float(t_comb[-1] - t_comb[0])
                next_seg["start_idx"] = int(seg["start_idx"])
                next_seg["end_idx"] = int(next_seg["end_idx"])
                next_seg["pitch_curve"] = (t_comb, p_comb)
                if np.sum(valid) > 0:
                    med_hz = np.nanmedian(p_comb[valid])
                    next_seg["pitch_median"] = float(hz_to_midi(med_hz))
                    next_seg["pitch_center"] = float(hz_to_midi(med_hz))
                    p_midi = np.array([hz_to_midi(float(x)) for x in p_comb if np.isfinite(x) and x > 0])
                    if len(p_midi) > 0:
                        next_seg["pitch_min"] = float(np.min(p_midi))
                        next_seg["pitch_max"] = float(np.max(p_midi))
                else:
                    next_seg["pitch_median"] = next_seg["pitch_center"] = float("nan")
                    next_seg["pitch_min"] = next_seg["pitch_max"] = float("nan")
                next_seg["energy_mean"] = float(np.mean(np.concatenate([
                    np.atleast_1d(seg.get("energy_mean", 0)),
                    np.atleast_1d(next_seg["energy_mean"]),
                ])))
                next_seg["energy_peak"] = max(seg.get("energy_peak", 0), next_seg["energy_peak"])
                c0, c1 = seg.get("confidence"), next_seg.get("confidence")
                if c0 is not None and c1 is not None:
                    next_seg["confidence"] = np.concatenate([np.atleast_1d(c0), np.atleast_1d(c1)])
                i += 1
                continue
            if merged and merged[-1]["duration"] < min_dur * 2:
                prev = merged[-1]
                # 현재 구간 peak이 이전 대비 크게 낮으면 병합 안 함
                peak_prev = prev.get("energy_peak") or 0.0
                peak_cur = seg.get("energy_peak") or 0.0
                if peak_prev > 1e-12 and peak_cur < peak_prev * ENERGY_DROP_NO_MERGE_RATIO:
                    merged.append(seg)
                    i += 1
                    continue
                t0, p0 = prev["pitch_curve"]
                t1, p1 = seg["pitch_curve"]
                t_comb = np.concatenate([t0, t1])
                p_comb = np.concatenate([p0, p1])
                valid = np.isfinite(p_comb) & (p_comb > 0)
                prev["end"] = float(t_comb[-1])
                prev["duration"] = float(t_comb[-1] - t_comb[0])
                prev["end_idx"] = int(seg["end_idx"])
                prev["pitch_curve"] = (t_comb, p_comb)
                if np.sum(valid) > 0:
                    med_hz = np.nanmedian(p_comb[valid])
                    prev["pitch_median"] = float(hz_to_midi(med_hz))
                    prev["pitch_center"] = float(hz_to_midi(med_hz))
                    p_midi = np.array([hz_to_midi(float(x)) for x in p_comb if np.isfinite(x) and x > 0])
                    if len(p_midi) > 0:
                        prev["pitch_min"] = min(prev.get("pitch_min", 999), float(np.min(p_midi)))
                        prev["pitch_max"] = max(prev.get("pitch_max", -999), float(np.max(p_midi)))
                else:
                    prev["pitch_median"] = prev["pitch_center"] = float("nan")
                    prev["pitch_min"] = prev["pitch_max"] = float("nan")
                prev["energy_peak"] = max(prev["energy_peak"], seg.get("energy_peak", 0))
                c_prev, c_seg = prev.get("confidence"), seg.get("confidence")
                if c_prev is not None and c_seg is not None:
                    prev["confidence"] = np.concatenate([np.atleast_1d(c_prev), np.atleast_1d(c_seg)])
                i += 1
                continue
            merged.append(seg)
            i += 1
        segments = merged

    # Step D: decay_end, attack_time, decay_time; pitch/energy_curve를 decay_end까지 자름
    for seg in segments:
        start_idx = int(seg["start_idx"])
        end_idx = int(seg["end_idx"])
        e_seg = energy[start_idx:end_idx]
        t_seg = times[start_idx:end_idx]
        t_arr, p_arr = seg["pitch_curve"]
        if len(e_seg) == 0:
            seg["attack_time"] = 0.0
            seg["decay_time"] = 0.0
            seg["energy_curve"] = []
            continue
        peak_idx = int(np.argmax(e_seg))
        peak_val = float(e_seg[peak_idx])
        th = peak_val * decay_energy_ratio
        decay_inds = np.where(e_seg >= th)[0]
        decay_end_idx_rel = int(decay_inds[-1]) if len(decay_inds) > 0 else len(e_seg) - 1
        decay_end_idx = min(start_idx + decay_end_idx_rel, n - 1)
        span = decay_end_idx - start_idx + 1
        t_end_decay = float(times[decay_end_idx])
        t_peak = float(t_seg[peak_idx])
        t_start = float(t_seg[0])
        seg["end"] = t_end_decay
        seg["duration"] = t_end_decay - t_start
        seg["end_idx"] = decay_end_idx
        seg["attack_time"] = max(0.0, t_peak - t_start)
        seg["decay_time"] = max(0.0, t_end_decay - t_peak)
        seg["energy_curve"] = energy[start_idx : decay_end_idx + 1].tolist()
        seg["pitch_curve"] = (np.asarray(t_arr)[:span].copy(), np.asarray(p_arr)[:span].copy())

    return segments
