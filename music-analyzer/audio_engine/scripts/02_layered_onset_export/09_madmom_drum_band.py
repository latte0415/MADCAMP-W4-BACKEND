"""
09. madmom 기반 드럼 low/mid/high stem별 onset 키포인트 → 막대그래프용 JSON
stem 폴더명만 지정. stems/htdemucs/{STEM_FOLDER_NAME}/ 에서
drum_low.wav, drum_mid.wav, drum_high.wav 사용.
"""
import sys
import os


def find_project_root():
    cwd = os.path.abspath(os.getcwd())
    while cwd:
        if os.path.isdir(os.path.join(cwd, "audio_engine")) and os.path.isdir(
            os.path.join(cwd, "web")
        ):
            return cwd
        cwd = os.path.dirname(cwd)
    return os.path.abspath(os.path.join(os.path.dirname(os.getcwd()), "..", ".."))


project_root = find_project_root()
sys.path.insert(0, project_root)

from audio_engine.engine.onset import (
    compute_madmom_drum_band_keypoints,
    write_drum_band_energy_json,
)

# 폴더명만 지정 (stems/htdemucs/{STEM_FOLDER_NAME}/ 아래 drum_low/mid/high.wav 필요)
STEM_FOLDER_NAME = "sample_animal_spirits_3_45"

stems_base_dir = os.path.join(
    project_root,
    "audio_engine",
    "samples",
    "stems",
    "htdemucs",
)

result = compute_madmom_drum_band_keypoints(STEM_FOLDER_NAME, stems_base_dir)
bands = result["bands"]
print(f"폴더: {STEM_FOLDER_NAME} (madmom)")
print(f"duration: {result['duration_sec']}s, Low: {len(bands['low'])} Mid: {len(bands['mid'])} High: {len(bands['high'])} onset")

samples_dir = os.path.join(project_root, "audio_engine", "samples")
json_path = os.path.join(samples_dir, "drum_band_madmom.json")
write_drum_band_energy_json(result, json_path, project_root=project_root)
print(f"저장 완료: {json_path}")
