"""
베이스 키포인트 추출 v2.3: Amplitude Rise + Sustain 기반.
"진폭이 커진 뒤 그 상태가 유지됐다" = 노트. 피치는 노트 검출 후에만 붙인다.

Step A: band-pass 30~250 Hz
Step B: Hilbert envelope (amp = |hilbert(bass_wave)|)
Step C: Rise = amp[t] > median(amp[t-w:t]) * (1+r)
Step D: Sustain = amp[t0 : t0+sustain_win] >= amp[t0] * sustain_ratio → 노트
Step E: 노트 블록 (start, end), duration < 60ms 버림
Step F: 각 노트 블록에 pyin으로 피치 붙이기
Step G: energy_mean이 임계값 미만이면 노이즈로 제거
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import librosa
import numpy as np
from scipy.signal import hilbert, butter, sosfiltfilt

from audio_engine.engine.bass.export import build_bass_output
from audio_engine.engine.utils import hz_to_midi

# -----------------------------------------------------------------------------
# 상수 (v2.3)
# -----------------------------------------------------------------------------
BAND_LOW_HZ = 30.0
BAND_HIGH_HZ = 250.0
BAND_ORDER = 4

# 엔벨로프: 10ms 그리드
HOP_SEC = 0.01

# Step C: Rise — "연속 sustain 위 re-attack"도 잡기 위해 기울기 + (상대|절대) 상승
# 상대비율만 쓰면 baseline이 높을 때 2~4번째 노트 탈락 → 기울기·절대상승 추가
RISE_WINDOW_SEC = 0.03
RISE_RATIO = 0.15                    # (A) 상대: amp[t] > baseline * (1+r)
RISE_BASELINE_PERCENTILE = 25
RISE_AMP_DELTA_MIN_RATIO = 0.08      # (B) 절대: amp[t]-baseline >= global_median * this
RISE_SLOPE_MIN_RATIO = 0.02          # (C) 기울기: slope >= global_median * this
# 최종 rise: cond_slope and (cond_ratio or cond_abs)
# baseline이 0/거의 무음일 때: 상대 조건 불가 → 절대 진폭+기울기로만 인정
RISE_SILENCE_AMP_MIN_RATIO = 0.1   # amp[t] >= global_median*이 값 이면 "무음 직후 타격" rise

# Step D: sustain — 빨리 감소하는 피크도 통과하려면 "구간 앞쪽(attack)만" 봄
SUSTAIN_WIN_SEC = 0.04   # 검사 구간 길이
SUSTAIN_RATIO = 0.4      # 앞쪽 절반 평균 >= amp[i0]*sustain_ratio 이면 통과
SUSTAIN_USE_FRONT_HALF_ONLY = True  # True면 구간 앞쪽 절반만 평균 → 빠른 감쇠도 통과

# Step E: 노트 블록 — 연속 베이스에서 end가 늦어지면 다음 rise 연쇄 탈락 방지
MIN_NOTE_DURATION_SEC = 0.05
DECAY_RATIO = 0.5              # 0.35→0.5: end 완화해 다음 rise 구간 덜 왜곡
MAX_NOTE_DURATION_SEC = 0.6

# 인접 노트: 같은 히트로 보이는 중복만 제거 (너무 크면 연속 노트 연쇄 탈락)
MIN_GAP_BETWEEN_STARTS_SEC = 0.02

# 천천히 증가하는 노트: 같은 피치 + 구간 내 골 없을 때만 병합 (피치 바뀌면 별도 노트 유지)
SLOW_RAMP_MAX_GAP_SEC = 0.15   # 이 구간 안 + 같은 피치 + 골 없으면 한 노트로 병합
SLOW_RAMP_DIP_RATIO = 0.7      # min(amp) >= amp[start1]*이 값 이면 골 없음

# 에너지 필터: 평균 진폭이 이 값 미만이면 노이즈로 제거 (약한 피크도 노트로 인정)
ENERGY_MEAN_MIN = 0.2

# 인접 같은 피치: 같은 피치인데 시작 시각이 이 값 이내면 하나만 유지 (에너지 큰 쪽)
PITCH_SAME_TOLERANCE = 0.35   # MIDI 반음 이내 = 같은 피치
ADJACENT_SAME_PITCH_MAX_GAP_SEC = 0.8

# Step F: 피치 (pyin per segment)
PYIN_FMIN = 50.0
PYIN_FMAX = 250.0
PYIN_FRAME_LENGTH = 2048
PYIN_HOP = 256
DEFAULT_PITCH_HZ = 80.0


def _bandpass(y: np.ndarray, sr: float, low: float, high: float, order: int) -> np.ndarray:
    """Band-pass filter 30~250 Hz. Returns filtered waveform."""
    nyq = 0.5 * sr
    low_n = max(low / nyq, 0.001)
    high_n = min(high / nyq, 0.999)
    sos = butter(order, [low_n, high_n], btype="band", output="sos")
    return sosfiltfilt(sos, y)


def _hilbert_envelope(y: np.ndarray) -> np.ndarray:
    """Hilbert envelope: attack/decay가 살아 있는 진폭."""
    return np.abs(hilbert(y))


def _envelope_to_grid(y: np.ndarray, sr: int, hop_sec: float) -> tuple[np.ndarray, np.ndarray]:
    """전체 오디오 Hilbert envelope 후 hop_sec 간격 그리드로 평균. 반환: times, amp."""
    envelope = _hilbert_envelope(y)
    hop_samples = int(round(hop_sec * sr))
    n_frames = 1 + (len(envelope) - 1) // hop_samples
    times = np.arange(n_frames, dtype=np.float64) * hop_sec
    amp = np.zeros(n_frames, dtype=np.float64)
    for i in range(n_frames):
        start = i * hop_samples
        end = min(start + hop_samples, len(envelope))
        amp[i] = np.mean(envelope[start:end])
    return times, amp


def _find_rise_indices(
    times: np.ndarray,
    amp: np.ndarray,
    rise_window_sec: float,
    rise_ratio: float,
    baseline_percentile: float = 50.0,
    amp_delta_min_ratio: float | None = None,
    slope_min_ratio: float | None = None,
) -> list[int]:
    """Rise: 기울기 + (상대비율 OR 절대상승) — 연속 sustain 위 re-attack도 잡기.
    amp_delta_min_ratio/slope_min_ratio 둘 다 None이면 기존만: amp[t] > baseline * (1+r).
    """
    n = len(times)
    if n == 0:
        return []
    dt = times[1] - times[0] if n > 1 else 0.01
    w_frames = max(1, int(round(rise_window_sec / dt)))
    out: list[int] = []

    use_slope_abs = amp_delta_min_ratio is not None and slope_min_ratio is not None
    global_median = float(np.median(amp)) if use_slope_abs and n > 0 else 0.0
    if global_median <= 0:
        global_median = 1e-12

    def baseline(w: np.ndarray) -> float:
        if w.size == 0:
            return 0.0
        return float(np.percentile(w, baseline_percentile))

    def is_rise(i: int, ref: float) -> bool:
        # baseline이 0/거의 무음: 상대비율 조건 불가 → "무음 직후 큰 타격"은 절대 진폭+기울기로만 인정
        if ref <= 0 or (global_median > 0 and ref < global_median * 1e-6):
            if not use_slope_abs:
                return amp[i] >= global_median * RISE_SILENCE_AMP_MIN_RATIO
            slope = amp[i] - amp[i - 1] if i >= 1 else 0.0
            cond_slope = slope >= global_median * slope_min_ratio
            return bool(cond_slope and amp[i] >= global_median * RISE_SILENCE_AMP_MIN_RATIO)
        cond_ratio = amp[i] > ref * (1.0 + rise_ratio)
        if not use_slope_abs:
            return cond_ratio
        slope = amp[i] - amp[i - 1] if i >= 1 else 0.0
        cond_slope = slope >= global_median * slope_min_ratio
        cond_abs = (amp[i] - ref) >= global_median * amp_delta_min_ratio
        return bool(cond_slope and (cond_ratio or cond_abs))

    # 초반: i=1..w_frames-1
    for i in range(1, min(w_frames, n)):
        window = amp[0:i]
        if len(window) == 0:
            continue
        ref = baseline(window)
        if is_rise(i, ref):
            out.append(i)
    # 일반: i >= w_frames
    for i in range(w_frames, n):
        window = amp[i - w_frames : i]
        if len(window) == 0:
            continue
        ref = baseline(window)
        if is_rise(i, ref):
            out.append(i)
    return out


def _time_to_frame(times: np.ndarray, t: float) -> int:
    """시간 t에 대응하는 프레임 인덱스 (0 ~ len(times)-1)."""
    if len(times) == 0:
        return 0
    i = int(np.searchsorted(times, t, side="right")) - 1
    return max(0, min(i, len(times) - 1))


def _merge_notes_same_pitch_no_dip(
    notes: list[dict[str, Any]],
    times: np.ndarray,
    amp: np.ndarray,
    max_gap_sec: float,
    dip_ratio: float,
    pitch_tolerance: float = PITCH_SAME_TOLERANCE,
) -> list[dict[str, Any]]:
    """같은 피치 + 구간 내 골 없을 때만 인접 노트 병합. 피치가 바뀌면 별도 노트로 유지."""
    if len(notes) <= 1:
        return list(notes)
    sorted_notes = sorted(notes, key=lambda n: n["start"])
    out: list[dict[str, Any]] = [sorted_notes[0]]
    for n2 in sorted_notes[1:]:
        n1 = out[-1]
        pc1 = n1.get("pitch_center")
        pc2 = n2.get("pitch_center")
        if pc1 is None or pc2 is None or not np.isfinite(pc1) or not np.isfinite(pc2):
            out.append(n2)
            continue
        if n2["start"] - n1["start"] > max_gap_sec:
            out.append(n2)
            continue
        if abs(float(pc1) - float(pc2)) > pitch_tolerance:
            out.append(n2)
            continue
        i1 = _time_to_frame(times, n1["start"])
        i2 = _time_to_frame(times, n2["start"])
        if i2 <= i1:
            out.append(n2)
            continue
        seg = amp[i1 : i2 + 1]
        if seg.size == 0:
            out.append(n2)
            continue
        min_amp = float(np.min(seg))
        threshold = amp[i1] * dip_ratio
        if min_amp < threshold:
            out.append(n2)
            continue
        # 같은 피치 + 골 없음 → 하나로 병합 (n1 확장)
        j_end = _time_to_frame(times, n2["end"])
        seg_merged = amp[i1 : j_end + 1] if j_end + 1 <= len(amp) else amp[i1:]
        merged = {
            "start": n1["start"],
            "end": n2["end"],
            "duration": n2["end"] - n1["start"],
            "pitch_curve": (
                np.array([n1["start"], n2["end"]], dtype=np.float64),
                np.array([n1["pitch_center_hz"], n1["pitch_center_hz"]], dtype=np.float64),
            ),
            "pitch_center": n1["pitch_center"],
            "pitch_center_hz": n1["pitch_center_hz"],
            "pitch_median": n1["pitch_median"],
            "energy_peak": float(np.max(seg_merged)) if len(seg_merged) else n1["energy_peak"],
            "energy_mean": float(np.mean(seg_merged)) if len(seg_merged) else n1["energy_mean"],
            "attack_time": n1.get("attack_time", 0.0),
            "decay_time": n1.get("decay_time", 0.0),
        }
        out[-1] = merged
    return out


def _sustain_ok(
    amp: np.ndarray,
    i0: int,
    sustain_win_frames: int,
    sustain_ratio: float,
    use_front_half_only: bool = False,
) -> bool:
    """평균 진폭이 임계값 이상이면 True.
    use_front_half_only=True: 구간 앞쪽 절반만 평균 → 빨리 감소하는 피크도 통과.
    """
    n = len(amp)
    end = min(i0 + sustain_win_frames, n)
    if end <= i0:
        return False
    if use_front_half_only:
        half = (end - i0 + 1) // 2
        if half < 1:
            half = 1
        end = min(i0 + half, n)
    threshold = amp[i0] * sustain_ratio
    seg = amp[i0:end]
    return bool(np.mean(seg) >= threshold - 1e-12)


def _note_end_index(
    amp: np.ndarray,
    i0: int,
    decay_ratio: float,
    max_frames: int,
) -> int:
    """i0 이후 amp가 amp[i0]*decay_ratio 이하로 떨어지는 첫 인덱스. 넘지 않으면 i0 + max_frames."""
    n = len(amp)
    threshold = amp[i0] * decay_ratio
    end = min(i0 + max_frames, n)
    for j in range(i0 + 1, end):
        if amp[j] <= threshold:
            return j
    return end


def _rise_indices_to_note_blocks(
    times: np.ndarray,
    amp: np.ndarray,
    rise_indices: list[int],
    sustain_win_sec: float,
    sustain_ratio: float,
    min_duration_sec: float,
    decay_ratio: float,
    max_duration_sec: float,
    min_gap_sec: float,
    use_front_half_only: bool = False,
) -> list[tuple[int, int]]:
    """
    Rise 인덱스 중 sustain 통과한 것만 노트로, (start_frame, end_frame) 리스트 반환.
    use_front_half_only=True: sustain은 구간 앞쪽 절반만 평균 → 빨리 감소하는 피크도 통과.
    """
    if len(times) == 0 or len(amp) == 0:
        return []
    dt = times[1] - times[0] if len(times) > 1 else HOP_SEC
    sustain_frames = max(1, int(round(sustain_win_sec / dt)))
    max_frames = int(round(max_duration_sec / dt))
    min_frames = int(round(min_duration_sec / dt))
    blocks: list[tuple[int, int]] = []
    last_start_t = -1.0

    for i0 in rise_indices:
        if not _sustain_ok(amp, i0, sustain_frames, sustain_ratio, use_front_half_only):
            continue
        t0 = times[i0]
        if t0 - last_start_t < min_gap_sec and blocks:
            continue
        i_end = _note_end_index(amp, i0, decay_ratio, max_frames)
        t_end = times[min(i_end, len(times) - 1)]
        duration = t_end - t0
        if duration < min_duration_sec:
            continue
        blocks.append((i0, i_end))
        last_start_t = t0

    return blocks


def _pitch_for_segment(y: np.ndarray, sr: int, t_start: float, t_end: float) -> float:
    """세그먼트 [t_start, t_end] 구간에 대해 pyin 피치. 실패 시 DEFAULT_PITCH_HZ."""
    start_samp = int(t_start * sr)
    end_samp = int(t_end * sr)
    if start_samp >= end_samp or end_samp > len(y):
        return DEFAULT_PITCH_HZ
    seg = y[start_samp:end_samp]
    if len(seg) < PYIN_FRAME_LENGTH // 2:
        return DEFAULT_PITCH_HZ
    try:
        hop_len = max(1, min(PYIN_HOP, len(seg) // 4))
        f0, *_ = librosa.pyin(
            seg,
            fmin=PYIN_FMIN,
            fmax=PYIN_FMAX,
            sr=sr,
            hop_length=hop_len,
            frame_length=min(PYIN_FRAME_LENGTH, len(seg)),
            fill_na=np.nan,
            center=True,
        )
        if f0 is None or f0.size == 0:
            return DEFAULT_PITCH_HZ
        f0_flat = np.asarray(f0).flatten()
        valid = f0_flat[np.isfinite(f0_flat) & (f0_flat > 0)]
        if valid.size == 0:
            return DEFAULT_PITCH_HZ
        return float(np.median(valid))
    except Exception:
        return DEFAULT_PITCH_HZ


def _blocks_to_notes(
    blocks: list[tuple[int, int]],
    times: np.ndarray,
    amp: np.ndarray,
    y: np.ndarray,
    sr: int,
) -> list[dict[str, Any]]:
    """(start_frame, end_frame) → build_bass_output 호환 note dict. 피치 붙임."""
    notes: list[dict[str, Any]] = []
    for i0, i_end in blocks:
        t0 = times[i0]
        t_end = times[min(i_end, len(times) - 1)]
        duration = t_end - t0
        seg_amp = amp[i0:i_end] if i_end <= len(amp) else amp[i0:]
        energy_peak = float(np.max(seg_amp)) if len(seg_amp) else 0.0
        energy_mean = float(np.mean(seg_amp)) if len(seg_amp) else 0.0
        pitch_hz = _pitch_for_segment(y, sr, t0, t_end)
        pitch_midi = hz_to_midi(pitch_hz) if np.isfinite(hz_to_midi(pitch_hz)) else 0.0
        t_seg = np.array([t0, t_end], dtype=np.float64)
        p_seg = np.array([pitch_hz, pitch_hz], dtype=np.float64)
        note = {
            "start": t0,
            "end": t_end,
            "duration": duration,
            "pitch_curve": (t_seg, p_seg),
            "pitch_center": pitch_midi,
            "pitch_center_hz": pitch_hz,
            "pitch_median": pitch_midi,
            "energy_peak": energy_peak,
            "energy_mean": energy_mean,
            "attack_time": 0.0,
            "decay_time": 0.0,
        }
        notes.append(note)
    return notes


def _filter_notes_by_energy(
    notes: list[dict[str, Any]],
    energy_mean_min: float = ENERGY_MEAN_MIN,
) -> list[dict[str, Any]]:
    """energy_mean이 energy_mean_min 미만인 노트는 노이즈로 판단하고 제거."""
    return [n for n in notes if n.get("energy_mean", 0.0) >= energy_mean_min]


def _filter_adjacent_same_pitch(
    notes: list[dict[str, Any]],
    pitch_tolerance: float = PITCH_SAME_TOLERANCE,
    max_gap_sec: float = ADJACENT_SAME_PITCH_MAX_GAP_SEC,
) -> list[dict[str, Any]]:
    """같은 피치인데 시작 시각이 max_gap_sec 이내면 하나만 유지(energy_peak 큰 쪽)."""
    if len(notes) <= 1:
        return list(notes)
    sorted_notes = sorted(notes, key=lambda n: n["start"])
    result: list[dict[str, Any]] = []
    for note in sorted_notes:
        pc = note.get("pitch_center")
        if pc is None or not np.isfinite(pc):
            result.append(note)
            continue
        t0 = note["start"]
        found_idx: int | None = None
        for i, r in enumerate(result):
            rc = r.get("pitch_center")
            if rc is None or not np.isfinite(rc):
                continue
            if abs(float(pc) - float(rc)) <= pitch_tolerance and abs(t0 - r["start"]) <= max_gap_sec:
                found_idx = i
                break
        if found_idx is not None:
            if note.get("energy_peak", 0.0) > result[found_idx].get("energy_peak", 0.0):
                result[found_idx] = note
        else:
            result.append(note)
    result.sort(key=lambda n: n["start"])
    return result


def _notes_to_export_format(notes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """build_bass_output(notes)에 넘길 수 있는 형태로 변환."""
    return notes


# -----------------------------------------------------------------------------
# 진입 함수
# -----------------------------------------------------------------------------
def run_bass_v2(bass_wav_path: Path | str, sr: int | None = None) -> dict[str, Any]:
    """
    v2.3: Amplitude Rise + Sustain 기반 노트 검출.
    베이스 대역만 → Hilbert envelope → rise(로컬 기준 증가) + sustain → 노트 블록 → 피치 붙이기.

    Returns:
        {"notes": [...], "render": {...}}
    """
    path = Path(bass_wav_path)
    if not path.exists():
        raise FileNotFoundError(f"bass wav 없음: {path}")
    y, sr_load = librosa.load(str(path), sr=sr, mono=True)
    if sr is None:
        sr = sr_load

    # Step A: band-pass 30~250 Hz
    bass_wave = _bandpass(y, float(sr), BAND_LOW_HZ, BAND_HIGH_HZ, BAND_ORDER)

    # Step B: Hilbert envelope → 10ms 그리드
    times, amp = _envelope_to_grid(bass_wave, sr, HOP_SEC)

    # Step C: rise 인덱스 (기울기 + 상대/절대 상승 — 연속 sustain 위 re-attack 포함)
    rise_indices = _find_rise_indices(
        times,
        amp,
        RISE_WINDOW_SEC,
        RISE_RATIO,
        RISE_BASELINE_PERCENTILE,
        amp_delta_min_ratio=RISE_AMP_DELTA_MIN_RATIO,
        slope_min_ratio=RISE_SLOPE_MIN_RATIO,
    )

    # Step D + E: sustain 통과 → 노트 블록, 인접 중복 제거
    blocks = _rise_indices_to_note_blocks(
        times,
        amp,
        rise_indices,
        sustain_win_sec=SUSTAIN_WIN_SEC,
        sustain_ratio=SUSTAIN_RATIO,
        min_duration_sec=MIN_NOTE_DURATION_SEC,
        decay_ratio=DECAY_RATIO,
        max_duration_sec=MAX_NOTE_DURATION_SEC,
        min_gap_sec=MIN_GAP_BETWEEN_STARTS_SEC,
        use_front_half_only=SUSTAIN_USE_FRONT_HALF_ONLY,
    )

    # Step F: 노트 블록 → note dict (피치 붙임)
    notes = _blocks_to_notes(blocks, times, amp, y, sr)
    notes = _filter_notes_by_energy(notes, ENERGY_MEAN_MIN)
    # 같은 피치 + 골 없을 때만 병합 (피치 바뀌면 톡톡 짧은 노트 유지)
    notes = _merge_notes_same_pitch_no_dip(
        notes, times, amp, SLOW_RAMP_MAX_GAP_SEC, SLOW_RAMP_DIP_RATIO, PITCH_SAME_TOLERANCE
    )
    notes = _filter_adjacent_same_pitch(
        notes,
        pitch_tolerance=PITCH_SAME_TOLERANCE,
        max_gap_sec=ADJACENT_SAME_PITCH_MAX_GAP_SEC,
    )
    export_notes = _notes_to_export_format(notes)
    return build_bass_output(export_notes)
