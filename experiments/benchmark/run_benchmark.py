import argparse
import json
import subprocess
from typing import List
import sys
import time
from pathlib import Path


def run_cmd(cmd: List[str]) -> None:
    proc = subprocess.run(cmd)
    if proc.returncode != 0:
        raise RuntimeError("command failed")


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
    run_cmd(cmd)


def run_motion(video_path: str, out_json: str) -> None:
    cmd = ["python", "motion/pipelines/motion_pipeline.py", "--video", video_path, "--out", out_json]
    run_cmd(cmd)


def run_motion_proc(video_path: str, out_json: str) -> subprocess.Popen:
    cmd = ["python", "motion/pipelines/motion_pipeline.py", "--video", video_path, "--out", out_json]
    return subprocess.Popen(cmd)


def run_music(audio_path: str, out_json: str) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    music_root = repo_root / "music-analyzer"
    if str(music_root) not in sys.path:
        sys.path.insert(0, str(music_root))
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


def run_music_proc(audio_path: str, out_json: str) -> subprocess.Popen:
    cmd = ["python", __file__, "--_music_only", "--audio", audio_path, "--out_json", out_json]
    return subprocess.Popen(cmd)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video")
    parser.add_argument("--out_dir", default="experiments/benchmark/out")
    parser.add_argument("--no_motion", action="store_true")
    parser.add_argument("--no_music", action="store_true")
    parser.add_argument("--parallel", action="store_true")
    parser.add_argument("--_music_only", action="store_true")
    parser.add_argument("--audio")
    parser.add_argument("--out_json")
    args = parser.parse_args()

    if args._music_only:
        if not args.audio or not args.out_json:
            raise RuntimeError("--_music_only requires --audio and --out_json")
        run_music(args.audio, args.out_json)
        return

    if not args.video:
        raise RuntimeError("--video is required")

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    timings = {}
    start_total = time.perf_counter()

    motion_json = out_dir / "motion_result.json"
    music_json = out_dir / "streams_sections_cnn.json"
    audio_path = out_dir / "extracted_audio.wav"

    if args.parallel and (not args.no_motion) and (not args.no_music):
        t0 = time.perf_counter()
        extract_audio(args.video, str(audio_path))
        timings["extract_audio_sec"] = round(time.perf_counter() - t0, 3)

        print("[motion] start")
        motion_start = time.perf_counter()
        motion_proc = run_motion_proc(args.video, str(motion_json))

        print("[music] start")
        music_start = time.perf_counter()
        music_proc = run_music_proc(str(audio_path), str(music_json))

        motion_proc.wait()
        if motion_proc.returncode != 0:
            raise RuntimeError("motion pipeline failed")
        timings["motion_sec"] = round(time.perf_counter() - motion_start, 3)
        print("[motion] done in", timings["motion_sec"], "sec")

        music_proc.wait()
        if music_proc.returncode != 0:
            raise RuntimeError("music pipeline failed")
        timings["music_sec"] = round(time.perf_counter() - music_start, 3)
        print("[music] done in", timings["music_sec"], "sec")
    else:
        if not args.no_motion:
            print("[motion] start")
            t0 = time.perf_counter()
            run_motion(args.video, str(motion_json))
            timings["motion_sec"] = round(time.perf_counter() - t0, 3)
            print("[motion] done in", timings["motion_sec"], "sec")

        if not args.no_music:
            print("[music] start")
            t0 = time.perf_counter()
            extract_audio(args.video, str(audio_path))
            timings["extract_audio_sec"] = round(time.perf_counter() - t0, 3)

            t0 = time.perf_counter()
            run_music(str(audio_path), str(music_json))
            timings["music_sec"] = round(time.perf_counter() - t0, 3)
            print("[music] done in", timings["music_sec"], "sec")

    timings["total_sec"] = round(time.perf_counter() - start_total, 3)

    summary_path = out_dir / "timings.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(timings, f, ensure_ascii=False, indent=2)
    print(json.dumps(timings, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
