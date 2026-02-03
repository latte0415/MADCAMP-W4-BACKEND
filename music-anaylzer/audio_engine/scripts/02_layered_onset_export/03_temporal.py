# %% [markdown]
# # 06. Temporal Salience (박자 기여도 / 반복성)
#
# 가변 그리드 + 로컬 템포 기반으로 "이 이벤트가 그루브/박자 인식에 얼마나 기여하는가"를 수치화합니다.
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
    compute_temporal,
    write_temporal_json,
)

# %%
# audio_path = os.path.join(project_root, "audio_engine", "samples", "stems", "htdemucs", "sample_ropes_short", "drums.wav")
# audio_path = os.path.join(project_root, "audio_engine", "samples", "sample_ropes_short.mp3")
audio_path = os.path.join(project_root, "audio_engine", "samples", "sample_cardmani.mp3")

ctx = build_context(audio_path, include_temporal=True)
print(f"파일: {os.path.basename(audio_path)}")
print(f"샘플링 레이트: {ctx.sr} Hz, 길이: {ctx.duration:.2f} 초")
print(f"검출된 타격점 수: {ctx.n_events}")
print(f"글로벌 BPM: {ctx.bpm:.1f}")

# %%
scores, extras = compute_temporal(ctx)
print(f"temporal_score: min={scores.min():.4f}, max={scores.max():.4f}")

# %%
samples_dir = os.path.join(project_root, "audio_engine", "samples")
json_path = os.path.join(samples_dir, "onset_events_temporal.json")
write_temporal_json(
    ctx,
    scores,
    extras,
    json_path,
    source=os.path.basename(audio_path),
    project_root=project_root,
)
print(f"저장 완료: {json_path}")
