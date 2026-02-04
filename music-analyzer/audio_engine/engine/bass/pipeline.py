"""
[LEGACY] 베이스 스템 전체 파이프라인.
bass.wav → pitch → energy → note segmentation → simplify → bass dict (notes).
새 계획 제공 후 교체 예정.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import librosa
import numpy as np

from audio_engine.engine.bass.constants import (
    BASS_HOP_LENGTH,
    MIN_SEGMENT_DURATION_SEC,
    RDP_EPSILON_SEMITONE,
)
from audio_engine.engine.bass.pitch_tracking import compute_pitch_pyin
from audio_engine.engine.bass.energy_envelope import compute_bass_energy_envelope
from audio_engine.engine.bass.curve_clean_segment import clean_and_segment_pitch_curve
from audio_engine.engine.bass.curve_simplify import simplify_curve_rdp
from audio_engine.engine.bass.export import build_bass_output


def run_bass_pipeline(
    bass_wav_path: Path | str,
    sr: int | None = None,
    *,
    hop_length: int = BASS_HOP_LENGTH,
    min_segment_duration_sec: float = MIN_SEGMENT_DURATION_SEC,
    epsilon_semitone: float = RDP_EPSILON_SEMITONE,
) -> dict[str, Any]:
    """
    bass.wav 한 파일에 대해 전체 파이프라인 실행.

    Returns:
        {"notes": [...], "render": {...}} — write_streams_sections_json(..., bass=...)에 전달.
    """
    path = Path(bass_wav_path)
    if not path.exists():
        raise FileNotFoundError(f"bass wav 없음: {path}")
    y, sr_load = librosa.load(str(path), sr=sr, mono=True)
    if sr is None:
        sr = sr_load
    else:
        if sr != sr_load:
            y, _ = librosa.load(str(path), sr=sr, mono=True)

    times, pitch_hz, confidence = compute_pitch_pyin(y, sr, hop_length=hop_length)
    n_frames = len(times)
    energy = compute_bass_energy_envelope(y, sr, n_frames, hop_length=hop_length)

    notes = clean_and_segment_pitch_curve(
        times,
        pitch_hz,
        confidence,
        energy,
        min_segment_duration_sec=min_segment_duration_sec,
        absorb_short_segments=True,
        sr=sr,
        hop_length=hop_length,
    )

    for seg in notes:
        t_seg, p_seg = seg["pitch_curve"]
        t_simple, p_simple = simplify_curve_rdp(
            np.asarray(t_seg),
            np.asarray(p_seg),
            epsilon_semitone=epsilon_semitone,
        )
        seg["simplified_curve"] = (t_simple, p_simple)

    return build_bass_output(notes)
