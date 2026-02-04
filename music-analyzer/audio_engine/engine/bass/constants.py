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

# Step C: duration 하한 — 이보다 짧은 segment만 흡수. 16분음(120 BPM ≈ 0.125s) 허용
MIN_SEGMENT_DURATION_SEC = 0.125

# Note segmentation: pitch 경계 + energy onset 경계 병합
# onset 하나당 노트 후보 1개 생성 시 사용하는 고정 창 길이
NOTE_WIN_SEC = 0.18  # 120~250ms: 한 onset당 노트 후보 창
MIN_NOTE_DURATION_SEC = 0.06  # 60ms까지 허용 (8분음/16분음 보존)
# 병합 시: 다음 구간 energy_peak이 이 비율 미만이면 병합 안 함 (energy_drop = 별도 노트)
ENERGY_DROP_NO_MERGE_RATIO = 0.6
DECAY_ENERGY_RATIO = 0.2      # note.end = last time energy > peak * ratio
# Energy peak → onset: 피크 앞 구간에서 최소점을 onset으로 사용
ENERGY_PEAK_MIN_DISTANCE_FRAMES = 2   # 피크 간 최소 거리 (프레임)
ENERGY_PEAK_HEIGHT_PERCENTILE = 5.0   # 피크 후보: 이 percentile 이상
ENERGY_ONSET_LOOKBACK_FRAMES = 30     # 피크 기준 앞으로 이만큼에서 onset(최소점) 탐색
# Energy derivative: 상승 시작도 onset 후보 (피크가 둔할 때 보완)
ENERGY_RISE_DERIV_PERCENTILE = 10.0   # diff > 이 percentile(양의 diff) 이면 상승으로 간주
ENERGY_RISE_MIN_GAP_FRAMES = 3        # 연속 상승 프레임 묶음 간 최소 간격

# RDP: epsilon을 semitone 기준으로 정의 (곡마다 일관성)
RDP_EPSILON_SEMITONE = 0.5

# Keypoints (레거시·note 모드에서는 미사용)
LEAP_SEMITONE_THRESHOLD = 5.0
ACCENT_PERCENTILE = 85.0
