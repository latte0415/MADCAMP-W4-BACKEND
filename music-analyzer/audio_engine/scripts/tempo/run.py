"""
BPM 유추 및 BPM 기준 마디 표시 메인 파이프라인 실행.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

_dir = os.path.dirname(os.path.abspath(__file__))
_scripts = os.path.dirname(_dir)
if _scripts not in sys.path:
    sys.path.insert(0, _scripts)
from _common import find_project_root

project_root = find_project_root()
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from audio_engine.engine.tempo.pipeline import run_tempo_pipeline


def run(audio_path: str | Path, *, write_json: bool = False, out_path: str | Path | None = None):
    """
    오디오 파일에 대해 BPM·마디 메인 파이프라인 실행.

    Returns:
        {"bpm": float, "bars": [...], "beats": [...], "duration_sec": float}
    """
    out = run_tempo_pipeline(audio_path)
    if write_json and out_path:
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=2, ensure_ascii=False)
    return out


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m audio_engine.scripts.tempo.run <audio.wav> [--write-json [path]]")
        sys.exit(1)
    path = Path(sys.argv[1])
    write_json = "--write-json" in sys.argv
    out_path = None
    if write_json:
        idx = sys.argv.index("--write-json")
        if idx + 1 < len(sys.argv) and not sys.argv[idx + 1].startswith("-"):
            out_path = Path(sys.argv[idx + 1])
        else:
            samples_dir = Path(project_root) / "audio_engine" / "samples"
            out_path = samples_dir / "tempo_bars.json"
    result = run(path, write_json=write_json, out_path=out_path)
    print(f"BPM: {result['bpm']:.1f}")
    print(f"마디: {len(result['bars'])}개")
    if out_path:
        print(f"저장: {out_path}")
