"""
베이스 v4 (madmom onset) 테스트: bass.wav → run_bass_v4 → StreamsSectionsData 형식 JSON 저장.
웹 탭 "14b Bass v4"에서 로드할 수 있도록 web/public/bass_v4.json에 저장.
"""
import json
import sys
import os
from pathlib import Path

_dir = os.path.dirname(os.path.abspath(__file__))
_scripts = os.path.dirname(_dir)
if _scripts not in sys.path:
    sys.path.insert(0, _scripts)
from _common import find_project_root

project_root = find_project_root()
if project_root not in sys.path:
    sys.path.insert(0, project_root)

import librosa
from audio_engine.engine.bass.bass_v4 import run_bass_v4


def run(bass_wav_path: str | Path, out_path: str | Path | None = None):
    """
    bass.wav에 대해 run_bass_v4 실행 후 StreamsSectionsData 형식으로 저장.

    out_path 미지정 시 project_root/web/public/bass_v4.json
    """
    path = Path(bass_wav_path)
    if not path.exists():
        raise FileNotFoundError(f"bass wav 없음: {path}")

    y, sr = librosa.load(str(path), sr=None, mono=True)
    duration_sec = len(y) / sr

    out = run_bass_v4(path, sr=sr)
    payload = {
        "source": "bass_v4",
        "sr": int(sr),
        "duration_sec": round(duration_sec, 4),
        "streams": [],
        "sections": [],
        "keypoints": [],
        "bass": out,
    }
    if out_path is None:
        out_path = Path(project_root) / "web" / "public" / "bass_v4.json"
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return payload, out_path


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m audio_engine.scripts.bass.run_v4 <bass.wav> [out.json]")
        sys.exit(1)
    bass_path = Path(sys.argv[1])
    out_file = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    payload, written = run(bass_path, out_path=out_file)
    n = len(payload.get("bass", {}).get("notes", []))
    print(f"notes: {n}개, 저장: {written}")
