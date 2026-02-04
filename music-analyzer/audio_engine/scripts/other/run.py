"""
Other 전용: other_curve + other_regions → write_streams_sections_json(..., other=...)에 전달.
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

from audio_engine.engine.other.other_pipeline import run_other_pipeline


def run(other_wav_path: str | Path, sr: int | None = None) -> dict:
    """
    other.wav 한 파일에 대해 other 곡선(density) + 영역(패드) 파이프라인 실행.

    Returns:
        {"other_curve": [...], "other_keypoints": [...], "other_regions": [...], "other_meta": {...}}
    """
    return run_other_pipeline(other_wav_path, sr=sr)


if __name__ == "__main__":
    import sys as _sys
    if len(_sys.argv) < 2:
        print("Usage: python -m audio_engine.scripts.other.run <other.wav path>")
        _sys.exit(1)
    path = Path(_sys.argv[1])
    sr = int(_sys.argv[2]) if len(_sys.argv) > 2 else None
    out = run(path, sr=sr)
    print(f"other_curve: {len(out.get('other_curve', []))} points, other_regions: {len(out.get('other_regions', []))}, other_keypoints: {len(out.get('other_keypoints', []))}")
