"""
베이스 분석 전용 상수.
pitch tracking, energy, curve cleaning, RDP, keypoints.
"""

# Pitch tracking (librosa.pyin)
BASS_HOP_LENGTH = 256
BASS_FMIN = 50.0
BASS_FMAX = 250.0
BASS_FRAME_LENGTH = 2048

# Energy envelope (frame grid = pitch grid)
BASS_BANDPASS_HZ = (40.0, 300.0)
BASS_ENERGY_WIN_LENGTH = 512

# Curve cleaning & segmentation (Step A, B)
DELTA_SEMITONE = 0.4
JUMP_SEMITONE = 3.0
CONFIDENCE_THRESHOLD = 0.5

# Step C: duration 하한 — 이보다 짧은 segment는 흡수 또는 curve에서 제거
MIN_SEGMENT_DURATION_SEC = 0.2

# RDP: epsilon을 semitone 기준으로 정의 (곡마다 일관성)
RDP_EPSILON_SEMITONE = 0.5

# Keypoints
LEAP_SEMITONE_THRESHOLD = 5.0
ACCENT_PERCENTILE = 85.0
