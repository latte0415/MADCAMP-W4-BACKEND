"""
CNN 기반 드럼 low/mid/high stem별 onset → 막대그래프용 JSON.
stem 폴더명만 지정. stems/htdemucs/{STEM_FOLDER_NAME}/ 에서
drum_low.wav, drum_mid.wav, drum_high.wav 사용.
"""
import sys
import os

_dir = os.path.dirname(os.path.abspath(__file__))
_scripts = os.path.dirname(_dir)
if _scripts not in sys.path:
    sys.path.insert(0, _scripts)
from _common import find_project_root, get_stems_base_dir
project_root = find_project_root()
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from audio_engine.engine.onset import (
    compute_cnn_band_onsets,
    write_drum_band_energy_json,
)

# 폴더명만 지정 (stems/htdemucs/{STEM_FOLDER_NAME}/ 아래 drum_low/mid/high.wav 필요)
STEM_FOLDER_NAME = "sample_animal_spirits_3_45"
stems_base_dir = get_stems_base_dir()

result = compute_cnn_band_onsets(STEM_FOLDER_NAME, stems_base_dir)
bands = result["bands"]
print(f"폴더: {STEM_FOLDER_NAME} (CNN)")
print(f"duration: {result['duration_sec']}s, Low: {len(bands['low'])} Mid: {len(bands['mid'])} High: {len(bands['high'])} onset")

samples_dir = os.path.join(project_root, "audio_engine", "samples")
json_path = os.path.join(samples_dir, "cnn_band_onsets.json")
write_drum_band_energy_json(result, json_path, project_root=project_root)
print(f"저장 완료: {json_path}")
