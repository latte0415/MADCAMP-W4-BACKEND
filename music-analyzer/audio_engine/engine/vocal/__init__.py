"""
Vocal 스템: 연속 곡선 + 변화율 기반 키포인트 (onset 노트 없음).
"""
from audio_engine.engine.vocal.vocal_curve import run_vocal_curve
from audio_engine.engine.vocal.vocal_keypoints import compute_vocal_keypoints
from audio_engine.engine.vocal.export import build_vocal_output

__all__ = [
    "run_vocal_curve",
    "compute_vocal_keypoints",
    "build_vocal_output",
]
