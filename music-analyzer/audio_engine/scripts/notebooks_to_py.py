#!/usr/bin/env python3
"""노트북(.ipynb)을 # %% 셀 단위 .py 파일로 변환. notebooks/ → scripts/ 동일 구조."""
import json
from pathlib import Path

AUDIO_ENGINE = Path(__file__).resolve().parent.parent
NOTEBOOKS = AUDIO_ENGINE / "notebooks"
SCRIPTS = AUDIO_ENGINE / "scripts"

MAPPING = [
    (NOTEBOOKS / "01_basic_test" / "01_explore.ipynb", SCRIPTS / "01_basic_test" / "01_explore.py"),
    (NOTEBOOKS / "01_basic_test" / "02_split_stem.ipynb", SCRIPTS / "01_basic_test" / "02_split_stem.py"),
    (NOTEBOOKS / "01_basic_test" / "03_visualize_point.ipynb", SCRIPTS / "01_basic_test" / "03_visualize_point.py"),
    (NOTEBOOKS / "02_layered_onset_export" / "01_energy.ipynb", SCRIPTS / "02_layered_onset_export" / "01_energy.py"),
    (NOTEBOOKS / "02_layered_onset_export" / "02_clarity.ipynb", SCRIPTS / "02_layered_onset_export" / "02_clarity.py"),
]


def cell_to_py(cell: dict) -> str:
    cell_type = cell.get("cell_type", "code")
    source = cell.get("source", [])
    if isinstance(source, list):
        text = "".join(source)
    else:
        text = source
    if not text.endswith("\n") and text:
        text += "\n"

    if cell_type == "markdown":
        lines = ["# " + line if line.strip() else "#" for line in text.split("\n")]
        return "\n".join(lines) + "\n"
    return text


def convert(ipynb_path: Path, py_path: Path) -> None:
    raw = ipynb_path.read_text(encoding="utf-8")
    nb = json.loads(raw)
    parts = []
    for cell in nb.get("cells", []):
        block = cell_to_py(cell)
        if cell.get("cell_type") == "code":
            parts.append("# %%\n" + block)
        else:
            parts.append("# %% [markdown]\n" + block)
    py_path.parent.mkdir(parents=True, exist_ok=True)
    content = "\n".join(parts).strip()
    if not content.startswith("# %%"):
        content = "# %%\n" + content
    py_path.write_text(content, encoding="utf-8")
    print(py_path.relative_to(AUDIO_ENGINE))


def main():
    for ipynb, py in MAPPING:
        if ipynb.exists():
            convert(ipynb, py)
        else:
            print("skip (not found):", ipynb)


if __name__ == "__main__":
    main()
