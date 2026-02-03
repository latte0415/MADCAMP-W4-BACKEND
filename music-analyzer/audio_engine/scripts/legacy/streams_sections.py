"""
LEGACY. 스트림·섹션·키포인트 (Stream-based Part Segmentation + Keypoints).
band_onset_times → build_streams → segment_sections → 키포인트 → JSON.

메인 파이프라인은 스트림 미사용. export/run_stem_folder.py 사용 권장.
"""
import sys
import os

if __name__ == "__main__":
    sys.exit("LEGACY: Use export/run_stem_folder.py for stem export.")

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
