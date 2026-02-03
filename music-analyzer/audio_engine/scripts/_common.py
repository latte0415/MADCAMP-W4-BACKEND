"""
스크립트 공용: 프로젝트 루트·스템 경로.
"""
import os
from pathlib import Path


def find_project_root() -> str:
    """audio_engine + web 이 있는 디렉터리를 project_root로 반환."""
    cwd = os.path.abspath(os.getcwd())
    while cwd:
        if os.path.isdir(os.path.join(cwd, "audio_engine")) and os.path.isdir(
            os.path.join(cwd, "web")
        ):
            return cwd
        cwd = os.path.dirname(cwd)
    return os.path.abspath(os.path.join(os.path.dirname(os.getcwd()), "..", ".."))


def get_stems_base_dir(project_root: str | Path | None = None) -> str:
    """samples/stems/htdemucs 경로. project_root 없으면 find_project_root() 사용."""
    if project_root is None:
        project_root = find_project_root()
    return os.path.join(str(project_root), "audio_engine", "samples", "stems", "htdemucs")
