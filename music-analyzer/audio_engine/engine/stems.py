"""
Stem 분리 (Demucs/Spleeter wrapper)
"""
import shutil
import subprocess
from pathlib import Path

import librosa
import soundfile as sf


def _ensure_wav(audio_path: Path, out_dir: Path) -> Path:
    """MP3 등 비-WAV 파일을 WAV로 변환해 반환. (Demucs/torchaudio torchcodec 이슈 회피)"""
    if audio_path.suffix.lower() == ".wav":
        return audio_path
    y, sr = librosa.load(str(audio_path), sr=None, mono=False)
    if y.ndim == 1:
        y = y.reshape(1, -1)
    # Demucs가 트랙 폴더명으로 입력 파일 stem 사용 → 원본과 동일한 이름으로 저장
    wav_path = out_dir / (audio_path.stem + "_input.wav")
    sf.write(str(wav_path), y.T, sr)
    return wav_path


def separate(
    audio_path: str,
    out_dir: str | None = None,
    model_name: str = "htdemucs",
    two_stems: str | None = None,
) -> dict[str, str]:
    """
    Demucs로 오디오를 stem별로 분리합니다.

    Args:
        audio_path: 입력 오디오 파일 경로 (wav, mp3 등)
        out_dir: 출력 디렉터리. None이면 입력 파일과 같은 디렉터리/stems
        model_name: Demucs 모델 이름 (htdemucs, htdemucs_ft 등)
        two_stems: "vocals" 등으로 지정 시 보컬/나머지 2개만 생성

    Returns:
        stem 이름 -> wav 파일 경로 딕셔너리 (vocals, drums, bass, other)
    """
    audio_path = Path(audio_path).resolve()
    if not audio_path.exists():
        raise FileNotFoundError(f"오디오 파일 없음: {audio_path}")

    if out_dir is None:
        out_dir = audio_path.parent / "stems"
    out_dir = Path(out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    track_name = audio_path.stem
    # MP3 등은 WAV로 변환 후 Demucs에 전달 (torchcodec 미설치 시 오류 방지)
    input_path = _ensure_wav(audio_path, out_dir)
    
    try:
        # Demucs는 입력 파일 stem으로 출력 서브폴더 이름 결정 → stem.wav로 넘기면 폴더명이 track_name과 일치
        temp_wav = out_dir / (track_name + ".wav")
        if input_path != audio_path:
            shutil.copy2(input_path, temp_wav)
            demucs_input = temp_wav
        else:
            demucs_input = input_path
        cmd = [
            "demucs",
            "-n", model_name,
            "-o", str(out_dir),
            str(demucs_input),
        ]
        if two_stems:
            cmd.extend(["--two-stems", two_stems])

        subprocess.run(cmd, check=True)
    finally:
        # 변환된 임시 WAV 삭제
        if input_path != audio_path.resolve() and input_path.exists():
            input_path.unlink(missing_ok=True)
        temp_wav = out_dir / (track_name + ".wav")
        if temp_wav.exists():
            temp_wav.unlink(missing_ok=True)

    # Demucs 출력 구조: out_dir / model_name / track_name / {vocals,drums,bass,other}.wav
    stem_dir = out_dir / model_name / track_name
    stems = ["vocals", "drums", "bass", "other"]
    if two_stems == "vocals":
        stems = ["vocals", "no_vocals"]

    result = {}
    for name in stems:
        wav_path = stem_dir / f"{name}.wav"
        if wav_path.exists():
            result[name] = str(wav_path)
    return result
