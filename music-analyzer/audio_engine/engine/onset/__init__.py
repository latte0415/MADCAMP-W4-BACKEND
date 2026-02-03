"""
Onset 기반 레이어링 엔진.
L1+L2+L3+L4+L5 공개 API re-export (스크립트/CLI용).
"""
# L1
from audio_engine.engine.onset.types import OnsetContext
from audio_engine.engine.onset.constants import (
    DEFAULT_HOP_LENGTH,
    DEFAULT_HOP_REFINE,
    DEFAULT_WIN_REFINE_SEC,
    BAND_HZ,
    BAND_NAMES,
    DEFAULT_N_FFT,
    DEFAULT_POINT_COLOR,
)
from audio_engine.engine.onset.utils import robust_norm

# L2
from audio_engine.engine.onset.pipeline import (
    detect_onsets,
    refine_onset_times,
    build_context,
    build_context_with_band_evidence,
)
from audio_engine.engine.onset.band_classification import compute_band_hz

# L3
from audio_engine.engine.onset.features.energy import compute_energy
from audio_engine.engine.onset.features.clarity import compute_clarity
from audio_engine.engine.onset.features.temporal import compute_temporal
from audio_engine.engine.onset.features.spectral import compute_spectral
from audio_engine.engine.onset.features.context import compute_context_dependency

# L4
from audio_engine.engine.onset.scoring import (
    normalize_metrics_per_track,
    assign_roles_by_band,
)

# Streams / Sections
from audio_engine.engine.onset.streams import build_streams
from audio_engine.engine.onset.sections import segment_sections

# Drum band energy (stem 폴더 기반 low/mid/high onset 에너지)
from audio_engine.engine.onset.drum_band_energy import (
    compute_drum_band_energy,
    compute_band_onset_energies,
)
from audio_engine.engine.onset.key_onset_selector import select_key_onsets_by_band
from audio_engine.engine.onset.texture_block_merge import merge_texture_blocks_by_band
from audio_engine.engine.onset.madmom_drum_band import compute_madmom_drum_band_keypoints
from audio_engine.engine.onset.cnn_band_onsets import compute_cnn_band_onsets
from audio_engine.engine.onset.cnn_band_pipeline import compute_cnn_band_onsets_with_odf
from audio_engine.engine.onset.stream_layer import assign_layer_to_streams
from audio_engine.engine.onset.stream_simplify import simplify_shaker_clap_streams
from audio_engine.engine.onset.band_onset_merge import (
    merge_close_onsets,
    merge_close_band_onsets,
    filter_by_strength,
)

# L5
from audio_engine.engine.onset.export import (
    write_energy_json,
    write_clarity_json,
    write_temporal_json,
    write_spectral_json,
    write_context_json,
    write_layered_json,
    write_streams_sections_json,
    write_drum_band_energy_json,
)

__all__ = [
    "OnsetContext",
    "DEFAULT_HOP_LENGTH",
    "DEFAULT_HOP_REFINE",
    "DEFAULT_WIN_REFINE_SEC",
    "BAND_HZ",
    "BAND_NAMES",
    "DEFAULT_N_FFT",
    "DEFAULT_POINT_COLOR",
    "robust_norm",
    "detect_onsets",
    "refine_onset_times",
    "build_context",
    "build_context_with_band_evidence",
    "compute_band_hz",
    "compute_energy",
    "compute_clarity",
    "compute_temporal",
    "compute_spectral",
    "compute_context_dependency",
    "normalize_metrics_per_track",
    "assign_roles_by_band",
    "write_energy_json",
    "write_clarity_json",
    "write_temporal_json",
    "write_spectral_json",
    "write_context_json",
    "write_layered_json",
    "write_streams_sections_json",
    "build_streams",
    "segment_sections",
    "compute_drum_band_energy",
    "compute_madmom_drum_band_keypoints",
    "compute_cnn_band_onsets",
    "compute_cnn_band_onsets_with_odf",
    "assign_layer_to_streams",
    "simplify_shaker_clap_streams",
    "merge_close_onsets",
    "merge_close_band_onsets",
    "filter_by_strength",
    "write_drum_band_energy_json",
    "compute_band_onset_energies",
    "select_key_onsets_by_band",
    "merge_texture_blocks_by_band",
]
