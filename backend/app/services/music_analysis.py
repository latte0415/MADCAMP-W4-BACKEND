"""
음악 분석 서비스: 스템 분리 후 드럼/베이스 키포인트 추출 및 streams_sections_cnn.json 생성.
audio_engine 의존성은 이 모듈에서만 import.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Callable, Optional

from ..core.config import MUSIC_ANALYZER_ROOT

if MUSIC_ANALYZER_ROOT and MUSIC_ANALYZER_ROOT not in sys.path:
    sys.path.insert(0, MUSIC_ANALYZER_ROOT)


def run_music_analysis(
    local_audio_path: str,
    stem_out_dir: str,
    output_json_path: str,
    model_name: str = "htdemucs",
    progress_cb: Optional[Callable[[str, float], None]] = None,
) -> str:
    """
    로컬 오디오 파일에 대해 스템 분리, 드럼/베이스 키포인트 추출, JSON 생성.

    Args:
        local_audio_path: 다운로드된 오디오 파일 경로.
        stem_out_dir: 스템 출력 디렉터리 (예: tmpdir/stems).
        output_json_path: 생성할 streams_sections_cnn.json 경로.
        model_name: Demucs 모델명 (기본 htdemucs).

    Returns:
        생성된 JSON 파일 경로 (output_json_path와 동일).
    """
    try:
        from audio_engine.engine.stems import separate as demucs_separate
        from audio_engine.engine.onset.pipeline import filter_y_into_bands
        from audio_engine.engine.onset.constants import BAND_HZ
        from audio_engine.engine.onset import (
            compute_cnn_band_onsets_with_odf,
            select_key_onsets_by_band,
            merge_texture_blocks_by_band,
            write_streams_sections_json,
        )
        from audio_engine.engine.bass import run_bass_pipeline
        import librosa
        import soundfile as sf
    except Exception as exc:
        raise RuntimeError(f"music analyzer import failed: {exc}") from exc

    audio_path = Path(local_audio_path)
    stem_out_path = Path(stem_out_dir)
    track_name = audio_path.stem

    def _emit(stage: str, progress: float) -> None:
        if progress_cb:
            progress_cb(stage, progress)

    _emit("stems", 0.42)
    demucs_separate(str(audio_path), out_dir=str(stem_out_path), model_name=model_name)

    stem_dir = stem_out_path / model_name / track_name
    drums_path = stem_dir / "drums.wav"
    if drums_path.exists():
        _emit("drum_bands", 0.5)
        y, sr = librosa.load(str(drums_path), sr=None, mono=True)
        y_low, y_mid, y_high = filter_y_into_bands(y, sr, BAND_HZ)
        sf.write(str(stem_dir / "drum_low.wav"), y_low, sr)
        sf.write(str(stem_dir / "drum_mid.wav"), y_mid, sr)
        sf.write(str(stem_dir / "drum_high.wav"), y_high, sr)

    _emit("cnn_onsets", 0.62)
    stems_base_dir = stem_out_path / model_name
    band_onsets, band_strengths, duration, sr = compute_cnn_band_onsets_with_odf(
        track_name,
        str(stems_base_dir),
    )
    band_audio_paths = {
        "low": stem_dir / "drum_low.wav",
        "mid": stem_dir / "drum_mid.wav",
        "high": stem_dir / "drum_high.wav",
    }
    _emit("keypoints", 0.72)
    keypoints_by_band = select_key_onsets_by_band(
        band_onsets,
        band_strengths,
        duration,
        sr,
        band_audio_paths=band_audio_paths,
    )
    _emit("textures", 0.8)
    texture_blocks_by_band = merge_texture_blocks_by_band(band_onsets, band_strengths)

    bass_dict = None
    bass_path = stem_dir / "bass.wav"
    if bass_path.exists():
        try:
            _emit("bass", 0.86)
            bass_dict = run_bass_pipeline(str(bass_path), sr=sr)
        except Exception:
            bass_dict = None

    _emit("write_json", 0.92)
    write_streams_sections_json(
        output_json_path,
        source=track_name,
        sr=sr,
        duration_sec=duration,
        streams=[],
        sections=[],
        keypoints=[],
        project_root=None,
        events=None,
        keypoints_by_band=keypoints_by_band,
        texture_blocks_by_band=texture_blocks_by_band,
        bass=bass_dict,
    )
    return output_json_path
