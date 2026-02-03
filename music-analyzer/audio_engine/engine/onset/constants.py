"""
L1 Core: 파라미터 상수.
hop_length, delta, wait, band_hz, n_fft 등. 외부 의존 없음.
"""

# Onset 검출 (librosa)
DEFAULT_HOP_LENGTH = 256
DEFAULT_DELTA = 0.07
DEFAULT_WAIT = 4

# Onset 정제 (로컬 리파인)
DEFAULT_HOP_REFINE = 64
DEFAULT_WIN_REFINE_SEC = 0.08

# STFT / 대역 (고정 크로스오버, 드럼 기준: kick / snare·body / hat·click)
DEFAULT_N_FFT = 2048
BAND_HZ = [(20, 200), (200, 3000), (3000, 10000)]
BAND_NAMES = ["Low", "Mid", "High"]

# 대역 분류 (적응형은 MVP에서 미사용; 필요 시 고정 주변 ±몇백 Hz만 허용)
BAND_HZ_FIXED_LOW_MID = 200
BAND_HZ_FIXED_MID_HIGH = 3000
BAND_BLEND_ALPHA = 0.5
BAND_ADAPTIVE_LOW_MID_RANGE = (20, 500)
BAND_ADAPTIVE_MID_HIGH_RANGE = (500, 8000)
BAND_CUMULATIVE_PERCENTILES = (33.0, 66.0)
# Anchor–band evidence 연결: ±tol(초) 이내 band onset을 해당 anchor에 attach
BAND_EVIDENCE_TOL_SEC = 0.04

# Clarity (attack time)
CLARITY_ATTACK_MIN_MS = 0.05
CLARITY_ATTACK_MAX_MS = 50.0

# Temporal
MIN_IOI_SEC = 0.05
SWING_RATIO = 1.0
LEVEL_WEIGHT = {1: 1.0, 2: 0.95, 4: 0.9, 8: 0.75, 16: 0.6}
GRID_MULTIPLES = [0.125, 0.25, 0.375, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0]
SIGMA_BEAT = 0.08
TEMPO_STD_BPM = 4

# Context dependency
EVENT_WIN_SEC = 0.05
BG_WIN_SEC = 0.1

# Streams (IOI-based rhythm stream segmentation)
IOI_MIN_SEC = 0.06
GAP_BREAK_FACTOR = 2.5
# 드럼 스윙/휴먼 타이밍 허용: 0.25 → 0.45 (25% → 45% IOI 편차)
IOI_TOLERANCE_RATIO = 0.45
# 최소 이벤트 수 완화: 8 → 5 (짧은 구간 스트림도 유지)
MIN_EVENTS_PER_STREAM = 5
MIN_STREAM_DURATION_SEC = 2.0
# 빠른 연타 보존: 0.04 → 0.03 (40ms → 30ms)
MIN_SEPARATION_SEC = 0.03
# mid/high 쉐이커·클랩 병합: min_separation보다 가까운 onset을 하나로 합침
MERGE_CLOSE_SEC_LOW = 0.03
MERGE_CLOSE_SEC_MID = 0.10   # 클랩·롤 과검출 억제 (더 많이 병합)
MERGE_CLOSE_SEC_HIGH = 0.12  # 쉐이커·하이햇 과검출 억제 (더 많이 병합)
# 대역별 onset 에너지 필터: strength 이하는 제거 (0~1, 0=비활성)
STRENGTH_FLOOR_BAND_ONSET = 0.05
# mid/high 전용: low와 동일하게 두면 손실 완화 (0.08 → 0.05)
STRENGTH_FLOOR_MID_HIGH = 0.06
# 클랩/쉐이커 필터: 어택 후/전 에너지 비율이 이 값 이상인 onset만 유지 (트랜지언트만 통과)
CLAP_SHAKER_TRANSIENT_WINDOW_SEC = 0.03
CLAP_SHAKER_TRANSIENT_RATIO_MIN = 1.8
# 쉐이커/클랩 temporal pooling: high-density 스트림 압축
POOL_WINDOW_SEC = 0.15
POOL_DENSITY_THRESHOLD = 4.0
# 2연속 miss로 스트림 끊김 완화: 2 → 5
STREAM_CONSECUTIVE_MISSES_FOR_BREAK = 5
STREAM_RUNNING_IOI_WINDOW = 8
STRENGTH_FLOOR_STREAM = 0.0  # optional; 0 = no filter

# Sections (window-based part segmentation)
SECTION_WINDOW_SEC = 2.0
SECTION_HOP_SEC = 0.5
SECTION_ACTIVE_THRESHOLD = 2  # events in window >= this => active
SECTION_CHANGE_THRESHOLD = 0.5  # or median + 3*MAD
MIN_SECTION_SEC = 4.0
SECTION_DEBOUNCE_WINDOWS = 2
SECTION_MERGE_NEAR_SEC = 1.0

# KeyOnsetSelector: 대역별 핵심 타격 선택
KEY_ONSET_MIN_SEP_SEC = 0.08  # 키포인트끼리 최소 간격 (60~120ms)
ENERGY_PERCENTILE_THRESHOLD = 20  # 이 percentile 이상만 유지 (상위 80%) — 에너지 20% 선까지 살림
ENERGY_PERCENTILE_THRESHOLD_LOW = 20  # low도 동일 (상위 80%)
# mid/high: 진폭(에너지) 기준 더 걸러서 고스트 제거 — 상위 60%만 유지
ENERGY_PERCENTILE_THRESHOLD_MID_HIGH = 40
# onset 시점 기준 짧은 구간 진폭(RMS)으로 에너지·필터링 — 파형과 비례, 손실 완화
BAND_ONSET_ENERGY_WINDOW_SEC = 0.03  # t ± 30ms 구간 RMS

# TextureBlockMerger: mid/high burst → block
BURST_IOI_SEC = 0.10  # 연속 IOI < 이 값이면 burst 후보 (80~120ms)
MIN_ONSETS_IN_BURST = 3  # 최소 K개 onset이 한 burst

# Export
DEFAULT_POINT_COLOR = "#5a9fd4"
