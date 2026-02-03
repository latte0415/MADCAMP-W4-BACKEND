# %% [markdown]
# sample_animal_spirits에서 0:03~0:45 구간만 잘라 저장
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

# %%
audio_path = os.path.join(project_root, 'audio_engine', 'samples', 'sample_animal_spirits.mp3')
assert os.path.exists(audio_path), f"샘플 없음: {audio_path}"

start_sec, end_sec = 3.0, 45.0
y, sr = librosa.load(audio_path, sr=None, mono=False)
if y.ndim == 1:
    y = y.reshape(1, -1)

start_idx = int(start_sec * sr)
end_idx = int(end_sec * sr)
seg = y[:, start_idx:end_idx]

out_path = os.path.join(project_root, 'audio_engine', 'samples', 'sample_animal_spirits_3_45.wav')
sf.write(out_path, seg.T, sr)
print(f"저장: {out_path} (0:03 ~ 0:45)")
