"""
Vocal 전용: vocal_curve + vocal_keypoints → write_streams_sections_json(..., vocal=...)에 전달.
"""
import sys
import os
from pathlib import Path

_dir = os.path.dirname(os.path.abspath(__file__))
_scripts = os.path.dirname(_dir)
if _scripts not in sys.path:
    sys.path.insert(0, _scripts)
from _common import find_project_root, get_stems_base_dir
project_root = find_project_root()
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from audio_engine.engine.vocal.vocal_curve import run_vocal_curve
from audio_engine.engine.vocal.vocal_onsets import compute_vocal_onsets
from audio_engine.engine.vocal.vocal_phrases import (
    USE_PHRASE,
    compute_vocal_phrases,
    compute_vocal_turns,
)
from audio_engine.engine.vocal.export import build_vocal_output


def run(vocal_wav_path: str | Path, sr: int | None = None) -> dict:
    """
    vocals.wav 한 파일에 대해 vocal 곡선 + (phrase 또는 Turn+onset) 실행.
    USE_PHRASE=False: vocal_curve + vocal_turns + vocal_onsets(activation peak).
    """
    result = run_vocal_curve(vocal_wav_path, sr=sr, include_centroid=True)
    curve = result["vocal_curve"]
    meta = result.get("vocal_curve_meta", {})
    activation = result.get("vocal_activation")
    duration_sec = None
    if curve:
        duration_sec = curve[-1].get("t", 0) - curve[0].get("t", 0) + 0.02
    if USE_PHRASE:
        phrases, keypoints_flat = compute_vocal_phrases(
            curve, duration_sec=duration_sec, activation=activation
        )
        return build_vocal_output(curve, keypoints_flat, meta, vocal_phrases=phrases)
    turns = compute_vocal_turns(curve, duration_sec=duration_sec)
    keypoints_flat = [
        {"t": g["t"], "type": "turn", "direction": g.get("direction"), "delta_pitch": g.get("delta_pitch"), "score": g.get("score")}
        for g in turns
    ]
    onsets: list[dict] = []
    import numpy as np
    t_arr = np.array([p["t"] for p in curve], dtype=np.float64)
    if activation is not None and len(activation) == len(curve):
        act_arr = np.array(activation, dtype=np.float64)
        onsets = compute_vocal_onsets(t_arr, act_arr, duration_sec=duration_sec)
    else:
        # activation 없거나 길이 불일치 시 amp 곡선으로 onset 추출 (fallback)
        from audio_engine.engine.vocal.vocal_onsets import compute_vocal_onsets_from_amp
        amp_arr = np.array([p.get("amp", 0.0) for p in curve], dtype=np.float64)
        onsets = compute_vocal_onsets_from_amp(t_arr, amp_arr, duration_sec=duration_sec)
    if onsets:
        keypoints_flat.extend([{"t": g["t"], "type": "onset", "score": g.get("score"), "strength": g.get("strength")} for g in onsets])
        keypoints_flat.sort(key=lambda x: x["t"])
    return build_vocal_output(curve, keypoints_flat, meta, vocal_phrases=[], vocal_turns=turns, vocal_onsets=onsets if onsets else None)


if __name__ == "__main__":
    import sys as _sys
    if len(_sys.argv) < 2:
        print("Usage: python -m audio_engine.scripts.vocal.run <vocals.wav path>")
        _sys.exit(1)
    path = Path(_sys.argv[1])
    sr = int(_sys.argv[2]) if len(_sys.argv) > 2 else None
    out = run(path, sr=sr)
    print(f"vocal_curve: {len(out.get('vocal_curve', []))} points, vocal_keypoints: {len(out.get('vocal_keypoints', []))}, vocal_phrases: {len(out.get('vocal_phrases', []))}")
