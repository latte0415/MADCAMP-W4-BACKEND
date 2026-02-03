"""
L5 I/O Adapters: JSON·경로·웹 복사 (도메인 결과 ↔ 파일시스템).
스키마별 JSON 쓰기, web/public 복사. L1 타입, L2 Context, L3 결과, L4 role_composition 사용.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Optional

import numpy as np

from audio_engine.engine.onset.types import OnsetContext
from audio_engine.engine.onset.constants import (
    DEFAULT_HOP_LENGTH,
    DEFAULT_N_FFT,
    EVENT_WIN_SEC,
    BG_WIN_SEC,
    DEFAULT_POINT_COLOR,
)


def _ensure_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def _copy_to_web_public(json_path: Path, project_root: Optional[Path]) -> None:
    if project_root is None:
        return
    web_public = project_root / "web" / "public"
    if web_public.is_dir():
        shutil.copy(json_path, web_public / json_path.name)


def write_energy_json(
    ctx: OnsetContext,
    scores: np.ndarray,
    extras: dict,
    path: Path | str,
    source: str = "unknown",
    project_root: Optional[Path | str] = None,
) -> Path:
    """context + energy (scores, extras) → onset_events_energy.json 형식."""
    path = Path(path)
    _ensure_dir(path)
    rms = extras["rms_per_event"]
    E_norm_low = extras["E_norm_low"]
    E_norm_mid = extras["E_norm_mid"]
    E_norm_high = extras["E_norm_high"]
    log_rms = extras["log_rms"]
    left_sec_arr = extras["left_sec_arr"]
    right_sec_arr = extras["right_sec_arr"]
    overlap_prev = extras["overlap_prev"]

    out = {
        "source": source,
        "sr": int(ctx.sr),
        "duration_sec": round(float(ctx.duration), 4),
        "energy_rms_min": round(float(np.min(rms)), 6),
        "energy_rms_max": round(float(np.max(rms)), 6),
        "hop_length": DEFAULT_HOP_LENGTH,
        "bpm": round(float(ctx.bpm), 2),
        "total_events": ctx.n_events,
        "events": [],
    }
    for i in range(ctx.n_events):
        t = round(float(ctx.onset_times[i]), 4)
        esc = float(scores[i])
        out["events"].append({
            "t": t,
            "time": t,
            "strength": round(esc, 4),
            "texture": round(float(E_norm_high[i]), 4),
            "color": DEFAULT_POINT_COLOR,
            "rms": round(float(rms[i]), 6),
            "e_norm": round(esc, 4),
            "band_low": round(float(E_norm_low[i]), 4),
            "band_mid": round(float(E_norm_mid[i]), 4),
            "band_high": round(float(E_norm_high[i]), 4),
            "index": i,
            "frame": int(ctx.onset_frames[i]),
            "onset_strength": round(float(ctx.strengths[i]), 4),
            "log_rms": round(float(log_rms[i]), 4),
            "energy_score": round(esc, 4),
            "E_norm_low": round(float(E_norm_low[i]), 4),
            "E_norm_mid": round(float(E_norm_mid[i]), 4),
            "E_norm_high": round(float(E_norm_high[i]), 4),
            "left_sec": round(float(left_sec_arr[i]), 4),
            "right_sec": round(float(right_sec_arr[i]), 4),
            "overlap_prev": bool(overlap_prev[i]),
        })
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    if project_root is not None:
        _copy_to_web_public(path, Path(project_root))
    return path


def write_clarity_json(
    ctx: OnsetContext,
    scores: np.ndarray,
    extras: dict,
    path: Path | str,
    source: str = "unknown",
    project_root: Optional[Path | str] = None,
) -> Path:
    """context + clarity (scores, extras) → onset_events_clarity.json 형식."""
    path = Path(path)
    _ensure_dir(path)
    attack_times_ms = extras["attack_times_ms"]
    out = {
        "metadata": {
            "source": source,
            "sr": ctx.sr,
            "hop_length": DEFAULT_HOP_LENGTH,
            "bpm": round(float(ctx.bpm), 2),
            "total_events": ctx.n_events,
        },
        "events": [],
    }
    for i in range(ctx.n_events):
        out["events"].append({
            "index": i,
            "time": round(float(ctx.onset_times[i]), 4),
            "frame": int(ctx.onset_frames[i]),
            "strength": round(float(ctx.strengths[i]), 4),
            "attack_time_ms": round(float(attack_times_ms[i]), 2),
            "clarity_score": round(float(scores[i]), 4),
        })
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    if project_root is not None:
        _copy_to_web_public(path, Path(project_root))
    return path


def write_temporal_json(
    ctx: OnsetContext,
    scores: np.ndarray,
    extras: dict,
    path: Path | str,
    source: str = "unknown",
    project_root: Optional[Path | str] = None,
) -> Path:
    """context + temporal (scores, extras) → onset_events_temporal.json 형식."""
    path = Path(path)
    _ensure_dir(path)
    grid_align_score = extras["grid_align_score"]
    repetition_score = extras["repetition_score"]
    ioi_prev = extras["ioi_prev"]
    ioi_next = extras["ioi_next"]
    out = {
        "metadata": {
            "source": source,
            "sr": int(ctx.sr),
            "duration_sec": round(float(ctx.duration), 4),
            "hop_length": DEFAULT_HOP_LENGTH,
            "bpm": round(float(ctx.bpm), 2),
            "bpm_dynamic_used": getattr(ctx, "bpm_dynamic_used", False),
            "total_events": ctx.n_events,
        },
        "events": [],
    }
    for i in range(ctx.n_events):
        ev = {
            "index": i,
            "time": round(float(ctx.onset_times[i]), 4),
            "frame": int(ctx.onset_frames[i]),
            "strength": round(float(ctx.strengths[i]), 4),
            "grid_align_score": round(float(grid_align_score[i]), 4),
            "repetition_score": round(float(repetition_score[i]), 4),
            "temporal_score": round(float(scores[i]), 4),
        }
        if np.isfinite(ioi_prev[i]):
            ev["ioi_prev"] = round(float(ioi_prev[i]), 4)
        if np.isfinite(ioi_next[i]):
            ev["ioi_next"] = round(float(ioi_next[i]), 4)
        out["events"].append(ev)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    if project_root is not None:
        _copy_to_web_public(path, Path(project_root))
    return path


def write_spectral_json(
    ctx: OnsetContext,
    scores: np.ndarray,
    extras: dict,
    path: Path | str,
    source: str = "unknown",
    project_root: Optional[Path | str] = None,
) -> Path:
    """context + spectral (scores, extras) → onset_events_spectral.json 형식."""
    path = Path(path)
    _ensure_dir(path)
    centroids = extras["centroids"]
    bandwidths = extras["bandwidths"]
    flatnesses = extras["flatnesses"]
    out = {
        "metadata": {
            "source": source,
            "sr": int(ctx.sr),
            "duration_sec": round(float(ctx.duration), 4),
            "hop_length": DEFAULT_HOP_LENGTH,
            "n_fft": DEFAULT_N_FFT,
            "bpm": round(float(ctx.bpm), 2),
            "total_events": ctx.n_events,
        },
        "events": [],
    }
    for i in range(ctx.n_events):
        ev = {
            "index": i,
            "time": round(float(ctx.onset_times[i]), 4),
            "frame": int(ctx.onset_frames[i]),
            "strength": round(float(ctx.strengths[i]), 4),
            "spectral_centroid_hz": round(float(centroids[i]), 2) if np.isfinite(centroids[i]) else None,
            "spectral_bandwidth_hz": round(float(bandwidths[i]), 2) if np.isfinite(bandwidths[i]) else None,
            "spectral_flatness": round(float(flatnesses[i]), 4) if np.isfinite(flatnesses[i]) else None,
            "focus_score": round(float(scores[i]), 4),
        }
        out["events"].append(ev)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    if project_root is not None:
        _copy_to_web_public(path, Path(project_root))
    return path


def write_context_json(
    ctx: OnsetContext,
    scores: np.ndarray,
    extras: dict,
    path: Path | str,
    source: str = "unknown",
    project_root: Optional[Path | str] = None,
) -> Path:
    """context + context_dependency (scores, extras) → onset_events_context.json 형식."""
    path = Path(path)
    _ensure_dir(path)
    snr_db = extras["snr_db"]
    masking_low = extras["masking_low"]
    masking_mid = extras["masking_mid"]
    masking_high = extras["masking_high"]
    out = {
        "metadata": {
            "source": source,
            "sr": int(ctx.sr),
            "duration_sec": round(float(ctx.duration), 4),
            "hop_length": DEFAULT_HOP_LENGTH,
            "n_fft": DEFAULT_N_FFT,
            "bpm": round(float(ctx.bpm), 2),
            "event_win_sec": EVENT_WIN_SEC,
            "bg_win_sec": BG_WIN_SEC,
            "total_events": ctx.n_events,
        },
        "events": [],
    }
    for i in range(ctx.n_events):
        out["events"].append({
            "index": i,
            "time": round(float(ctx.onset_times[i]), 4),
            "frame": int(ctx.onset_frames[i]),
            "strength": round(float(ctx.strengths[i]), 4),
            "snr_db": round(float(snr_db[i]), 2),
            "masking_low": round(float(masking_low[i]), 4),
            "masking_mid": round(float(masking_mid[i]), 4),
            "masking_high": round(float(masking_high[i]), 4),
            "dependency_score": round(float(scores[i]), 4),
        })
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    if project_root is not None:
        _copy_to_web_public(path, Path(project_root))
    return path


# 역할별 시각화용 색상 (P0=메인, P1=패턴, P2=뉘앙스)
LAYER_COLORS = {"P0": "#2ecc71", "P1": "#f39c12", "P2": "#3498db"}


def _streams_to_json_serializable(streams: list[dict]) -> list[dict]:
    """streams 내 events를 list[float]로, 숫자는 round."""
    out = []
    for s in streams:
        o = dict(s)
        if "events" in o:
            o["events"] = [round(float(t), 4) for t in o["events"]]
        if "strengths" in o and isinstance(o["strengths"], (list, tuple)):
            o["strengths"] = [round(float(x), 4) for x in o["strengths"]]
        for key in ("start", "end", "median_ioi", "ioi_std", "density", "strength_median"):
            if key in o and isinstance(o[key], (int, float)):
                o[key] = round(float(o[key]), 4)
        out.append(o)
    return out


def write_layered_json(
    ctx: OnsetContext,
    metrics: dict[str, np.ndarray],
    role_composition: list[dict],
    path: Path | str,
    source: str = "unknown",
    project_root: Optional[Path | str] = None,
) -> Path:
    """
    band 기반 역할 구성 + 5개 지표를 한 JSON으로 저장.
    events[] 각 항목: time, t, roles: { P0: band[], P1: band[], P2: band[] }, layer(시각화용 주 역할), color.
    """
    path = Path(path)
    _ensure_dir(path)
    n_events = ctx.n_events
    n_comp = len(role_composition)
    # 카운트는 실제 내보내는 이벤트 수 기준. P0=이벤트 수, P1/P2=역할이 하나라도 있는 이벤트 수
    role_band_counts = {"P0": n_events, "P1": 0, "P2": 0}
    for i in range(min(n_events, n_comp)):
        ev = role_composition[i]
        if ev.get("P1"):
            role_band_counts["P1"] += 1
        if ev.get("P2"):
            role_band_counts["P2"] += 1

    E = metrics["energy"]
    C = metrics["clarity"]
    T = metrics["temporal"]
    F = metrics["focus"]
    D = metrics["dependency"]

    out = {
        "source": source,
        "sr": int(ctx.sr),
        "duration_sec": round(float(ctx.duration), 4),
        "total_events": ctx.n_events,
        "layer_counts": role_band_counts,
        "events": [],
    }
    for i in range(n_events):
        comp = role_composition[i] if i < n_comp else {"P0": ["mid"], "P1": [], "P2": []}
        p0_bands = comp["P0"] if isinstance(comp["P0"], list) else [comp["P0"]]
        p1_list = list(comp.get("P1") or [])
        p2_list = list(comp.get("P2") or [])
        roles = {"P0": sorted(p0_bands), "P1": sorted(p1_list), "P2": p2_list}
        primary = "P2" if p2_list else "P1" if p1_list else "P0"
        out["events"].append({
            "time": round(float(ctx.onset_times[i]), 4),
            "t": round(float(ctx.onset_times[i]), 4),
            "roles": roles,
            "layer": primary,
            "strength": round(float(ctx.strengths[i]), 4),
            "color": LAYER_COLORS.get(primary, DEFAULT_POINT_COLOR),
            "energy_score": round(float(E[i]), 4),
            "clarity_score": round(float(C[i]), 4),
            "temporal_score": round(float(T[i]), 4),
            "focus_score": round(float(F[i]), 4),
            "dependency_score": round(float(D[i]), 4),
        })
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    if project_root is not None:
        _copy_to_web_public(path, Path(project_root))
    return path


def write_streams_sections_json(
    path: Path | str,
    source: str,
    sr: int,
    duration_sec: float,
    streams: list[dict],
    sections: list[dict],
    keypoints: list[dict],
    project_root: Optional[Path | str] = None,
    events: Optional[list[dict]] = None,
) -> Path:
    """
    스트림·섹션·키포인트·(선택) events 저장 (07 전용).
    events: 정밀도 기반 P0/P1/P2 역할(roles) 포함 시 레이어 표시용.
    """
    path = Path(path)
    _ensure_dir(path)
    out = {
        "source": source,
        "sr": int(sr),
        "duration_sec": round(float(duration_sec), 4),
        "streams": _streams_to_json_serializable(streams),
        "sections": sections,
        "keypoints": keypoints,
    }
    if events is not None:
        out["events"] = events
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    if project_root is not None:
        _copy_to_web_public(path, Path(project_root))
    return path


def write_drum_band_energy_json(
    result: dict,
    path: Path | str,
    project_root: Optional[Path | str] = None,
) -> Path:
    """
    compute_drum_band_energy() 반환값을 drum_band_energy.json 형식으로 저장.
    result: { source, duration_sec, sr, total_events, events: [ { t, energy_low, energy_mid, energy_high }, ... ] }
    """
    path = Path(path)
    _ensure_dir(path)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    if project_root is not None:
        _copy_to_web_public(path, Path(project_root))
    return path
