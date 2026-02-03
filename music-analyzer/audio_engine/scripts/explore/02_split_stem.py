# %% [markdown]
# # 02. Stem 분리 (Demucs) 테스트
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

from audio_engine.engine import stems

print(f"프로젝트 루트: {project_root}")

# %%
# 테스트용 오디오 (짧은 샘플 권장 - CPU에서 시간 걸림)
# audio_path = os.path.join(project_root, 'audio_engine', 'samples', 'sample_cardmani.mp3')
audio_path = os.path.join(project_root, 'audio_engine', 'samples', 'sample_animal_spirits_3_45.wav')

if not os.path.exists(audio_path):
    # 짧은 샘플 없으면 전체 샘플 사용
    audio_path = os.path.join(project_root, 'audio_engine', 'samples', 'sample_cardmani.mp3')

assert os.path.exists(audio_path), f"샘플 파일 없음: {audio_path}"
print(f"입력: {audio_path}")

# %%
# Stem 분리 실행 (CPU라서 1~2분 이상 걸릴 수 있음)
out_dir = os.path.join(project_root, 'audio_engine', 'samples', 'stems')

result = stems.separate(
    audio_path,
    out_dir=out_dir,
    model_name="htdemucs",
)

print("분리 완료:")
for name, path in result.items():
    print(f"  {name}: {path}")

# %%
# 보컬만 확인하고 싶다면 (2 stem만 생성, 더 빠름)
# result = stems.separate(audio_path, out_dir=out_dir, model_name="htdemucs", two_stems="vocals")
# print(result)
