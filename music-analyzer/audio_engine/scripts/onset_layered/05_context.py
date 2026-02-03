"""
08. Context Dependency (맥락 의존성)
"혼자 있을 때만 들리는가? 다른 소리에 묻히는가?" psychoacoustic masking 관점.
엔트리: engine.onset 사용.
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
    build_context,
    compute_context_dependency,
    write_context_json,
)

# audio_path = os.path.join(project_root, "audio_engine", "samples", "stems", "htdemucs", "sample_ropes_short", "drums.wav")
audio_path = os.path.join(project_root, "audio_engine", "samples", "sample_ropes_short.mp3")

ctx = build_context(audio_path, include_temporal=False)
print(f"파일: {os.path.basename(audio_path)}")
print(f"샘플링 레이트: {ctx.sr} Hz, 길이: {ctx.duration:.2f} 초")
print(f"검출된 타격점 수: {ctx.n_events}")

scores, extras = compute_context_dependency(ctx)
print(f"dependency_score: min={scores.min():.4f}, max={scores.max():.4f}")

samples_dir = os.path.join(project_root, "audio_engine", "samples")
json_path = os.path.join(samples_dir, "onset_events_context.json")
write_context_json(
    ctx,
    scores,
    extras,
    json_path,
    source=os.path.basename(audio_path),
    project_root=project_root,
)
print(f"저장 완료: {json_path}")
