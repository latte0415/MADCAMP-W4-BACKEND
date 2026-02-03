"""
드럼 low/mid/high stem 폴더 기반 **대역별 onset** 검출 후, 각 onset 시점의 에너지 계산.
stems/htdemucs/{stem_folder_name}/ 에서 drum_low.wav, drum_mid.wav, drum_high.wav 각각
onset 검출 → 해당 onset 구간의 RMS(에너지) → 막대그래프용 데이터.

LEGACY: librosa onset 기반. CNN 기반은 compute_cnn_band_onsets(10_cnn_band_onsets.py) 사용.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import librosa
import numpy as np

from audio_engine.engine.onset.pipeline import build_context
from audio_engine.engine.onset.types import OnsetContext
from audio_engine.engine.onset.utils import robust_norm


def _band_onset_energies(audio_path: Path) -> tuple[np.ndarray, np.ndarray, float, int]:
    """
    단일 대역 파일에서 onset 검출 후, 각 onset 구간의 RMS(에너지) 반환.
    Returns: (onset_times, energy_norm_0_1, duration, sr)
    """
    ctx: OnsetContext = build_context(audio_path, include_temporal=False)
    onset_times = ctx.onset_times
    duration = ctx.duration
    n_events = ctx.n_events
    sr = ctx.sr
    y, _ = librosa.load(audio_path, sr=sr, mono=True)

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
    energy_norm = robust_norm(e, method="median_mad")
    return onset_times, energy_norm, duration, sr


def compute_drum_band_energy(
    stem_folder_name: str,
    stems_base_dir: Path | str,
) -> dict[str, Any]:
    """
    stem 폴더명만 지정. stems_base_dir 아래 {stem_folder_name}/ 에서
    drum_low.wav, drum_mid.wav, drum_high.wav **각각** onset 검출 후
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
        onset_times, energy_norm, dur, sr = _band_onset_energies(path)
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
