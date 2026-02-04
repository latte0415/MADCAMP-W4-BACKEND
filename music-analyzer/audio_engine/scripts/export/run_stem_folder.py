"""
통합 진입점: stem 폴더명 받아서 drum + bass → streams_sections_cnn.json
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

from audio_engine.engine.onset import write_streams_sections_json

# drum.run, bass.run from sibling dirs (scripts not a package)
import importlib.util
def _load_run(segment: str):
    path = os.path.join(_scripts, segment, "run.py")
    spec = importlib.util.spec_from_file_location(f"{segment}_run", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

_drum_run = _load_run("drum")
_bass_run = _load_run("bass")
_vocal_run = _load_run("vocal")
_other_run = _load_run("other")


def run_stem_folder(
    stem_folder_name: str,
    stems_base_dir: str | Path | None = None,
    json_path: str | Path | None = None,
):
    """
    stem 폴더 하나에 대해 드럼 + 베이스 실행 후 streams_sections_cnn.json 저장.
    """
    if stems_base_dir is None:
        stems_base_dir = get_stems_base_dir()
    stems_base_dir = str(stems_base_dir)
    folder = Path(stems_base_dir) / stem_folder_name

    keypoints_by_band, texture_blocks_by_band, duration, sr = _drum_run.run(
        stem_folder_name, stems_base_dir
    )
    print(f"폴더: {stem_folder_name} (CNN+ODF)")
    print(f"duration: {duration:.2f}s, sr: {sr}")
    print(f"  keypoints_by_band: low={len(keypoints_by_band.get('low', []))}, mid={len(keypoints_by_band.get('mid', []))}, high={len(keypoints_by_band.get('high', []))}")
    print(f"  texture_blocks_by_band: mid={len(texture_blocks_by_band.get('mid', []))}, high={len(texture_blocks_by_band.get('high', []))}")

    # 베이스: v4(madmom onset) 메인. notes 개수 출력.
    bass_dict = None
    bass_path = folder / "bass.wav"
    if bass_path.exists():
        try:
            bass_dict = _bass_run.run(bass_path, sr=sr)
            print(f"  베이스: notes {len(bass_dict.get('notes', []))}개")
        except Exception as e:
            print(f"  베이스 파이프라인 스킵: {e}")

    # 보컬: vocal_curve + vocal_keypoints (onset 노트 없음).
    vocal_dict = None
    vocals_path = folder / "vocals.wav"
    if vocals_path.exists():
        try:
            vocal_dict = _vocal_run.run(vocals_path, sr=sr)
            print(f"  보컬: curve {len(vocal_dict.get('vocal_curve', []))}점, keypoints {len(vocal_dict.get('vocal_keypoints', []))}개")
        except Exception as e:
            print(f"  보컬 파이프라인 스킵: {e}")

    # Other: other_curve(density) + other_regions(패드).
    other_dict = None
    other_path = folder / "other.wav"
    if other_path.exists():
        try:
            other_dict = _other_run.run(other_path, sr=sr)
            print(f"  other: curve {len(other_dict.get('other_curve', []))}점, regions {len(other_dict.get('other_regions', []))}개")
        except Exception as e:
            print(f"  other 파이프라인 스킵: {e}")

    if json_path is None:
        json_path = os.path.join(project_root, "audio_engine", "samples", "streams_sections_cnn.json")
    json_path = str(json_path)
    write_streams_sections_json(
        json_path,
        source=stem_folder_name,
        sr=sr,
        duration_sec=duration,
        streams=[],
        sections=[],
        keypoints=[],
        project_root=project_root,
        events=None,
        keypoints_by_band=keypoints_by_band,
        texture_blocks_by_band=texture_blocks_by_band,
        bass=bass_dict,
        vocal=vocal_dict,
        other=other_dict,
    )
    print(f"저장 완료: {json_path}")
    return json_path


if __name__ == "__main__":
    STEM_FOLDER_NAME = "sample_animal_spirits_3_45"
    run_stem_folder(STEM_FOLDER_NAME)
