"""
08. 드럼 low/mid/high stem별 onset 에너지 → 막대그래프용 JSON
stem 폴더명만 지정. stems/htdemucs/{STEM_FOLDER_NAME}/ 에서
drums.wav(onset 검출), drum_low.wav, drum_mid.wav, drum_high.wav 사용.

LEGACY: 10_cnn_band_onsets.py 사용 권장. 실행 비활성화.
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
    compute_drum_band_energy,
    write_drum_band_energy_json,
)

# LEGACY: 실행 비활성화. 10_cnn_band_onsets.py 사용 권장.
if __name__ == "__main__":
    import sys
    sys.exit("LEGACY: Use 10_cnn_band_onsets.py.")

# 폴더명만 지정 (stems/htdemucs/{STEM_FOLDER_NAME}/ 아래 drums.wav, drum_low/mid/high.wav 필요)
STEM_FOLDER_NAME = "sample_animal_spirits_3_45"

stems_base_dir = os.path.join(
    project_root,
    "audio_engine",
    "samples",
    "stems",
    "htdemucs",
)

result = compute_drum_band_energy(STEM_FOLDER_NAME, stems_base_dir)
bands = result["bands"]
print(f"폴더: {STEM_FOLDER_NAME}")
print(f"duration: {result['duration_sec']}s, Low: {len(bands['low'])} Mid: {len(bands['mid'])} High: {len(bands['high'])} onset")

samples_dir = os.path.join(project_root, "audio_engine", "samples")
json_path = os.path.join(samples_dir, "drum_band_energy.json")
write_drum_band_energy_json(result, json_path, project_root=project_root)
print(f"저장 완료: {json_path}")
