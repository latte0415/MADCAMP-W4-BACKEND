"""
Vocal 스템: 연속 곡선 + phrase boundary / 제스처(구간 이벤트).
"""
from audio_engine.engine.vocal.vocal_curve import run_vocal_curve
from audio_engine.engine.vocal.vocal_phrases import compute_vocal_phrases
from audio_engine.engine.vocal.export import build_vocal_output

__all__ = [
    "run_vocal_curve",
    "compute_vocal_phrases",
    "build_vocal_output",
]
