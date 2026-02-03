# %% [markdown]
# # 04. 드럼 스템 음역대별 분류 (drum_low, drum_mid, drum_high)
# 기존 stems/htdemucs/<track>/ 폴더에 drum_low.wav, drum_mid.wav, drum_high.wav 저장
#

# %%
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

import librosa
import soundfile as sf
from audio_engine.engine.onset.pipeline import filter_y_into_bands
from audio_engine.engine.onset.constants import BAND_HZ

# %%
stems_dir = os.path.join(project_root, 'audio_engine', 'samples', 'stems', 'htdemucs')
track_name = "sample_animal_spirits_3_45"
drums_path = os.path.join(stems_dir, track_name, 'drums.wav')
if not os.path.exists(drums_path):
    track_name = "sample_animal_spirits"
    drums_path = os.path.join(stems_dir, track_name, 'drums.wav')
assert os.path.exists(drums_path), f"drums.wav 없음: {drums_path}"
stem_dir = os.path.dirname(drums_path)

# %%
y, sr = librosa.load(drums_path, sr=None, mono=True)
y_low, y_mid, y_high = filter_y_into_bands(y, sr, BAND_HZ)

for name, seg in [("drum_low", y_low), ("drum_mid", y_mid), ("drum_high", y_high)]:
    out_path = os.path.join(stem_dir, f"{name}.wav")
    sf.write(out_path, seg, sr)
    print(f"저장: {out_path}")

print("완료.")
