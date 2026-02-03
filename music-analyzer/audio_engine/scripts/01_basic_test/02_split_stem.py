# %% [markdown]
# # 02. Stem 분리 (Demucs) 테스트
#

# %%
import sys
import os

# 프로젝트 루트: cwd 상위로 올라가며 audio_engine + web 있는 디렉터리 (노트북 위치 무관)
def find_project_root():
    cwd = os.path.abspath(os.getcwd())
    while cwd:
        if os.path.isdir(os.path.join(cwd, 'audio_engine')) and os.path.isdir(os.path.join(cwd, 'web')):
            return cwd
        cwd = os.path.dirname(cwd)
    return os.path.abspath(os.path.join(os.path.dirname(os.getcwd()), '..', '..'))  # fallback
project_root = find_project_root()
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