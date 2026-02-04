from __future__ import annotations

"""
보컬 포인트 추출.

[USE_PHRASE=False] phrase 없이: 전체 pitch 선 하나 + Turn 포인트만.
- Turn: pitch 방향 전환(상승→하강, 하강→상승), |Δpitch|≥2 semitone, 전후 각 300ms 유지.
- 20초 기준 2~4개: extremum 후보 중 |Δpitch| 큰 순, 골고루 퍼지게 선택.

[USE_PHRASE=True, 주석 처리됨] phrase 기반 로직(onset/gesture)은 비활성화.
"""
# phrase 로직 전부 끄기 → 선 + Turn 포인트만
USE_PHRASE = False

# Turn 포인트 상수 (phrase 없이 전체 구간 기준)
TURN_MIN_SEMITONE = 2.0
TURN_MIN_LEG_SEC = 0.3
TURN_SMOOTH_WINDOW_SEC = 0.10
MIN_DISTANCE_BETWEEN_TURNS_SEC = 2.0
TURNS_PER_20SEC_MIN = 2
TURNS_PER_20SEC_MAX = 4

from typing import Any

import numpy as np
from scipy.ndimage import median_filter
from scipy.signal import savgol_filter

# -----------------------------------------------------------------------------
# 상수 (명세: OR boundary, phrase 최소 길이, gesture 제한)
# -----------------------------------------------------------------------------
# Boundary: (amp < AMP_LOW for >= T1_SEC) OR (activation < ACT_LOW for >= T2_SEC)
AMP_LOW = 0.10
ACT_LOW = 0.20
T1_SEC = 0.25
T2_SEC = 0.25
PHRASE_GAP_MIN_SEC = 0.25  # fallback
AMP_VOICED_THRESHOLD = 0.01
PHRASE_MIN_LEN_SEC = 0.8  # 더 작은 phrase 허용
PHRASE_MAX_LEN_SEC = 4.0  # 이보다 길면 최소 activation 지점에서 분할
PHRASE_MIN_MEAN_AMP = 0.06
ONSET_PEAKS_PER_PHRASE_MIN = 3
ONSET_PEAKS_PER_PHRASE_MAX = 4
PHRASE_MAX_GESTURES = 10  # fallback(pitch_gesture) 시 phrase당 최대 개수
PITCH_SMOOTH_WINDOW_SEC = 0.10  # 전환 포인트: 미세 떨림 제거용 (80→100ms)
PITCH_GESTURE_MIN_SEMITONE = 1.2  # 1~2 semitone 권장
PITCH_GESTURE_MIN_LEG_SEC = 0.12  # 꺾임 전/후 유지 시간 (의미 있는 전환만)
GESTURE_INSET_SEC = 0.15  # phrase 경계에서 이 거리 안쪽만 전환 포인트 (경계 제외)
ACCENT_NEAR_GESTURE_SEC = 0.12
ACCENT_MIN_STRENGTH = 0.15
ACCENT_ABOVE_PHRASE_MEDIAN_RATIO = 1.25  # accent: 구간 amp 중앙값의 이 배수 이상일 때만


def _runs_low(t: np.ndarray, mask: np.ndarray, min_dur_sec: float) -> list[tuple[float, float]]:
    """mask True인 구간 중 연속 min_dur_sec 이상인 [start_t, end_t] 리스트."""
    n = len(t)
    if n == 0:
        return []
    out: list[tuple[float, float]] = []
    i = 0
    while i < n:
        if not mask[i]:
            i += 1
            continue
        start_t = float(t[i])
        j = i
        while j < n and mask[j]:
            j += 1
        end_t = float(t[j - 1]) if j > i else start_t
        if end_t - start_t >= min_dur_sec:
            out.append((start_t, end_t))
        i = j
    return out


def _merge_intervals(intervals: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """겹치거나 인접한 구간 병합 후 정렬."""
    if not intervals:
        return []
    sorted_i = sorted(intervals, key=lambda x: x[0])
    merged = [sorted_i[0]]
    for a, b in sorted_i[1:]:
        if a <= merged[-1][1] + 0.02:  # 20ms 이내면 병합
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    return merged


def _find_phrase_starts_or(
    t: np.ndarray,
    amp: np.ndarray,
    activation: np.ndarray | None,
    amp_low: float = AMP_LOW,
    act_low: float = ACT_LOW,
    t1_sec: float = T1_SEC,
    t2_sec: float = T2_SEC,
    gap_min_sec: float = PHRASE_GAP_MIN_SEC,
) -> list[tuple[float, float]]:
    """
    OR boundary: (amp < amp_low for >= t1_sec) OR (activation < act_low for >= t2_sec) 인 구간 후 첫 t가 phrase_start.
    activation이 없으면 amp만 사용 (gap_min_sec).
    Returns: [(t_phrase_start, gap_duration), ...]
    """
    n = len(t)
    if n == 0:
        return []
    intervals: list[tuple[float, float]] = []
    low_amp = amp < amp_low
    for (start_t, end_t) in _runs_low(t, low_amp, t1_sec):
        intervals.append((start_t, end_t))
    if activation is not None and len(activation) == n:
        low_act = np.asarray(activation, dtype=np.float64) < act_low
        for (start_t, end_t) in _runs_low(t, low_act, t2_sec):
            intervals.append((start_t, end_t))
    if not intervals:
        # fallback: amp만, 기존 로직
        voiced = amp >= AMP_VOICED_THRESHOLD
        out = []
        i = 0
        while i < n:
            if voiced[i]:
                i += 1
                continue
            j = i
            while j < n and not voiced[j]:
                j += 1
            gap_dur = (float(t[j - 1]) - float(t[i])) if j > i else 0.0
            if gap_dur >= gap_min_sec and j < n:
                out.append((float(t[j]), gap_dur))
            i = j
        return out
    merged = _merge_intervals(intervals)
    out = []
    for (start_t, end_t) in merged:
        idx_after = np.searchsorted(t, end_t, side="right")
        if idx_after < n:
            out.append((float(t[idx_after]), end_t - start_t))
    return out


def _find_phrase_starts(
    t: np.ndarray,
    amp: np.ndarray,
    gap_min_sec: float = PHRASE_GAP_MIN_SEC,
    voiced_th: float = AMP_VOICED_THRESHOLD,
) -> list[tuple[float, float]]:
    """
    (activation 없을 때 fallback) amp < voiced_th 인 구간이 gap_min_sec 초과인 뒤 첫 t를 phrase_start로.
    Returns: [(t_phrase_start, gap_duration), ...]
    """
    n = len(t)
    if n == 0:
        return []
    voiced = amp >= voiced_th
    out: list[tuple[float, float]] = []
    i = 0
    while i < n:
        if voiced[i]:
            i += 1
            continue
        gap_start_t = t[i]
        j = i
        while j < n and not voiced[j]:
            j += 1
        gap_end_t = t[j - 1] if j > i else gap_start_t
        gap_dur = gap_end_t - gap_start_t
        if gap_dur >= gap_min_sec and j < n:
            phrase_start_t = t[j]
            out.append((phrase_start_t, gap_dur))
        i = j
    return out


def _phrase_segments(
    t: np.ndarray,
    amp: np.ndarray,
    phrase_starts: list[tuple[float, float]],
    duration_sec: float,
    voiced_th: float = AMP_VOICED_THRESHOLD,
) -> list[tuple[float, float]]:
    """phrase_starts로부터 [start, end] 구간 리스트. 트랙 시작~첫 phrase_start도 한 구간으로 포함."""
    segments: list[tuple[float, float]] = []
    t0 = float(t[0]) if len(t) > 0 else 0.0
    if not phrase_starts:
        if len(t) > 0 and np.any(amp >= voiced_th):
            segments.append((t0, duration_sec))
        return segments
    starts = [ps[0] for ps in phrase_starts]
    if t0 < starts[0] and np.any((t >= t0) & (t < starts[0]) & (amp >= voiced_th)):
        segments.append((t0, starts[0]))
    for k, start in enumerate(starts):
        end = starts[k + 1] if k + 1 < len(starts) else duration_sec
        if end > start:
            segments.append((start, end))
    return segments


def _split_long_segments(
    segments: list[tuple[float, float]],
    t: np.ndarray,
    activation: np.ndarray,
    max_len_sec: float,
) -> list[tuple[float, float]]:
    """max_len_sec 초과 구간을 activation이 최소인 지점에서 분할."""
    out: list[tuple[float, float]] = []
    for (s, e) in segments:
        queue = [(s, e)]
        while queue:
            s, e = queue.pop(0)
            if e - s <= max_len_sec:
                out.append((s, e))
                continue
            mask = (t >= s) & (t <= e)
            if np.sum(mask) < 2:
                out.append((s, e))
                continue
            act_masked = np.where(mask, activation, np.inf)
            idx_global = int(np.argmin(act_masked))
            t_split = float(t[idx_global])
            if t_split <= s + 0.1 or t_split >= e - 0.1:
                t_split = s + (e - s) / 2
            if t_split - s <= max_len_sec:
                out.append((s, t_split))
            else:
                queue.append((s, t_split))
            if e - t_split <= max_len_sec:
                out.append((t_split, e))
            else:
                queue.append((t_split, e))
    return out


def _onset_peaks_in_phrase(
    t: np.ndarray,
    activation: np.ndarray,
    phrase_start: float,
    phrase_end: float,
    min_peaks: int = ONSET_PEAKS_PER_PHRASE_MIN,
    max_peaks: int = ONSET_PEAKS_PER_PHRASE_MAX,
) -> list[dict[str, Any]]:
    """phrase [start, end] 내 activation local max 중 강도 순 상위 min~max개를 onset 포인트로."""
    mask = (t >= phrase_start) & (t <= phrase_end)
    if np.sum(mask) < 3:
        return []
    t_ph = np.asarray(t[mask], dtype=np.float64)
    act_ph = np.asarray(activation[mask], dtype=np.float64)
    peaks: list[tuple[float, float]] = []
    for i in range(1, len(act_ph) - 1):
        if act_ph[i] >= act_ph[i - 1] and act_ph[i] >= act_ph[i + 1]:
            peaks.append((float(t_ph[i]), float(act_ph[i])))
    if not peaks:
        return []
    peaks.sort(key=lambda x: x[1], reverse=True)
    n = min(max_peaks, max(min_peaks, len(peaks)))
    chosen = peaks[:n]
    chosen.sort(key=lambda x: x[0])
    return [
        {"t": round(ti, 4), "type": "onset", "strength": round(strength, 4), "score": round(strength, 4)}
        for ti, strength in chosen
    ]


def _smooth_pitch(pitch: np.ndarray, t: np.ndarray, window_sec: float) -> np.ndarray:
    """Savitzky-Golay 또는 median으로 pitch 스무딩. window_sec에 맞는 샘플 수 사용."""
    n = len(pitch)
    if n < 5:
        return pitch.copy()
    # 100 fps 가정 (HOP_SEC=0.01) → window_sec=0.08 → 8 samples, odd 9
    hop = 0.01
    w = max(3, min(n - 2, int(window_sec / hop) | 1))
    try:
        return savgol_filter(pitch.astype(np.float64), w, 2, mode="nearest")
    except Exception:
        return np.asarray(median_filter(pitch, size=min(w, n), mode="nearest"), dtype=np.float64)


def compute_vocal_turns(
    vocal_curve: list[dict[str, Any]],
    duration_sec: float | None = None,
    max_turns_per_20sec: int = TURNS_PER_20SEC_MAX,
) -> list[dict[str, Any]]:
    """
    phrase 없이 전체 곡에서 Turn 포인트만 추출.
    Turn = pitch 방향 전환(상승→하강/하강→상승), |Δpitch|≥2 semitone, 전후 각 300ms 유지.
    20초 기준 2~4개: 후보를 |Δpitch| 큰 순으로 정렬 후, 골고루 퍼지게 선택(가까운 것 병합).
    """
    if len(vocal_curve) < 10:
        return []
    t_arr = np.array([p["t"] for p in vocal_curve], dtype=np.float64)
    pitch = np.array([p.get("pitch", 0) or 0 for p in vocal_curve], dtype=np.float64)
    dur = duration_sec if duration_sec is not None else (float(t_arr[-1]) - float(t_arr[0]) + 0.02)
    valid = np.isfinite(pitch)
    if not np.any(valid):
        return []
    pitch = np.where(valid, pitch, np.nanmean(pitch[valid]))
    p_smooth = _smooth_pitch(pitch, t_arr, TURN_SMOOTH_WINDOW_SEC)
    dt = np.diff(t_arr)
    dp = np.diff(p_smooth)
    dt = np.where(dt <= 0, np.nan, dt)
    slope = np.zeros_like(t_arr)
    slope[:-1] = dp / dt
    slope[-1] = slope[-2] if len(slope) > 1 else 0
    sign_changes: list[int] = []
    for i in range(1, len(slope) - 1):
        if not np.isfinite(slope[i]):
            continue
        if np.isfinite(slope[i - 1]) and np.isfinite(slope[i + 1]):
            if (slope[i - 1] >= 0 and slope[i + 1] <= 0) or (slope[i - 1] <= 0 and slope[i + 1] >= 0):
                sign_changes.append(i)
    merge_within = max(3, int(0.05 / 0.01))
    merged: list[int] = []
    j = 0
    while j < len(sign_changes):
        run = [sign_changes[j]]
        while j + 1 < len(sign_changes) and sign_changes[j + 1] - sign_changes[j] <= merge_within:
            j += 1
            run.append(sign_changes[j])
        prev_idx = merged[-1] if merged else 0
        best = max(run, key=lambda i: abs(p_smooth[i] - float(p_smooth[prev_idx])))
        merged.append(best)
        j += 1
    sign_changes = merged
    candidates: list[dict[str, Any]] = []
    for k, idx in enumerate(sign_changes):
        t_peak = float(t_arr[idx])
        prev_idx = sign_changes[k - 1] if k > 0 else 0
        next_idx = sign_changes[k + 1] if k + 1 < len(sign_changes) else len(t_arr) - 1
        dur_before = t_peak - float(t_arr[prev_idx])
        dur_after = float(t_arr[next_idx]) - t_peak
        if dur_before < TURN_MIN_LEG_SEC or dur_after < TURN_MIN_LEG_SEC:
            continue
        delta = float(p_smooth[idx]) - float(p_smooth[prev_idx])
        if abs(delta) < TURN_MIN_SEMITONE:
            continue
        direction = "up_to_down" if (idx > 0 and slope[idx - 1] > 0) else "down_to_up"
        candidates.append({
            "t": round(t_peak, 4),
            "type": "turn",
            "direction": direction,
            "delta_pitch": round(delta, 4),
            "score": round(abs(delta), 4),
        })
    if not candidates:
        return []
    max_turns = min(TURNS_PER_20SEC_MAX, max(TURNS_PER_20SEC_MIN, int(round(dur / 20.0 * max_turns_per_20sec))))
    candidates.sort(key=lambda g: g.get("score", 0), reverse=True)
    chosen: list[dict[str, Any]] = []
    for g in candidates:
        if len(chosen) >= max_turns:
            break
        if any(abs(g["t"] - c["t"]) < MIN_DISTANCE_BETWEEN_TURNS_SEC for c in chosen):
            continue
        chosen.append(g)
    chosen.sort(key=lambda g: g["t"])
    return chosen


def _pitch_gestures_in_phrase(
    t: np.ndarray,
    pitch: np.ndarray,
    amp: np.ndarray,
    phrase_start: float,
    phrase_end: float,
    min_semitone: float = PITCH_GESTURE_MIN_SEMITONE,
    min_leg_sec: float = PITCH_GESTURE_MIN_LEG_SEC,
    smooth_window_sec: float = PITCH_SMOOTH_WINDOW_SEC,
    max_gestures: int = PHRASE_MAX_GESTURES,
    inset_sec: float = GESTURE_INSET_SEC,
) -> list[dict[str, Any]]:
    """
    phrase 내부에서 "전환 포인트"만: 멜로디 방향이 명확히 바뀌는 지점.
    - 꺾임 전/후로 min_leg_sec 이상 유지된 것만 (미세 떨림 제외).
    - phrase 경계 inset_sec 안쪽만 채택 (경계 제외).
    - score = abs(delta) + 가중치*min(앞구간길이, 뒤구간길이) → 의미 있는 전환이 우선.
    """
    mask = (t >= phrase_start) & (t <= phrase_end)
    if np.sum(mask) < 5:
        return []
    t_ph = np.asarray(t[mask], dtype=np.float64)
    p_ph = np.asarray(pitch[mask], dtype=np.float64)
    a_ph = np.asarray(amp[mask], dtype=np.float64)
    valid = np.isfinite(p_ph)
    if not np.any(valid):
        return []
    p_ph = np.where(valid, p_ph, np.nanmean(p_ph[valid]))
    p_smooth = _smooth_pitch(p_ph, t_ph, smooth_window_sec)
    dt = np.diff(t_ph)
    dp = np.diff(p_smooth)
    dt = np.where(dt <= 0, np.nan, dt)
    slope = np.zeros_like(t_ph)
    slope[:-1] = dp / dt
    slope[-1] = slope[-2] if len(slope) > 1 else 0
    sign_changes: list[int] = []
    for i in range(1, len(slope) - 1):
        if not np.isfinite(slope[i]):
            continue
        if np.isfinite(slope[i - 1]) and np.isfinite(slope[i + 1]):
            if (slope[i - 1] >= 0 and slope[i + 1] <= 0) or (slope[i - 1] <= 0 and slope[i + 1] >= 0):
                sign_changes.append(i)
    # 인접한 부호 변화(스무딩으로 인한 이중 peak) 병합: 한 꺾임당 하나만
    hop = 0.01
    merge_within = max(3, int(0.05 / hop))  # 50ms 이내면 같은 꺾임으로
    merged: list[int] = []
    j = 0
    while j < len(sign_changes):
        run = [sign_changes[j]]
        while j + 1 < len(sign_changes) and sign_changes[j + 1] - sign_changes[j] <= merge_within:
            j += 1
            run.append(sign_changes[j])
        prev_idx = merged[-1] if merged else 0
        best = max(run, key=lambda i: abs(p_smooth[i] - float(p_smooth[prev_idx])))
        merged.append(best)
        j += 1
    sign_changes = merged
    gestures: list[dict[str, Any]] = []
    for k, idx in enumerate(sign_changes):
        t_peak = float(t_ph[idx])
        if t_peak < phrase_start + inset_sec or t_peak > phrase_end - inset_sec:
            continue
        prev_idx = sign_changes[k - 1] if k > 0 else 0
        next_idx = sign_changes[k + 1] if k + 1 < len(sign_changes) else len(t_ph) - 1
        dur_before = t_peak - float(t_ph[prev_idx])
        dur_after = float(t_ph[next_idx]) - t_peak
        if dur_before < min_leg_sec or dur_after < min_leg_sec:
            continue
        p_peak = float(p_smooth[idx])
        delta = p_peak - float(p_smooth[prev_idx])
        if abs(delta) < min_semitone:
            continue
        direction = "up_to_down" if (idx > 0 and slope[idx - 1] > 0) else "down_to_up"
        leg_sec = min(dur_before, dur_after)
        salience = abs(delta) + 2.0 * leg_sec  # 의미 있는 전환 = 변화량 + 유지 구간
        gestures.append({
            "t": round(t_peak, 4),
            "type": "pitch_gesture",
            "direction": direction,
            "delta_pitch": round(delta, 4),
            "score": round(salience, 4),
        })
    if len(gestures) > max_gestures:
        center = (phrase_start + phrase_end) / 2
        gestures = sorted(
            gestures,
            key=lambda g: (g.get("score", 0), -abs(g["t"] - center)),
            reverse=True,
        )[:max_gestures]
        gestures.sort(key=lambda g: g["t"])
    return gestures


def _accents_near_gestures(
    t: np.ndarray,
    amp: np.ndarray,
    phrase_start: float,
    phrase_end: float,
    gesture_times: list[float],
    near_sec: float = ACCENT_NEAR_GESTURE_SEC,
    min_strength: float = ACCENT_MIN_STRENGTH,
    above_median_ratio: float = ACCENT_ABOVE_PHRASE_MEDIAN_RATIO,
) -> list[dict[str, Any]]:
    """phrase 내부에서 amp local max 중, pitch_gesture 근처이고 구간 대비 확실히 강한 것만 accent(강조 포인트)."""
    mask = (t >= phrase_start) & (t <= phrase_end)
    if np.sum(mask) < 3 or not gesture_times:
        return []
    t_ph = t[mask]
    a_ph = np.asarray(amp[mask], dtype=np.float64)
    median_amp = float(np.median(a_ph))
    threshold = max(min_strength, median_amp * above_median_ratio)
    acc: list[dict[str, Any]] = []
    for i in range(1, len(a_ph) - 1):
        if a_ph[i] >= a_ph[i - 1] and a_ph[i] >= a_ph[i + 1] and a_ph[i] >= threshold:
            ti = float(t_ph[i])
            if any(abs(ti - gt) <= near_sec for gt in gesture_times):
                acc.append({
                    "t": round(ti, 4),
                    "type": "accent",
                    "strength": round(float(a_ph[i]), 4),
                    "score": round(float(a_ph[i]), 4),
                })
    return acc


def compute_vocal_phrases(
    vocal_curve: list[dict[str, Any]],
    duration_sec: float | None = None,
    phrase_gap_min_sec: float = PHRASE_GAP_MIN_SEC,
    activation: list[float] | None = None,
    phrase_min_len_sec: float = PHRASE_MIN_LEN_SEC,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    vocal_curve에서 phrase boundary(OR 조건) + phrase 내부 제스처 추출.

    activation이 있으면 (amp < AMP_LOW for >= T1) OR (activation < ACT_LOW for >= T2) 로 boundary.
    vocal_phrases[].gestures에는 pitch_gesture, accent만 포함 (phrase_start 제외, 1급 구조).

    Returns:
        (vocal_phrases, vocal_keypoints_flat)
        vocal_phrases: [{ "start", "end", "gestures": [{ "t", "type": "pitch_gesture"|"accent", ... }] }]
        vocal_keypoints_flat: 기존 호환용 평탄 리스트 (phrase_start, pitch_gesture, accent)
    """
    if len(vocal_curve) < 5:
        return [], []

    t = np.array([p["t"] for p in vocal_curve], dtype=np.float64)
    pitch = np.array([p.get("pitch", 0) or 0 for p in vocal_curve], dtype=np.float64)
    amp = np.array([p.get("amp", 0) or 0 for p in vocal_curve], dtype=np.float64)
    dur = duration_sec if duration_sec is not None else (float(t[-1]) - float(t[0]) + 0.02)

    act_arr = np.array(activation, dtype=np.float64) if activation is not None and len(activation) == len(t) else None
    if act_arr is not None:
        phrase_starts = _find_phrase_starts_or(t, amp, act_arr, gap_min_sec=phrase_gap_min_sec)
    else:
        phrase_starts = _find_phrase_starts(t, amp, gap_min_sec=phrase_gap_min_sec, voiced_th=AMP_VOICED_THRESHOLD)
    segments = _phrase_segments(t, amp, phrase_starts, dur)
    segments = [
        (s, e)
        for s, e in segments
        if (e - s) >= phrase_min_len_sec
        and np.mean(amp[(t >= s) & (t <= e)]) >= PHRASE_MIN_MEAN_AMP
    ]
    if act_arr is not None:
        segments = _split_long_segments(segments, t, act_arr, PHRASE_MAX_LEN_SEC)

    vocal_phrases = []
    flat: list[dict[str, Any]] = []
    phrase_start_times = {round(ps[0], 4) for ps in phrase_starts}

    for (start, end) in segments:
        is_phrase_boundary = round(start, 4) in phrase_start_times
        if is_phrase_boundary:
            gap_dur = next((g for ps_t, g in phrase_starts if abs(ps_t - start) < 0.02), 0.0)
            flat.append({"t": round(start, 4), "type": "phrase_start", "score": round(gap_dur, 4)})

        gestures: list[dict[str, Any]]
        if act_arr is not None:
            gestures = _onset_peaks_in_phrase(
                t, act_arr, start, end,
                min_peaks=ONSET_PEAKS_PER_PHRASE_MIN,
                max_peaks=ONSET_PEAKS_PER_PHRASE_MAX,
            )
            for g in gestures:
                flat.append({"t": g["t"], "type": "onset", "score": g.get("score"), "strength": g.get("strength")})
        else:
            gestures = []
            pitch_gestures = _pitch_gestures_in_phrase(t, pitch, amp, start, end)
            gesture_times = [g["t"] for g in pitch_gestures]
            for g in pitch_gestures:
                gestures.append(g)
                flat.append({
                    "t": g["t"],
                    "type": "pitch_gesture",
                    "direction": g.get("direction"),
                    "delta_pitch": g.get("delta_pitch"),
                    "score": g.get("score"),
                })
            accents = _accents_near_gestures(t, amp, start, end, gesture_times)
            for a in accents:
                gestures.append(a)
                flat.append({"t": a["t"], "type": "accent", "score": a.get("score"), "strength": a.get("strength")})

        vocal_phrases.append({
            "start": round(start, 4),
            "end": round(end, 4),
            "gestures": gestures,
        })

    flat.sort(key=lambda x: x["t"])
    return vocal_phrases, flat
