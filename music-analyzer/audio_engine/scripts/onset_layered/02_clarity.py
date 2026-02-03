# %% [markdown]
# # 05. 어택 명확도 기반 타격 레이어링 (Onset Clarity)
#
# 이벤트별 Attack Time (10% → 90% 도달 시간)을 측정하여 타격의 또렷함(Clarity)을 수치화합니다.
# 엔트리: engine.onset 사용.
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

from audio_engine.engine.onset import (
    build_context,
    compute_clarity,
    write_clarity_json,
)

# %%
# audio_path = os.path.join(project_root, "audio_engine", "samples", "stems", "htdemucs", "sample_ropes_short", "drums.wav")
audio_path = os.path.join(project_root, "audio_engine", "samples", "sample_ropes_short.mp3")

ctx = build_context(audio_path, include_temporal=False)
print(f"파일: {os.path.basename(audio_path)}")
print(f"샘플링 레이트: {ctx.sr} Hz, 길이: {ctx.duration:.2f} 초")
print(f"검출된 타격점 수: {ctx.n_events}")
print(f"추정 BPM: {ctx.bpm:.1f}")

# %%
scores, extras = compute_clarity(ctx)
print(f"Clarity Score 범위: {scores.min():.4f} ~ {scores.max():.4f}")

# %%
samples_dir = os.path.join(project_root, "audio_engine", "samples")
json_path = os.path.join(samples_dir, "onset_events_clarity.json")
write_clarity_json(
    ctx,
    scores,
    extras,
    json_path,
    source=os.path.basename(audio_path),
    project_root=project_root,
)
print(f"저장 완료: {json_path}")
