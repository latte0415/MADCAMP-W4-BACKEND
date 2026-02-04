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
from audio_engine.engine.vocal.vocal_keypoints import compute_vocal_keypoints
from audio_engine.engine.vocal.export import build_vocal_output


def run(vocal_wav_path: str | Path, sr: int | None = None) -> dict:
    """
    vocals.wav 한 파일에 대해 vocal 곡선 + 키포인트 파이프라인 실행.

    Returns:
        {"vocal_curve": [...], "vocal_keypoints": [...], "vocal_curve_meta": {...}}
    """
    result = run_vocal_curve(vocal_wav_path, sr=sr, include_centroid=True)
    curve = result["vocal_curve"]
    meta = result.get("vocal_curve_meta", {})
    keypoints = compute_vocal_keypoints(curve)
    return build_vocal_output(curve, keypoints, meta)


if __name__ == "__main__":
    import sys as _sys
    if len(_sys.argv) < 2:
        print("Usage: python -m audio_engine.scripts.vocal.run <vocals.wav path>")
        _sys.exit(1)
    path = Path(_sys.argv[1])
    sr = int(_sys.argv[2]) if len(_sys.argv) > 2 else None
    out = run(path, sr=sr)
    print(f"vocal_curve: {len(out.get('vocal_curve', []))} points, vocal_keypoints: {len(out.get('vocal_keypoints', []))}")
