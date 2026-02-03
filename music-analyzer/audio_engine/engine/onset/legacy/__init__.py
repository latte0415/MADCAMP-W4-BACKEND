"""
스트림/섹션 레거시·실험용 API.
메인 드럼 파이프라인(drum/)에서는 미사용. streams_sections JSON·legacy 스크립트용.
"""
from audio_engine.engine.onset.legacy.streams import build_streams
from audio_engine.engine.onset.legacy.sections import segment_sections
from audio_engine.engine.onset.legacy.stream_layer import assign_layer_to_streams
from audio_engine.engine.onset.legacy.stream_simplify import simplify_shaker_clap_streams

__all__ = [
    "build_streams",
    "segment_sections",
    "assign_layer_to_streams",
    "simplify_shaker_clap_streams",
]
