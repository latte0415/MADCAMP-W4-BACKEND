# Onset 모듈 구조 (실제 코드 기준)

`audio_engine/engine/onset/` 레이어(L1~L5)와 공개 API, 검증 방법을 정리합니다.

---

## 1. 디렉터리·파일

| 레이어 | 경로 | 역할 |
|--------|------|------|
| L1 | `onset/types.py` | `OnsetContext` 등 타입 |
| L1 | `onset/constants.py` | 상수(hop_length, BAND_HZ, CLARITY_ATTACK_* 등) |
| L1 | `onset/utils.py` | `robust_norm` |
| L2 | `onset/pipeline.py` | `detect_onsets`, `refine_onset_times`, `build_context`, `build_context_with_band_evidence` (anchor + band evidence 연결) |
| L2 | `onset/band_classification.py` | `compute_band_hz` (적응형+고정 혼합 저/중/고 경계) |
| L3 | `onset/features/energy.py` | `compute_energy(ctx, band_hz=None)` |
| L3 | `onset/features/clarity.py` | `compute_clarity` |
| L3 | `onset/features/temporal.py` | `compute_temporal` |
| L3 | `onset/features/spectral.py` | `compute_spectral` |
| L3 | `onset/features/context.py` | `compute_context_dependency` |
| L4 | `onset/scoring.py` | `normalize_metrics_per_track`, `assign_roles_by_band` (band 기반 역할 할당) |
| L2-ext | `onset/streams.py` | `build_streams(band_onset_times, band_onset_strengths)` |
| L2-ext | `onset/sections.py` | `segment_sections(streams, duration)` |
| L2-ext | `onset/band_onset_merge.py` | `merge_close_onsets`, `merge_close_band_onsets`, `filter_by_strength`, `filter_transient_mid_high` (쉐이커·클랩 병합·트랜지언트 필터) |
| L2-ext | `onset/stream_simplify.py` | `simplify_shaker_clap_streams` (mid/high 고밀도 스트림 temporal pooling) |
| L2-ext | `onset/stream_layer.py` | `assign_layer_to_streams` (스트림별 P0/P1/P2) |
| L2-ext | `onset/cnn_band_pipeline.py` | `compute_cnn_band_onsets_with_odf` (CNN+ODF band onset) |
| L2-ext | `onset/cnn_band_onsets.py` | `compute_cnn_band_onsets` (madmom CNN band onset) |
| L2-ext | `onset/drum_band_energy.py` | `compute_drum_band_energy` |
| L2-ext | `onset/madmom_drum_band.py` | `compute_madmom_drum_band_keypoints` |
| L5 | `onset/export.py` | `write_energy_json`, …, `write_layered_json`, `write_streams_sections_json`, `write_drum_band_energy_json` |
| L6 | `audio_engine/scripts/02_layered_onset_export/01_energy.py` ~ `11_cnn_streams_layers.py` | 엔트리 스크립트 |

---

## 2. 공개 API (`__init__.py` 기준)

패키지에서 re-export되는 심볼은 아래와 같습니다.

```python
from audio_engine.engine.onset import (
    # L1
    OnsetContext,
    DEFAULT_HOP_LENGTH,
    DEFAULT_HOP_REFINE,
    DEFAULT_WIN_REFINE_SEC,
    BAND_HZ,
    BAND_NAMES,
    DEFAULT_N_FFT,
    DEFAULT_POINT_COLOR,
    robust_norm,
    # L2
    detect_onsets,
    refine_onset_times,
    build_context,
    build_context_with_band_evidence,
    compute_band_hz,
    # L2-ext (streams / CNN / drum band)
    build_streams,
    segment_sections,
    compute_cnn_band_onsets_with_odf,
    compute_cnn_band_onsets,
    compute_drum_band_energy,
    compute_madmom_drum_band_keypoints,
    assign_layer_to_streams,
    simplify_shaker_clap_streams,
    merge_close_onsets,
    merge_close_band_onsets,
    filter_by_strength,
    # L3
    compute_energy,
    compute_clarity,
    compute_temporal,
    compute_spectral,
    compute_context_dependency,
    # L4
    normalize_metrics_per_track,
    assign_roles_by_band,
    # L5
    write_energy_json,
    write_clarity_json,
    write_temporal_json,
    write_spectral_json,
    write_context_json,
    write_layered_json,
    write_streams_sections_json,
    write_drum_band_energy_json,
)
```

---

## 3. OnsetContext (L1)

`types.py`에 정의. L2 `build_context`가 생성하고 L3 feature 함수에 전달됩니다.

| 필드 | 타입 | 설명 |
|------|------|------|
| `y` | np.ndarray | 오디오 샘플 |
| `sr` | int | 샘플링 레이트 |
| `duration` | float | 길이(초) |
| `onset_times` | np.ndarray | 정제된 onset 시점(초) |
| `onset_frames` | np.ndarray | onset 프레임 인덱스 |
| `strengths` | np.ndarray | onset strength |
| `bpm` | float | 추정 BPM |
| `onset_env` | np.ndarray | onset envelope |
| `beats_dynamic` | np.ndarray \| None | (Temporal) 비트 시점 |
| `tempo_dynamic` | np.ndarray \| None | (Temporal) 로컬 템포 |
| `grid_times` | np.ndarray \| None | (Temporal) 그리드 시점 |
| `grid_levels` | np.ndarray \| None | (Temporal) 그리드 레벨 |
| `bpm_dynamic_used` | bool | 로컬 템포 사용 여부 |
| `band_evidence` | list[dict] \| None | (build_context_with_band_evidence) 이벤트별 low/mid/high 증거 |
| `band_onset_times` | dict[str, np.ndarray] \| None | (build_context_with_band_evidence) band별 onset 시퀀스. 스트림/섹션용 |
| `band_onset_strengths` | dict[str, np.ndarray] \| None | (build_context_with_band_evidence) band별 onset strength |

---

## 4. 주요 상수 (L1 `constants.py`)

| 상수 | 값 | 용도 |
|------|-----|------|
| `DEFAULT_HOP_LENGTH` | 256 | Onset 검출 |
| `DEFAULT_DELTA` | 0.07 | onset_detect |
| `DEFAULT_WAIT` | 4 | onset_detect |
| `DEFAULT_HOP_REFINE` | 64 | refine_onset_times |
| `DEFAULT_WIN_REFINE_SEC` | 0.08 | refine_onset_times ±80ms |
| `BAND_HZ` | (20,200), (200,3000), (3000,10000) | 대역 에너지·드럼 kick/snare·hat 구분 |
| `EVENT_WIN_SEC` | 0.05 | Context 이벤트 윈도우 |
| `BG_WIN_SEC` | 0.1 | Context 배경 윈도우 |

---

## 5. 검증 방법

### 5.1 공개 API import

```bash
cd /path/to/music-analyzer
python -c "
from audio_engine.engine.onset import (
    OnsetContext, build_context, build_context_with_band_evidence, detect_onsets, refine_onset_times,
    compute_band_hz, compute_energy, compute_clarity, compute_temporal, compute_spectral, compute_context_dependency,
    normalize_metrics_per_track, assign_roles_by_band,
    write_energy_json, write_clarity_json, write_temporal_json, write_spectral_json, write_context_json, write_layered_json,
    build_streams, segment_sections, compute_cnn_band_onsets_with_odf, simplify_shaker_clap_streams, assign_layer_to_streams,
    merge_close_onsets, merge_close_band_onsets, filter_by_strength,
    robust_norm,
)
print('OK: 공개 API import 성공')
"
```

### 5.2 스크립트 → JSON

```bash
python audio_engine/scripts/02_layered_onset_export/01_energy.py
# ... 02 ~ 05
python audio_engine/scripts/02_layered_onset_export/06_layered_export.py
# (선택) CNN 스트림·레이어·섹션
python audio_engine/scripts/02_layered_onset_export/11_cnn_streams_layers.py
```

- 산출: `audio_engine/samples/onset_events_*.json`, `onset_events_layered.json`, (11 실행 시) `streams_sections_cnn.json`
- `web/public` 디렉터리가 있으면 동일 파일 복사

### 5.3 L3 feature 간 참조 없음

```bash
grep -r "from audio_engine.engine.onset.features" audio_engine/engine/onset/features/
# 결과 없음이면 OK
```

### 5.4 L1에서 librosa/경로 미사용

```bash
grep -l "librosa\|open(\|Path\|shutil" audio_engine/engine/onset/types.py audio_engine/engine/onset/constants.py audio_engine/engine/onset/utils.py
# 결과 없음이면 OK
```
