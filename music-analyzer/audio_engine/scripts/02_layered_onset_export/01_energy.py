# %% [markdown]
# # 04. 정밀도 기반 타격 레이어링 (Layered Onset) — Energy
#
# 정밀도(onset strength 등)를 기준으로 타격을 레이어로 나누어 검토합니다.
# 엔트리: engine.onset 사용.
# %%
import sys
import os

def find_project_root():
    cwd = os.path.abspath(os.getcwd())
    while cwd:
        if os.path.isdir(os.path.join(cwd, "audio_engine")) and os.path.isdir(os.path.join(cwd, "web")):
            return cwd
        cwd = os.path.dirname(cwd)
    return os.path.abspath(os.path.join(os.path.dirname(os.getcwd()), "..", ".."))
project_root = find_project_root()
sys.path.insert(0, project_root)

from audio_engine.engine.onset import (
    build_context,
    compute_energy,
    write_energy_json,
)

# %%
audio_path = os.path.join(
    project_root,
    "audio_engine",
    "samples",
    "stems",
    "htdemucs",
    "sample_animal_spirits_3_45",
    "drums.wav",
)
# audio_path = os.path.join(project_root, "audio_engine", "samples", "sample_drum_basic_60.mp3")

ctx = build_context(audio_path, include_temporal=False)
print(f"파일: {os.path.basename(audio_path)}")
print(f"샘플링 레이트: {ctx.sr} Hz, 길이: {ctx.duration:.2f} 초")
print(f"검출된 타격점 수: {ctx.n_events}")
print(f"추정 BPM: {ctx.bpm:.1f}")

# %%
scores, extras = compute_energy(ctx)
print(f"energy_score (0~1): min={scores.min():.4f}, max={scores.max():.4f}")

# %%
samples_dir = os.path.join(project_root, "audio_engine", "samples")
json_path = os.path.join(samples_dir, "onset_events_energy.json")
write_energy_json(
    ctx,
    scores,
    extras,
    json_path,
    source=os.path.basename(audio_path),
    project_root=project_root,
)
print(f"저장 완료: {json_path}")
