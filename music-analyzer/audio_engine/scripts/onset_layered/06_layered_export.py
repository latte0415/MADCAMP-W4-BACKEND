"""
06. Layered Export (레이어별 JSON 추출)
5개 피처 계산 → P0/P1/P2 스코어·할당 → 레이어별 통합 JSON 저장.
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
    build_context_with_band_evidence,
    compute_energy,
    compute_clarity,
    compute_temporal,
    compute_spectral,
    compute_context_dependency,
    assign_roles_by_band,
    write_layered_json,
)

# %%
# 기본 입력: 샘플 오디오 (필요 시 경로 변경)
# audio_path = os.path.join(
#     project_root,
#     "audio_engine",
#     "samples",
#     "stems",
#     "htdemucs",
#     "sample_ropes_short",
#     "drums.wav",
# )
audio_path = os.path.join(project_root, "audio_engine", "samples", "sample_animal_spirits.mp3")

ctx = build_context_with_band_evidence(audio_path, include_temporal=True)
print(f"파일: {os.path.basename(audio_path)}")
print(f"샘플링 레이트: {ctx.sr} Hz, 길이: {ctx.duration:.2f} 초")
print(f"검출된 타격점 수(anchor): {ctx.n_events}")
print(f"BPM: {ctx.bpm:.1f}")

# %%
# 고정 BAND_HZ(20-200, 200-3k, 3k-10k) 사용
e_s, energy_extras = compute_energy(ctx)
c_s, _ = compute_clarity(ctx)
t_s, _ = compute_temporal(ctx)
f_s, _ = compute_spectral(ctx)
d_s, _ = compute_context_dependency(ctx)

metrics = {
    "energy": e_s,
    "clarity": c_s,
    "temporal": t_s,
    "focus": f_s,
    "dependency": d_s,
}
role_composition = assign_roles_by_band(
    energy_extras,
    temporal=metrics["temporal"],
    dependency=metrics["dependency"],
    focus=metrics["focus"],
    onset_times=ctx.onset_times,
    band_evidence=ctx.band_evidence,
)
# 이벤트 기준 (JSON layer_counts와 동일: P0=전체 이벤트 수, P1/P2=역할이 하나라도 있는 이벤트 수)
n_p0_events = ctx.n_events
n_p1_events = sum(1 for ev in role_composition if ev.get("P1"))
n_p2_events = sum(1 for ev in role_composition if ev.get("P2"))
print(f"  이벤트 기준 — P0: {n_p0_events}, P1: {n_p1_events}, P2: {n_p2_events}")
# band 기준 (슬롯 수: 이벤트당 P1/P2 band 개수 합)
n_p1_slots = sum(len(ev.get("P1") or []) for ev in role_composition)
n_p2_slots = sum(len(ev.get("P2") or []) for ev in role_composition)
print(f"  band 슬롯 — P1: {n_p1_slots}, P2: {n_p2_slots}")

# %%
samples_dir = os.path.join(project_root, "audio_engine", "samples")
json_path = os.path.join(samples_dir, "onset_events_layered.json")
write_layered_json(
    ctx,
    metrics,
    role_composition,
    json_path,
    source=os.path.basename(audio_path),
    project_root=project_root,
)
print(f"저장 완료: {json_path}")
