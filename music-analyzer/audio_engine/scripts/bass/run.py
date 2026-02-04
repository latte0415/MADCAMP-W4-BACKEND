from __future__ import annotations
"""
베이스 전용: run_bass_pipeline 호출 → curve, keypoints dict.
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

from audio_engine.engine.bass import run_bass_pipeline


def run(bass_wav_path: str | Path, sr: int | None = None):
    """
    bass.wav 한 파일에 대해 베이스 파이프라인 실행.

    Returns:
        {"curve": [...], "keypoints": [...]} — write_streams_sections_json(..., bass=...)에 전달.
    """
    return run_bass_pipeline(bass_wav_path, sr=sr)


if __name__ == "__main__":
    import sys as _sys
    if len(_sys.argv) < 2:
        print("Usage: python -m audio_engine.scripts.bass.run <bass.wav path>")
        _sys.exit(1)
    path = Path(_sys.argv[1])
    sr = int(_sys.argv[2]) if len(_sys.argv) > 2 else None
    out = run(path, sr=sr)
    print(f"curve: {len(out.get('curve', []))}개, keypoints: {len(out.get('keypoints', []))}개")
