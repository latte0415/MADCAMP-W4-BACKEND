"""
베이스 스템 분석 엔진.
곡선형 그래프(피치–시간–에너지) 파이프라인. 드럼(onset)과 병렬.
"""
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
    LEAP_SEMITONE_THRESHOLD,
    ACCENT_PERCENTILE,
)
from audio_engine.engine.bass.pitch_tracking import compute_pitch_pyin
from audio_engine.engine.bass.energy_envelope import compute_bass_energy_envelope
from audio_engine.engine.bass.curve_clean_segment import clean_and_segment_pitch_curve
from audio_engine.engine.bass.curve_simplify import simplify_curve_rdp
from audio_engine.engine.bass.keypoints import extract_bass_keypoints
from audio_engine.engine.bass.export import build_bass_output
from audio_engine.engine.bass.pipeline import run_bass_pipeline

__all__ = [
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
    "LEAP_SEMITONE_THRESHOLD",
    "ACCENT_PERCENTILE",
    "compute_pitch_pyin",
    "compute_bass_energy_envelope",
    "clean_and_segment_pitch_curve",
    "simplify_curve_rdp",
    "extract_bass_keypoints",
    "build_bass_output",
    "run_bass_pipeline",
]
