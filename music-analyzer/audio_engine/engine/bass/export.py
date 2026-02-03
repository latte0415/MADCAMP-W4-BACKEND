"""
베이스 결과 → JSON용 dict 구성.
실제 파일 쓰기는 onset/export.write_streams_sections_json(bass=...)에 위임.
"""
from __future__ import annotations

from typing import Any


def build_bass_output(
    curve_segments: list[dict[str, Any]],
    keypoints: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    curve segments(각각 simplified_curve 포함)와 keypoints를
    streams_sections_cnn.json 내 bass 필드 스키마로 변환.

    Returns:
        {"curve": [...], "keypoints": [...]} — JSON 직렬화 가능.
    """
    curve_out: list[dict[str, Any]] = []
    for seg in curve_segments:
        t_seg, p_seg = seg["pitch_curve"]
        pitch_curve = [
            [round(float(t), 4), round(float(p), 4) if __is_finite(p) else None]
            for t, p in zip(t_seg, p_seg)
        ]
        energy_curve = seg.get("energy_curve")
        if energy_curve is None:
            energy_curve = [round(float(seg["energy_mean"]), 4)] * len(pitch_curve)
        else:
            energy_curve = [round(float(e), 4) for e in energy_curve]
        conf = seg.get("confidence")
        if conf is not None:
            conf = [round(float(c), 4) for c in conf]
        entry: dict[str, Any] = {
            "start": round(float(seg["start"]), 4),
            "end": round(float(seg["end"]), 4),
            "pitch_curve": pitch_curve,
            "energy_curve": energy_curve,
            "confidence": conf,
        }
        if "simplified_curve" in seg:
            t_s, p_s = seg["simplified_curve"]
            entry["simplified_curve"] = [
                [round(float(t), 4), round(float(p), 4) if __is_finite(p) else None]
                for t, p in zip(t_s, p_s)
            ]
        curve_out.append(entry)

    kp_out = []
    for k in keypoints:
        item: dict[str, Any] = {"time": k["time"], "type": k["type"]}
        if "pitch" in k:
            item["pitch"] = k["pitch"]
        if "energy" in k:
            item["energy"] = k["energy"]
        kp_out.append(item)

    return {"curve": curve_out, "keypoints": kp_out}


def __is_finite(x: Any) -> bool:
    import numpy as np
    try:
        return bool(np.isfinite(x))
    except (TypeError, ValueError):
        return False
