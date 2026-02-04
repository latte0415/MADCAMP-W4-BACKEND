"""
베이스 스템 분석 엔진.
메인: v4(madmom onset). 레거시: pipeline, v2, v3.
"""
# 레거시 코드 포함 여부 (pipeline/v2/v3 참조 시 사용)
LEGACY_BASS = True
from audio_engine.engine.bass.bass_v4 import run_bass_v4

run_bass = run_bass_v4

from audio_engine.engine.bass.constants import (
    BASS_HOP_LENGTH,
    BASS_FMIN,
    BASS_FMAX,
    BASS_FRAME_LENGTH,
    BASS_BANDPASS_HZ,
    BASS_ENERGY_WIN_LENGTH,
    DELTA_SEMITONE,
    JUMP_SEMITONE,
    CONFIDENCE_THRESHOLD,
    MIN_SEGMENT_DURATION_SEC,
    RDP_EPSILON_SEMITONE,
    MIN_NOTE_DURATION_SEC,
    DECAY_ENERGY_RATIO,
    ENERGY_PEAK_MIN_DISTANCE_FRAMES,
    ENERGY_PEAK_HEIGHT_PERCENTILE,
    ENERGY_ONSET_LOOKBACK_FRAMES,
    ENERGY_RISE_DERIV_PERCENTILE,
    ENERGY_RISE_MIN_GAP_FRAMES,
    LEAP_SEMITONE_THRESHOLD,
    ACCENT_PERCENTILE,
)
from audio_engine.engine.bass.pitch_tracking import compute_pitch_pyin
from audio_engine.engine.bass.energy_envelope import compute_bass_energy_envelope
from audio_engine.engine.bass.curve_clean_segment import clean_and_segment_pitch_curve
from audio_engine.engine.bass.curve_simplify import simplify_curve_rdp
from audio_engine.engine.bass.export import build_bass_output
from audio_engine.engine.bass.pipeline import run_bass_pipeline

__all__ = [
    "run_bass_v4",
    "run_bass",
    "LEGACY_BASS",
    "BASS_HOP_LENGTH",
    "BASS_FMIN",
    "BASS_FMAX",
    "BASS_FRAME_LENGTH",
    "BASS_BANDPASS_HZ",
    "BASS_ENERGY_WIN_LENGTH",
    "DELTA_SEMITONE",
    "JUMP_SEMITONE",
    "CONFIDENCE_THRESHOLD",
    "MIN_SEGMENT_DURATION_SEC",
    "RDP_EPSILON_SEMITONE",
    "MIN_NOTE_DURATION_SEC",
    "DECAY_ENERGY_RATIO",
    "ENERGY_PEAK_MIN_DISTANCE_FRAMES",
    "ENERGY_PEAK_HEIGHT_PERCENTILE",
    "ENERGY_ONSET_LOOKBACK_FRAMES",
    "ENERGY_RISE_DERIV_PERCENTILE",
    "ENERGY_RISE_MIN_GAP_FRAMES",
    "LEAP_SEMITONE_THRESHOLD",
    "ACCENT_PERCENTILE",
    "compute_pitch_pyin",
    "compute_bass_energy_envelope",
    "clean_and_segment_pitch_curve",
    "simplify_curve_rdp",
    "build_bass_output",
    "run_bass_pipeline",
]
