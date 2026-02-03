"""
베이스 피치 추적 (프레임 기반).
librosa.pyin 사용. 저주파 오검출 보호는 curve_clean_segment Step A에서 처리.
"""
from __future__ import annotations

from typing import Tuple

import librosa
import numpy as np

from audio_engine.engine.bass.constants import (
    BASS_HOP_LENGTH,
    BASS_FMIN,
    BASS_FMAX,
    BASS_FRAME_LENGTH,
)


def compute_pitch_pyin(
    y: np.ndarray,
    sr: int,
    *,
    hop_length: int = BASS_HOP_LENGTH,
    fmin: float = BASS_FMIN,
    fmax: float = BASS_FMAX,
    frame_length: int = BASS_FRAME_LENGTH,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    pyin으로 프레임별 F0·confidence 추출.

    Returns:
        times: frame 시간 (초), shape (n_frames,)
        pitch_hz: F0 (Hz), unvoiced는 NaN
        confidence: voiced_prob (0~1), unvoiced는 0
    """
    ret = librosa.pyin(
        y,
        fmin=fmin,
        fmax=fmax,
        sr=sr,
        hop_length=hop_length,
        frame_length=frame_length,
        fill_na=np.nan,
        center=True,
    )
    if len(ret) == 3:
        f0, voiced_flag, voiced_prob = ret
    else:
        f0, voiced_flag = ret
        voiced_prob = voiced_flag.astype(np.float64)
    # (n_frames,)로 squeeze
    if f0.ndim > 1:
        f0 = f0.squeeze()
    voiced_flag = np.asarray(voiced_flag).squeeze()
    voiced_prob = np.asarray(voiced_prob).squeeze()
    times = librosa.times_like(f0, sr=sr, hop_length=hop_length)
    # unvoiced frame: pitch는 이미 NaN, confidence는 0
    confidence = np.where(voiced_flag, voiced_prob, 0.0).astype(np.float64)
    pitch_hz = f0.astype(np.float64)
    return times, pitch_hz, confidence
