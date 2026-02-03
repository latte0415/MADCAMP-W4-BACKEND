"""
madmom CNN 기반 드럼 low/mid/high 대역별 포인트 추출.
stems/htdemucs/{stem_folder_name}/ 에서 drum_low.wav, drum_mid.wav, drum_high.wav 각각
CNNOnsetProcessor + OnsetPeakPickingProcessor로 onset 검출. strength는 CNN activation에서 샘플링.
"""
from __future__ import annotations

import collections
from pathlib import Path
from typing import Any

import numpy as np

from audio_engine.engine.onset.drum.band_onset_merge import merge_close_onsets, filter_by_strength
from audio_engine.engine.onset.constants import (
    MERGE_CLOSE_SEC_LOW,
    MERGE_CLOSE_SEC_MID,
    MERGE_CLOSE_SEC_HIGH,
    STRENGTH_FLOOR_BAND_ONSET,
    STRENGTH_FLOOR_MID_HIGH,
)

# Python 3.10+ 호환: madmom이 collections.MutableSequence를 사용하므로 패치
if not hasattr(collections, "MutableSequence"):
    import collections.abc

    collections.MutableSequence = collections.abc.MutableSequence  # type: ignore

# NumPy 2.0+ 호환: madmom이 deprecated np.float, np.int 등 사용
for _attr, _val in [("float", np.float64), ("int", np.int64), ("bool", np.bool_), ("complex", np.complex128)]:
    if not hasattr(np, _attr):
        setattr(np, _attr, _val)


def _cnn_band_onsets(audio_path: Path, threshold: float = 0.35) -> tuple[np.ndarray, np.ndarray, float, int]:
    """
    단일 대역 파일에서 madmom CNN onset 검출.
    Returns: (onset_times, strengths, duration, sr)
    """
    from madmom.features.onsets import CNNOnsetProcessor, OnsetPeakPickingProcessor

    fps = 100
    proc_onset = CNNOnsetProcessor()
    proc_peak = OnsetPeakPickingProcessor(
        threshold=threshold,
        smooth=0.0,
        pre_avg=0.0,
        post_avg=0.0,
        pre_max=0.02,
        post_max=0.02,
        combine=0.03,
        fps=fps,
    )
    activations = proc_onset(str(audio_path))
    onset_times = proc_peak(activations)
    onset_times = np.asarray(onset_times).flatten()

    if len(onset_times) == 0:
        return onset_times, np.array([]), 0.0, 22050

    # strength: activation at onset frame
    frame_indices = np.clip(
        np.round(onset_times * fps).astype(int),
        0,
        len(activations) - 1,
    )
    strengths = np.asarray(activations, dtype=float)[frame_indices]

    import soundfile as sf
    info = sf.info(str(audio_path))
    duration = info.duration
    sr = info.samplerate
    return onset_times, strengths, duration, sr


def compute_cnn_band_onsets(
    stem_folder_name: str,
    stems_base_dir: Path | str,
    *,
    threshold: float = 0.35,
    strength_floor: float = STRENGTH_FLOOR_BAND_ONSET,
) -> dict[str, Any]:
    """
    stem 폴더명만 지정. stems_base_dir 아래 {stem_folder_name}/ 에서
    drum_low.wav, drum_mid.wav, drum_high.wav **각각** madmom CNN onset 검출.

    Returns:
        {
            "source": stem_folder_name,
            "duration_sec": float,
            "sr": int,
            "bands": {
                "low": [ {"t": float, "energy": float}, ... ],
                "mid": [ ... ],
                "high": [ ... ],
            }
        }
    energy 필드는 CNN activation strength (0~1)를 그대로 사용. DrumBandEnergyBarView 호환.
    """
    stems_base_dir = Path(stems_base_dir)
    folder = stems_base_dir / stem_folder_name
    drum_low_path = folder / "drum_low.wav"
    drum_mid_path = folder / "drum_mid.wav"
    drum_high_path = folder / "drum_high.wav"

    for p in (drum_low_path, drum_mid_path, drum_high_path):
        if not p.exists():
            raise FileNotFoundError(f"필요한 파일이 없습니다: {p} (폴더: {stem_folder_name})")

    bands_out: dict[str, list[dict[str, float]]] = {}
    duration = 0.0
    sr = 22050

    sec_per_band = {
        "low": MERGE_CLOSE_SEC_LOW,
        "mid": MERGE_CLOSE_SEC_MID,
        "high": MERGE_CLOSE_SEC_HIGH,
    }
    for band_key, path in [
        ("low", drum_low_path),
        ("mid", drum_mid_path),
        ("high", drum_high_path),
    ]:
        onset_times, strengths, dur, sr = _cnn_band_onsets(path, threshold=threshold)
        onset_times, strengths = merge_close_onsets(
            onset_times, strengths, sec_per_band[band_key], keep="strongest"
        )
        floor = STRENGTH_FLOOR_MID_HIGH if band_key in ("mid", "high") else strength_floor
        onset_times, strengths = filter_by_strength(
            onset_times, strengths, floor
        )
        duration = max(duration, dur)
        energy = np.clip(strengths, 0, 1) if len(strengths) > 0 else np.array([])
        events = [
            {"t": round(float(t), 4), "energy": round(float(e), 4)}
            for t, e in zip(onset_times, energy)
        ]
        bands_out[band_key] = events

    return {
        "source": stem_folder_name,
        "duration_sec": round(float(duration), 4),
        "sr": int(sr),
        "bands": bands_out,
    }
