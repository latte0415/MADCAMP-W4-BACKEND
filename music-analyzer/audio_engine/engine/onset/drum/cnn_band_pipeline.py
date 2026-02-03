"""
madmom CNN + ODF 기반 band onset/stength 파이프라인.
대역별 CNN onset → ODF(superflux/complex_flux)로 strength 보강 → build_streams 입력용.
"""
from __future__ import annotations

import collections
from pathlib import Path
from typing import Any

import numpy as np

from audio_engine.engine.onset.drum.band_onset_merge import (
    merge_close_band_onsets,
    filter_by_strength,
    filter_transient_mid_high,
)
from audio_engine.engine.onset.constants import (
    STRENGTH_FLOOR_BAND_ONSET,
    STRENGTH_FLOOR_MID_HIGH,
)

# Python 3.10+ / NumPy 2.0+ 호환 패치 (madmom)
if not hasattr(collections, "MutableSequence"):
    import collections.abc

    collections.MutableSequence = collections.abc.MutableSequence  # type: ignore
for _attr, _val in [("float", np.float64), ("int", np.int64), ("bool", np.bool_), ("complex", np.complex128)]:
    if not hasattr(np, _attr):
        setattr(np, _attr, _val)


def _sample_odf_at_times(activation: np.ndarray, times: np.ndarray, duration: float) -> np.ndarray:
    """ODF activation array를 onset times에서 샘플링. activation은 duration 동안 균일 fps라고 가정."""
    if len(times) == 0:
        return np.array([])
    fps = len(activation) / max(duration, 0.001)
    indices = np.clip(
        np.round(times * fps).astype(int),
        0,
        len(activation) - 1,
    )
    return np.asarray(activation, dtype=float)[indices]


def compute_cnn_band_onsets_with_odf(
    stem_folder_name: str,
    stems_base_dir: Path | str,
    *,
    cnn_threshold: float = 0.35,
    strength_floor: float = STRENGTH_FLOOR_BAND_ONSET,
) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray], float, int]:
    """
    band별 CNN onset + ODF strength.
    low/mid: superflux, high: complex_flux.

    Returns:
        (band_onsets, band_strengths, duration, sr)
        band_onsets[band] = 1d array of onset times (sec)
        band_strengths[band] = 1d array, same length as band_onsets[band]
    """
    from madmom.features.onsets import (
        CNNOnsetProcessor,
        OnsetPeakPickingProcessor,
        SpectralOnsetProcessor,
    )
    from madmom.audio.filters import LogarithmicFilterbank

    stems_base_dir = Path(stems_base_dir)
    folder = stems_base_dir / stem_folder_name
    drum_low_path = folder / "drum_low.wav"
    drum_mid_path = folder / "drum_mid.wav"
    drum_high_path = folder / "drum_high.wav"

    for p in (drum_low_path, drum_mid_path, drum_high_path):
        if not p.exists():
            raise FileNotFoundError(f"필요한 파일이 없습니다: {p} (폴더: {stem_folder_name})")

    fps = 100
    cnn_proc = CNNOnsetProcessor()
    peak_proc = OnsetPeakPickingProcessor(
        threshold=cnn_threshold,
        smooth=0.0,
        pre_avg=0.0,
        post_avg=0.0,
        pre_max=0.02,
        post_max=0.02,
        combine=0.03,
        fps=fps,
    )
    superflux_proc = SpectralOnsetProcessor(
        onset_method="superflux",
        filterbank=LogarithmicFilterbank,
        num_bands=24,
    )
    complexflux_proc = SpectralOnsetProcessor(onset_method="complex_flux")

    band_onsets: dict[str, np.ndarray] = {}
    band_strengths: dict[str, np.ndarray] = {}
    duration = 0.0
    sr = 22050

    import soundfile as sf

    for band_key, path, odf_proc in [
        ("low", drum_low_path, superflux_proc),
        ("mid", drum_mid_path, superflux_proc),
        ("high", drum_high_path, complexflux_proc),
    ]:
        path_str = str(path)
        activations = cnn_proc(path_str)
        onset_times = peak_proc(activations)
        onset_times = np.asarray(onset_times).flatten()

        info = sf.info(path_str)
        dur = info.duration
        if sr == 22050 and hasattr(info, "samplerate"):
            sr = info.samplerate
        duration = max(duration, dur)

        odf_activation = odf_proc(path_str)
        strengths = _sample_odf_at_times(odf_activation, onset_times, dur)
        if len(strengths) != len(onset_times):
            strengths = np.zeros(len(onset_times))  # fallback

        band_onsets[band_key] = onset_times
        band_strengths[band_key] = np.clip(strengths.astype(float), 0, None)

    band_onsets, band_strengths = merge_close_band_onsets(
        band_onsets, band_strengths
    )
    for band in list(band_onsets.keys()):
        floor = STRENGTH_FLOOR_MID_HIGH if band in ("mid", "high") else strength_floor
        t, s = filter_by_strength(
            band_onsets[band],
            band_strengths[band],
            floor,
        )
        band_onsets[band] = t
        band_strengths[band] = s
    band_onsets, band_strengths = filter_transient_mid_high(
        band_onsets,
        band_strengths,
        {"mid": drum_mid_path, "high": drum_high_path},
        sr,
    )
    return band_onsets, band_strengths, duration, sr
