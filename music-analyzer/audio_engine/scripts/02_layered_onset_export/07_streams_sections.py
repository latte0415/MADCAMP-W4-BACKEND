"""
07. 스트림·섹션·키포인트 (Stream-based Part Segmentation + Keypoints)
band_onset_times → build_streams → segment_sections → 키포인트 추출(섹션 경계 + 스트림 accent) → JSON 저장.

LEGACY: 11_cnn_streams_layers.py 사용 권장. 실행 비활성화.
"""
import sys
import os


def find_project_root():
    cwd = os.path.abspath(os.getcwd())
    while cwd:
        if os.path.isdir(os.path.join(cwd, "audio_engine")) and os.path.isdir(
            os.path.join(cwd, "web")
        ):
            return cwd
        cwd = os.path.dirname(cwd)
    return os.path.abspath(os.path.join(os.path.dirname(os.getcwd()), "..", ".."))


project_root = find_project_root()
sys.path.insert(0, project_root)

from audio_engine.engine.onset import (
    build_context_with_band_evidence,
    build_streams,
    segment_sections,
    compute_energy,
    compute_clarity,
    compute_temporal,
    compute_spectral,
    compute_context_dependency,
    assign_roles_by_band,
    write_streams_sections_json,
)


# LEGACY: 실행 비활성화. 11_cnn_streams_layers.py 사용 권장.
if __name__ == "__main__":
    sys.exit("LEGACY: Use 11_cnn_streams_layers.py.")

def extract_keypoints(streams: list[dict], sections: list[dict]) -> list[dict]:
    """섹션 경계 + 스트림 accent 시점을 키포인트로 추출."""
    keypoints = []
    seen = set()
    for sec in sections:
        t_start = round(float(sec.get("start", 0)), 4)
        t_end = round(float(sec.get("end", 0)), 4)
        sid = sec.get("id", 0)
        if t_start not in seen:
            seen.add(t_start)
            keypoints.append({
                "time": t_start,
                "type": "section_boundary",
                "section_id": sid,
                "label": "섹션 시작",
            })
        if t_end not in seen:
            seen.add(t_end)
            keypoints.append({
                "time": t_end,
                "type": "section_boundary",
                "section_id": sid,
                "label": "섹션 끝",
            })
    for s in streams:
        stream_id = s.get("id", "")
        for t in s.get("accents") or []:
            t = round(float(t), 4)
            if t not in seen:
                seen.add(t)
                keypoints.append({
                    "time": t,
                    "type": "accent",
                    "stream_id": stream_id,
                    "label": "accent",
                })
    keypoints.sort(key=lambda x: x["time"])
    return keypoints


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
if not os.path.exists(audio_path):
    audio_path = os.path.join(project_root, "audio_engine", "samples", "sample_animal_spirits.mp3")

ctx = build_context_with_band_evidence(audio_path, include_temporal=True)
print(f"파일: {os.path.basename(audio_path)}")
print(f"샘플링 레이트: {ctx.sr} Hz, 길이: {ctx.duration:.2f} 초")

if ctx.band_onset_times is None:
    print("band_onset_times 없음. build_context_with_band_evidence로 생성된 컨텍스트인지 확인하세요.")
    sys.exit(1)

streams = build_streams(ctx.band_onset_times, ctx.band_onset_strengths)
sections = segment_sections(streams, ctx.duration)
keypoints = extract_keypoints(streams, sections)
print(f"스트림: {len(streams)}개, 섹션: {len(sections)}개, 키포인트: {len(keypoints)}개")

# 정밀도 기반 P0/P1/P2 이벤트 (06과 동일 파이프라인으로 roles 생성)
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
LAYER_COLORS = {"P0": "#2ecc71", "P1": "#f39c12", "P2": "#3498db"}
events_out = []
n_comp = len(role_composition)
for i in range(ctx.n_events):
    comp = role_composition[i] if i < n_comp else {"P0": ["mid"], "P1": [], "P2": []}
    p0_bands = comp["P0"] if isinstance(comp["P0"], list) else [comp["P0"]]
    p1_list = list(comp.get("P1") or [])
    p2_list = list(comp.get("P2") or [])
    roles = {"P0": sorted(p0_bands), "P1": sorted(p1_list), "P2": p2_list}
    primary = "P2" if p2_list else "P1" if p1_list else "P0"
    t = round(float(ctx.onset_times[i]), 4)
    events_out.append({
        "time": t,
        "t": t,
        "roles": roles,
        "layer": primary,
        "strength": round(float(ctx.strengths[i]), 4),
        "color": LAYER_COLORS.get(primary, "#5a9fd4"),
        "energy_score": round(float(metrics["energy"][i]), 4),
        "clarity_score": round(float(metrics["clarity"][i]), 4),
        "temporal_score": round(float(metrics["temporal"][i]), 4),
        "focus_score": round(float(metrics["focus"][i]), 4),
        "dependency_score": round(float(metrics["dependency"][i]), 4),
    })
print(f"  이벤트(P0/P1/P2): {ctx.n_events}개")

samples_dir = os.path.join(project_root, "audio_engine", "samples")
json_path = os.path.join(samples_dir, "streams_sections.json")
write_streams_sections_json(
    json_path,
    source=os.path.basename(audio_path),
    sr=ctx.sr,
    duration_sec=ctx.duration,
    streams=streams,
    sections=sections,
    keypoints=keypoints,
    project_root=project_root,
    events=events_out,
)
print(f"저장 완료: {json_path}")
