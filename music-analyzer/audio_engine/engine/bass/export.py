"""
베이스 결과 → JSON용 dict 구성 (notes 기반).
실제 파일 쓰기는 onset/export.write_streams_sections_json(bass=...)에 위임.
"""
from __future__ import annotations

from typing import Any

from audio_engine.engine.utils import hz_to_midi


def build_bass_output(
    notes: list[dict[str, Any]],
    lines: list[dict[str, Any]] | None = None,
    groove_curve: list[tuple[float, float]] | None = None,
) -> dict[str, Any]:
    """
    note 리스트를 streams_sections_cnn.json 내 bass 필드 스키마로 변환.
    groove_curve: 점(onset) 밀도·에너지 흐름 곡선 [[t, value], ...], value 0~1.

    Returns:
        {"notes": [...], "lines": [], "groove_curve": [...], "render": {...}} — JSON 직렬화 가능.
    """
    if lines is None:
        lines = []
    if groove_curve is None:
        groove_curve = []
    notes_out: list[dict[str, Any]] = []
    for seg in notes:
        pc = seg.get("pitch_center", seg.get("pitch_median"))
        entry: dict[str, Any] = {
            "start": round(float(seg["start"]), 4),
            "end": round(float(seg["end"]), 4),
            "duration": round(float(seg["duration"]), 4),
            "pitch_center": _round_or_none(pc),
            "energy_peak": round(float(seg["energy_peak"]), 4),
            "energy_mean": round(float(seg["energy_mean"]), 4),
            "attack_time": round(float(seg.get("attack_time", 0)), 4),
            "decay_time": round(float(seg.get("decay_time", 0)), 4),
        }
        if "line_id" in seg:
            entry["line_id"] = seg["line_id"] if seg["line_id"] is None else int(seg["line_id"])
        if "role" in seg:
            entry["role"] = str(seg["role"])
        if "pitch_curve" in seg:
            t_seg, p_seg = seg["pitch_curve"]
            t_seg = getattr(t_seg, "tolist", lambda: list(t_seg))()
            p_seg = getattr(p_seg, "tolist", lambda: list(p_seg))()
            pitch_curve = [
                [round(float(t), 4), round(float(hz_to_midi(p)), 4) if _is_finite(p) and p > 0 else None]
                for t, p in zip(t_seg, p_seg)
            ]
            energy_curve = seg.get("energy_curve")
            if energy_curve is None:
                energy_curve = [round(float(seg.get("energy_mean", 0)), 4)] * len(pitch_curve)
            else:
                energy_curve = [round(float(e), 4) for e in energy_curve]
            entry["pitch_curve"] = pitch_curve
            entry["energy_curve"] = energy_curve
        if "pitch_min" in seg:
            entry["pitch_min"] = _round_or_none(seg["pitch_min"])
        if "pitch_max" in seg:
            entry["pitch_max"] = _round_or_none(seg["pitch_max"])
        if "simplified_curve" in seg:
            t_s, p_s = seg["simplified_curve"]
            t_s = getattr(t_s, "tolist", lambda: list(t_s))()
            p_s = getattr(p_s, "tolist", lambda: list(p_s))()
            entry["simplified_curve"] = [
                [round(float(t), 4), round(float(hz_to_midi(p)), 4) if _is_finite(p) and p > 0 else None]
                for t, p in zip(t_s, p_s)
            ]
        if "superflux_mean" in seg:
            entry["superflux_mean"] = round(float(seg["superflux_mean"]), 4)
        if "superflux_var" in seg:
            entry["superflux_var"] = round(float(seg["superflux_var"]), 4)
        if "render_type" in seg:
            entry["render_type"] = str(seg["render_type"])
        if "groove_confidence" in seg:
            entry["groove_confidence"] = round(float(seg["groove_confidence"]), 4)
        if "groove_group" in seg:
            entry["groove_group"] = int(seg["groove_group"])
        if "superflux_curve" in seg:
            entry["superflux_curve"] = [round(float(x), 4) for x in seg["superflux_curve"]]
        if "decay_ratio" in seg:
            entry["decay_ratio"] = round(float(seg["decay_ratio"]), 4)
        notes_out.append(entry)

    lines_out: list[dict[str, Any]] = []
    for line in lines:
        t_seg, p_seg = line["pitch_curve"]
        t_seg = getattr(t_seg, "tolist", lambda: list(t_seg))()
        p_seg = getattr(p_seg, "tolist", lambda: list(p_seg))()
        pitch_curve = [
            [round(float(t), 4), round(float(hz_to_midi(p)), 4) if _is_finite(p) and p > 0 else None]
            for t, p in zip(t_seg, p_seg)
        ]
        energy_curve = line.get("energy_curve")
        if energy_curve is not None:
            energy_curve = [round(float(e), 4) for e in energy_curve]
        line_entry: dict[str, Any] = {
            "id": int(line["id"]),
            "start": round(float(line["start"]), 4),
            "end": round(float(line["end"]), 4),
            "pitch_curve": pitch_curve,
            "energy_curve": energy_curve if energy_curve is not None else [],
        }
        if "decay_ratio" in line:
            line_entry["decay_ratio"] = round(float(line["decay_ratio"]), 4)
        lines_out.append(line_entry)

    groove_curve_out: list[list[float]] = [
        [round(float(t), 4), round(float(v), 4)] for t, v in groove_curve
    ]

    render: dict[str, Any] = {
        "y_axis": "pitch_midi",
        "thickness": "energy",
        "curve": "envelope",
    }
    return {"notes": notes_out, "lines": lines_out, "groove_curve": groove_curve_out, "render": render}


def _is_finite(x: Any) -> bool:
    import numpy as np
    try:
        return bool(np.isfinite(x))
    except (TypeError, ValueError):
        return False


def _round_or_none(x: Any) -> float | None:
    """NaN/비유한 값은 JSON null용 None, 그 외는 round(..., 4)."""
    import math
    try:
        if x is None:
            return None
        f = float(x)
        if not math.isfinite(f):
            return None
        return round(f, 4)
    except (TypeError, ValueError):
        return None
