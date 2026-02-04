import argparse
import json
import os
import subprocess
import tempfile
from pathlib import Path
import sys


def run_motion(video_path: str, out_json: str) -> None:
    cmd = ["python", "motion/pipelines/motion_pipeline.py", "--video", video_path, "--out", out_json]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout or "motion pipeline failed")


def extract_audio(video_path: str, out_wav: str) -> None:
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "44100",
        out_wav,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout or "ffmpeg extract failed")


def run_music(audio_path: str, out_json: str) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    music_root = repo_root / "music-analyzer"
    if str(music_root) not in sys.path:
        sys.path.insert(0, str(music_root))
    # Import locally to avoid import errors if deps missing
    from audio_engine.engine.stems import separate as demucs_separate
    from audio_engine.engine.onset.pipeline import filter_y_into_bands
    from audio_engine.engine.onset.constants import BAND_HZ
    from audio_engine.engine.onset import (
        compute_cnn_band_onsets_with_odf,
        select_key_onsets_by_band,
        merge_texture_blocks_by_band,
        write_streams_sections_json,
    )
    import librosa
    import soundfile as sf

    audio_path = Path(audio_path)
    work_dir = Path(out_json).parent
    stem_out_dir = work_dir / "stems"

    demucs_separate(str(audio_path), out_dir=str(stem_out_dir), model_name="htdemucs")

    track_name = audio_path.stem
    stem_dir = stem_out_dir / "htdemucs" / track_name
    drums_path = stem_dir / "drums.wav"
    if drums_path.exists():
        y, sr = librosa.load(str(drums_path), sr=None, mono=True)
        y_low, y_mid, y_high = filter_y_into_bands(y, sr, BAND_HZ)
        sf.write(str(stem_dir / "drum_low.wav"), y_low, sr)
        sf.write(str(stem_dir / "drum_mid.wav"), y_mid, sr)
        sf.write(str(stem_dir / "drum_high.wav"), y_high, sr)

    band_onsets, band_strengths, duration, sr = compute_cnn_band_onsets_with_odf(
        track_name,
        stem_out_dir / "htdemucs",
    )
    keypoints_by_band = select_key_onsets_by_band(
        band_onsets,
        band_strengths,
        duration,
        sr,
    )
    texture_blocks_by_band = merge_texture_blocks_by_band(band_onsets, band_strengths)
    # We only need per-band keypoints for matching; keep streams/sections empty.
    write_streams_sections_json(
        out_json,
        track_name,
        sr,
        duration,
        [],
        [],
        [],
        keypoints_by_band=keypoints_by_band,
        texture_blocks_by_band=texture_blocks_by_band,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--out_dir", default="experiments/matching/out")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    motion_json = out_dir / "motion_result.json"
    music_json = out_dir / "streams_sections_cnn.json"

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        local_video = tmp / "input.mp4"
        local_audio = tmp / "extracted.wav"
        local_video.write_bytes(Path(args.video).read_bytes())

        print("[1/3] motion pipeline")
        run_motion(str(local_video), str(motion_json))

        print("[2/3] extract audio")
        extract_audio(str(local_video), str(local_audio))

        print("[3/3] music analyzer")
        run_music(str(local_audio), str(music_json))

    print("motion_json:", motion_json)
    print("music_json:", music_json)


if __name__ == "__main__":
    main()
