"""
드럼 키포인트 파이프라인 (최종본).
CNN+ODF band onset → 짧은 구간 진폭 기준 필터·에너지 → keypoints_by_band, texture_blocks_by_band.
"""
from audio_engine.engine.onset.drum.band_onset_merge import (
    merge_close_onsets,
    merge_close_band_onsets,
    filter_by_strength,
    filter_transient_mid_high,
)
from audio_engine.engine.onset.drum.drum_band_energy import (
    compute_drum_band_energy,
    compute_band_onset_energies,
)
from audio_engine.engine.onset.drum.key_onset_selector import select_key_onsets_by_band
from audio_engine.engine.onset.drum.texture_block_merge import merge_texture_blocks_by_band
from audio_engine.engine.onset.drum.cnn_band_onsets import compute_cnn_band_onsets
from audio_engine.engine.onset.drum.cnn_band_pipeline import compute_cnn_band_onsets_with_odf

__all__ = [
    "merge_close_onsets",
    "merge_close_band_onsets",
    "filter_by_strength",
    "filter_transient_mid_high",
    "compute_drum_band_energy",
    "compute_band_onset_energies",
    "select_key_onsets_by_band",
    "merge_texture_blocks_by_band",
    "compute_cnn_band_onsets",
    "compute_cnn_band_onsets_with_odf",
]
