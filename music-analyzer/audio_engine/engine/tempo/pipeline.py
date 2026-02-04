"""
BPM 유추 및 BPM 기준 마디 표시 메인 파이프라인.
오디오 → BPM·비트 → 마디 그리드 → 출력 dict.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import librosa
import numpy as np

from audio_engine.engine.tempo.constants import DEFAULT_HOP_LENGTH
from audio_engine.engine.tempo.bpm import infer_bpm
from audio_engine.engine.tempo.bars import bars_from_bpm
from audio_engine.engine.tempo.export import build_tempo_output


def run_tempo_pipeline(
    audio_path: Path | str,
    *,
    sr: int | None = None,
    hop_length: int = DEFAULT_HOP_LENGTH,
) -> dict[str, Any]:
    """
    오디오 파일에 대해 BPM 유추 후 마디 경계 생성.

    Returns:
        {"bpm": float, "bars": [{"bar": 0, "start": ..., "end": ...}, ...], "beats": [...], "duration_sec": float}
    """
    path = Path(audio_path)
    if not path.exists():
        raise FileNotFoundError(f"오디오 파일 없음: {path}")

    y, sr_load = librosa.load(str(path), sr=sr, mono=True)
    if sr is None:
        sr = sr_load
    duration_sec = len(y) / float(sr)

    bpm, beat_times = infer_bpm(y, sr, hop_length=hop_length)

    # 첫 비트 시각을 1박으로 하여 마디 그리드 생성
    first_beat_time = float(beat_times[0]) if len(beat_times) > 0 else 0.0
    bars = bars_from_bpm(
        bpm,
        duration_sec,
        first_beat_time=first_beat_time,
    )

    return build_tempo_output(
        bpm=bpm,
        bars=bars,
        beat_times=beat_times,
        duration_sec=duration_sec,
    )
