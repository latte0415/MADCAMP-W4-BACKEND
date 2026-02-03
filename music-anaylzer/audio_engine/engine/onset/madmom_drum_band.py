"""
madmom 라이브러리를 사용한 드럼 low/mid/high 대역별 키포인트(onset) 추출.
stems/htdemucs/{stem_folder_name}/ 에서 drum_low.wav, drum_mid.wav, drum_high.wav 각각
madmom RNNOnsetProcessor + OnsetPeakPickingProcessor로 onset 검출 → 해당 onset 구간의 RMS(에너지).
"""
from __future__ import annotations

import collections
from pathlib import Path
from typing import Any

import librosa
import numpy as np

from audio_engine.engine.onset.utils import robust_norm

# Python 3.10+ 호환: madmom이 collections.MutableSequence를 사용하므로 패치
if not hasattr(collections, "MutableSequence"):
    import collections.abc

    collections.MutableSequence = collections.abc.MutableSequence  # type: ignore

# NumPy 2.0+ 호환: madmom이 deprecated np.float, np.int 등 사용
for _attr, _val in [("float", np.float64), ("int", np.int64), ("bool", np.bool_), ("complex", np.complex128)]:
    if not hasattr(np, _attr):
        setattr(np, _attr, _val)


def _madmom_band_onset_energies(audio_path: Path) -> tuple[np.ndarray, np.ndarray, float, int]:
    """
    단일 대역 파일에서 madmom RNN onset 검출 후, 각 onset 구간의 RMS(에너지) 반환.
    Returns: (onset_times, energy_norm_0_1, duration, sr)
    """
    from madmom.features.onsets import RNNOnsetProcessor, OnsetPeakPickingProcessor

    fps = 100
    proc_onset = RNNOnsetProcessor()
    proc_peak = OnsetPeakPickingProcessor(
        threshold=0.4,
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

    y, sr = librosa.load(audio_path, sr=22050, mono=True)
    duration = len(y) / sr
    n_events = len(onset_times)

    energy_arr: list[float] = []
    for i in range(n_events):
        mid_prev = (
            0.0
            if i == 0
            else (onset_times[i - 1] + onset_times[i]) / 2
        )
        mid_next = (
            duration
            if i == n_events - 1
            else (onset_times[i] + onset_times[i + 1]) / 2
        )
        start_sample = max(0, int(round(mid_prev * sr)))
        end_sample = min(len(y), int(round(mid_next * sr)))
        seg = y[start_sample:end_sample]
        rms = float(np.sqrt(np.mean(seg ** 2))) if len(seg) > 0 else 0.0
        energy_arr.append(rms)

    e = np.array(energy_arr)
    energy_norm = robust_norm(e, method="median_mad") if len(e) > 0 else np.array([])
    return onset_times, energy_norm, duration, sr


def compute_madmom_drum_band_keypoints(
    stem_folder_name: str,
    stems_base_dir: Path | str,
) -> dict[str, Any]:
    """
    stem 폴더명만 지정. stems_base_dir 아래 {stem_folder_name}/ 에서
    drum_low.wav, drum_mid.wav, drum_high.wav **각각** madmom onset 검출 후
    해당 대역 onset 시점의 에너지(RMS 정규화) 반환.

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

    for band_key, path in [
        ("low", drum_low_path),
        ("mid", drum_mid_path),
        ("high", drum_high_path),
    ]:
        onset_times, energy_norm, dur, sr = _madmom_band_onset_energies(path)
        duration = max(duration, dur)
        events = [
            {"t": round(float(t), 4), "energy": round(float(e), 4)}
            for t, e in zip(onset_times, energy_norm)
        ]
        bands_out[band_key] = events

    return {
        "source": stem_folder_name,
        "duration_sec": round(float(duration), 4),
        "sr": int(sr),
        "bands": bands_out,
    }
