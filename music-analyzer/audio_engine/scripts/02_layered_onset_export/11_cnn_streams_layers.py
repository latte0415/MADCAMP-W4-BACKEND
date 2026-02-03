"""
11. CNN + ODF 기반 스트림·레이어(P0/P1/P2)·섹션
compute_cnn_band_onsets_with_odf → build_streams → assign_layer_to_streams → segment_sections
+ KeyOnsetSelector → TextureBlockMerger → keypoints_by_band, texture_blocks_by_band
"""
import sys
import os
from pathlib import Path


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
    compute_cnn_band_onsets_with_odf,
    build_streams,
    simplify_shaker_clap_streams,
    segment_sections,
    assign_layer_to_streams,
    write_streams_sections_json,
    select_key_onsets_by_band,
    merge_texture_blocks_by_band,
)

STEM_FOLDER_NAME = "sample_animal_spirits_3_45"
stems_base_dir = os.path.join(
    project_root,
    "audio_engine",
    "samples",
    "stems",
    "htdemucs",
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


LAYER_COLORS = {"P0": "#2ecc71", "P1": "#f39c12", "P2": "#3498db"}

band_onsets, band_strengths, duration, sr = compute_cnn_band_onsets_with_odf(
    STEM_FOLDER_NAME, stems_base_dir
)
print(f"폴더: {STEM_FOLDER_NAME} (CNN+ODF)")
print(f"duration: {duration:.2f}s, sr: {sr}")

streams = build_streams(band_onsets, band_strengths)
simplify_shaker_clap_streams(streams)
layer_map = assign_layer_to_streams(streams)
for s in streams:
    s["layer"] = layer_map.get(s["id"], "P2")
sections = segment_sections(streams, duration)
keypoints = extract_keypoints(streams, sections)
print(f"스트림: {len(streams)}개, 섹션: {len(sections)}개, 키포인트: {len(keypoints)}개")

# 대역별 핵심 타격 + 텍스처 블록 (드럼 MVP)
folder = Path(stems_base_dir) / STEM_FOLDER_NAME
band_audio_paths = {
    "low": folder / "drum_low.wav",
    "mid": folder / "drum_mid.wav",
    "high": folder / "drum_high.wav",
}
keypoints_by_band = select_key_onsets_by_band(
    band_onsets,
    band_strengths,
    duration,
    sr,
    band_audio_paths=band_audio_paths,
)
texture_blocks_by_band = merge_texture_blocks_by_band(band_onsets, band_strengths)
print(f"  keypoints_by_band: low={len(keypoints_by_band.get('low', []))}, mid={len(keypoints_by_band.get('mid', []))}, high={len(keypoints_by_band.get('high', []))}")
print(f"  texture_blocks_by_band: mid={len(texture_blocks_by_band.get('mid', []))}, high={len(texture_blocks_by_band.get('high', []))}")

events_out = []
for s in streams:
    layer = s.get("layer", "P2")
    evs = s.get("events") or []
    str_list = s.get("strengths") or []
    for i, t in enumerate(evs):
        str_val = float(str_list[i]) if i < len(str_list) else s.get("strength_median", 0)
        events_out.append({
            "time": round(float(t), 4),
            "t": round(float(t), 4),
            "band": s.get("band", ""),
            "stream_id": s.get("id", ""),
            "layer": layer,
            "strength": round(float(str_val), 4),
            "color": LAYER_COLORS.get(layer, "#5a9fd4"),
        })
events_out.sort(key=lambda e: e["time"])
print(f"  이벤트: {len(events_out)}개")

samples_dir = os.path.join(project_root, "audio_engine", "samples")
json_path = os.path.join(samples_dir, "streams_sections_cnn.json")
write_streams_sections_json(
    json_path,
    source=STEM_FOLDER_NAME,
    sr=sr,
    duration_sec=duration,
    streams=streams,
    sections=sections,
    keypoints=keypoints,
    project_root=project_root,
    events=events_out,
    keypoints_by_band=keypoints_by_band,
    texture_blocks_by_band=texture_blocks_by_band,
)
print(f"저장 완료: {json_path}")
