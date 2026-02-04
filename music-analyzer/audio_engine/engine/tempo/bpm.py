"""
오디오에서 BPM 및 비트 타임라인 추정.
"""
from __future__ import annotations

import numpy as np
import librosa

from audio_engine.engine.tempo.constants import DEFAULT_HOP_LENGTH


def infer_bpm(
    y: np.ndarray,
    sr: int,
    *,
    hop_length: int = DEFAULT_HOP_LENGTH,
) -> tuple[float, np.ndarray]:
    """
    오디오에서 글로벌 BPM과 비트 시간(초) 배열 추정.

    Returns:
        (bpm, beat_times): BPM(float), 비트 발생 시각 배열(초).
    """
    tempo, beat_frames = librosa.beat.beat_track(
        y=y, sr=sr, hop_length=hop_length, units="frames"
    )
    bpm = float(np.asarray(tempo).flat[0]) if np.size(tempo) > 0 else 90.0
    beat_times = librosa.frames_to_time(
        np.asarray(beat_frames).flatten(), sr=sr, hop_length=hop_length
    )
    beat_times = np.sort(beat_times)
    return bpm, beat_times
