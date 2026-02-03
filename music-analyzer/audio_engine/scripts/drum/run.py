"""
드럼 전용: CNN band onset → keypoints_by_band, texture_blocks_by_band (스트림 미사용).
"""
import sys
import os
from pathlib import Path

_dir = os.path.dirname(os.path.abspath(__file__))
_scripts = os.path.dirname(_dir)
if _scripts not in sys.path:
    sys.path.insert(0, _scripts)
from _common import find_project_root, get_stems_base_dir
project_root = find_project_root()
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from audio_engine.engine.onset import (
    compute_cnn_band_onsets_with_odf,
    select_key_onsets_by_band,
    merge_texture_blocks_by_band,
)


def run(
    stem_folder_name: str,
    stems_base_dir: str | Path | None = None,
):
    """
    stem 폴더 하나에 대해 드럼 키포인트·텍스처 블록만 계산 (JSON 쓰지 않음).

    Returns:
        (keypoints_by_band, texture_blocks_by_band, duration, sr)
    """
    if stems_base_dir is None:
        stems_base_dir = get_stems_base_dir()
    stems_base_dir = str(stems_base_dir)
    folder = Path(stems_base_dir) / stem_folder_name

    band_onsets, band_strengths, duration, sr = compute_cnn_band_onsets_with_odf(
        stem_folder_name, stems_base_dir
    )
    band_audio_paths = {
        "low": folder / "drum_low.wav",
        "mid": folder / "drum_mid.wav",
        "high": folder / "drum_high.wav",
    }
    keypoints_by_band = select_key_onsets_by_band(
        band_onsets,
        band_strengths,
        duration,
        sr,
        band_audio_paths=band_audio_paths,
    )
    texture_blocks_by_band = merge_texture_blocks_by_band(band_onsets, band_strengths)
    return keypoints_by_band, texture_blocks_by_band, duration, sr


if __name__ == "__main__":
    STEM_FOLDER_NAME = "sample_animal_spirits_3_45"
    stems_base_dir = get_stems_base_dir()
    kp, tex, dur, sr = run(STEM_FOLDER_NAME, stems_base_dir)
    print(f"폴더: {STEM_FOLDER_NAME} (CNN+ODF)")
    print(f"duration: {dur:.2f}s, sr: {sr}")
    print(f"  keypoints_by_band: low={len(kp.get('low', []))}, mid={len(kp.get('mid', []))}, high={len(kp.get('high', []))}")
    print(f"  texture_blocks_by_band: mid={len(tex.get('mid', []))}, high={len(tex.get('high', []))}")
