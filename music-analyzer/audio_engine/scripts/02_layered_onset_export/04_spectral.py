"""
07. Spectral Focus (주파수 집중도)
주파수 에너지가 한 대역에 뭉쳐 또렷한가, 아니면 넓게 퍼져 텍스처인가.
엔트리: engine.onset 사용.
"""
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
    compute_spectral,
    write_spectral_json,
)

# audio_path = os.path.join(project_root, "audio_engine", "samples", "stems", "htdemucs", "sample_ropes_short", "drums.wav")
audio_path = os.path.join(project_root, "audio_engine", "samples", "sample_ropes_short.mp3")

ctx = build_context(audio_path, include_temporal=False)
print(f"파일: {os.path.basename(audio_path)}")
print(f"샘플링 레이트: {ctx.sr} Hz, 길이: {ctx.duration:.2f} 초")
print(f"검출된 타격점 수: {ctx.n_events}")

scores, extras = compute_spectral(ctx)
print(f"focus_score: min={scores.min():.4f}, max={scores.max():.4f}")

samples_dir = os.path.join(project_root, "audio_engine", "samples")
json_path = os.path.join(samples_dir, "onset_events_spectral.json")
write_spectral_json(
    ctx,
    scores,
    extras,
    json_path,
    source=os.path.basename(audio_path),
    project_root=project_root,
)
print(f"저장 완료: {json_path}")
