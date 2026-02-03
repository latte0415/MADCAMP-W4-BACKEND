# 작업 과정 — 포인트 추출·안정화·점수·아키텍처

지금까지 구현된 **포인트(onset) 추출 방식**, **안정화 방식**, **점수 책정 방식**, **아키텍처 전략**을 한 문서에 정리합니다.

---

## 1. 포인트(Onset) 추출 방식

### 1.1 공통 파이프라인 (L2)

레이어드 익스포트(01_energy ~ 07_streams_sections)는 **librosa 기반 동일 onset 파이프라인**을 사용합니다. **11_cnn_streams_layers**는 별도 CNN+ODF band onset 파이프라인(compute_cnn_band_onsets_with_odf)을 사용합니다.

| 단계 | 함수/방식 | 설명 |
|------|-----------|------|
| 1) 검출 | `detect_onsets()` | `librosa.onset.onset_strength` → `onset_detect(delta=0.07, wait=4, **backtrack=False**) → `onset_frames`, `onset_times`, `onset_env`, `strengths` |
| 2) 정제 | `refine_onset_times()` | 각 onset 주변 **±80ms**, `hop_refine=64`로 로컬 onset envelope 재계산 → **로컬 피크**로 시점 보정. 샘플 변환은 `round()` 사용 |
| 3) 컨텍스트 | `build_context()` / `build_context_with_band_evidence()` | 정제된 `onset_times`로 `OnsetContext` 생성. band_evidence 사용 시 대역별 onset을 anchor에 **evidence로만** 연결(merge로 이벤트 수 변경 없음) |

- **hop_length**: 256 (검출), 64 (정제용 로컬).
- **상수**: `DEFAULT_DELTA=0.07`, `DEFAULT_WAIT=4`, `DEFAULT_WIN_REFINE_SEC=0.08`, `DEFAULT_HOP_REFINE=64`.

### 1.2 레이어별 구간·윈도우 정의

각 지표(Energy, Clarity, Temporal, Spectral, Context)는 **동일한 onset 시점**을 쓰되, **구간/윈도우 정의**만 다릅니다.

| 지표 | 구간/윈도우 | 용도 |
|------|-------------|------|
| **Energy** | 이벤트 i: [mid_prev, mid_next]. mid_prev = (t_{i-1}+t_i)/2, mid_next = (t_i+t_{i+1})/2 | RMS·대역 에너지 — 인접 onset 사이만 사용(겹침 최소화) |
| **Clarity** | 이벤트 i: pre_sec = min(50ms, 0.45×gap_prev), post_sec = min(20ms, 0.45×gap_next). center = onset_times[i] | Attack time(10%→90%) — 가변 윈도우로 인접 타격 겹침 방지 |
| **Temporal** | onset_times + `beats_dynamic`, `grid_times`, `grid_levels` (로컬 템포·가변 그리드) | 그리드 정렬·IOI 반복 — 구간 없이 시점만 사용 |
| **Spectral** | 이벤트 i: [mid_prev, mid_next] (Energy와 동일) | STFT → centroid, bandwidth, flatness |
| **Context** | 이벤트 윈도우: onset ±50ms. 배경: 직전/직후 각 100ms | Local SNR, 대역별 마스킹 |

- **대역(Energy/Spectral/Context)**: BAND_HZ 기준 Low(20–200Hz), Mid(200–3kHz), High(3k–10kHz). (band_evidence·역할 할당은 동일 경계.)

### 1.3 스트림·섹션 (07, 11)

- **07_streams_sections**: **입력** `build_context_with_band_evidence()`의 `band_onset_times`, `band_onset_strengths`. **추출** `build_streams` → `segment_sections`. **키포인트** 섹션 경계 + 스트림 accent → `streams_sections.json`의 `keypoints[]`.
- **11_cnn_streams_layers**: **입력** stem 폴더(drum_low/mid/high.wav). **추출** `compute_cnn_band_onsets_with_odf`(CNN+ODF → `merge_close_band_onsets`·체인 클러스터링, `filter_transient_mid_high`) → `build_streams` → `simplify_shaker_clap_streams`(mid/high 고밀도 스트림 temporal pooling) → `assign_layer_to_streams` → `segment_sections`. **출력** `streams_sections_cnn.json`.

---

## 2. 안정화 방식

"같은 비트인데 다른 값"이 나오는 것을 줄이기 위해 적용한 방식입니다. 자세한 계획은 [onset_stability.md](onset_stability.md) 참고.

| 구분 | 방식 | 적용 위치 |
|------|------|-----------|
| **검출 일관성** | `backtrack=False` | `pipeline.detect_onsets()` — valley로 당기지 않음 |
| **시점 정밀도** | `refine_onset_times` (±80ms, hop_refine=64 로컬 피크) | `build_context` / `build_context_with_band_evidence` |
| **샘플 인덱스** | `round(t*sr)` 사용 | Energy/Clarity 등 구간 계산 시 (내림 편향 방지) |
| **구간 정의** | 이웃 onset 기반 가변 구간 | Energy: [mid_prev, mid_next]. Clarity: pre/post = min(고정, 0.45×gap) |
| **Clarity 신호** | envelope 스무딩 (`uniform_filter1d`), valley = peak 이전·거리≥2ms·값<peak 30%인 **마지막** 로컬 최소 | `features/clarity.py` |
| **Clarity 후처리** | `attack_times`에 `median_filter(size=3, mode='nearest')` | `features/clarity.py` |
| **점수 정규화** | `robust_norm` (median/MAD 기반 clip), 상·하위 1% clip 등 | 각 feature·scoring |

---

## 3. 점수 책정 방식

5개 지표는 모두 **0~1** 범위로 정규화되며, 트랙 내 분포(percentile 또는 robust_norm)를 사용합니다.

| 지표 | 원시 값 | 점수 공식 | 비고 |
|------|---------|-----------|------|
| **energy_score** | log(1e-10 + RMS) | `robust_norm(log_rms)` → 0~1 | 대역별 E_norm_* 도 동일 방식 |
| **clarity_score** | strengths × (1 / safe_attack), safe_attack = clip(attack_ms, 0.1, ∞) | percentile 1–99 정규화 후 상·하위 1% clip | attack 시간 짧을수록 높음 |
| **temporal_score** | grid_align × repetition × strength_weight(0.85~1.0) | `robust_norm` | grid_align: exp(-d/tau)×level_weight. repetition: IOI 그리드 배수 근접도 |
| **focus_score** | 1 - 0.5×norm(flatness) - 0.5×norm(bandwidth) | flatness·bandwidth 각각 robust_norm | 스펙트럼이 뭉칠수록 높음 |
| **dependency_score** | Local SNR (dB) | 1 - robust_norm(snr_db) | SNR 낮을수록 의존성 높음 → 점수 높음 |

- **normalize_metrics_per_track**: 레이어드 JSON 내 여러 지표를 트랙 단위로 percentile(1, 99) 재정규화할 때 사용 가능.

---

## 4. 아키텍처 전략

### 4.1 레이어 구분 (L1~L6)

| 레이어 | 역할 | 경로/예시 |
|--------|------|-----------|
| **L1** | 타입·상수·유틸 | `types.py`, `constants.py`, `utils.py` — librosa/경로 미사용 |
| **L2** | Onset 검출·정제·컨텍스트 | `pipeline.py`, `band_classification.py` — librosa는 여기서만 사용 |
| **L3** | 이벤트별 피처 | `features/` — feature 간 참조 없음, OnsetContext만 입력 |
| **L4** | 정규화·역할 할당 | `scoring.py` — normalize_metrics_per_track, assign_roles_by_band |
| **L5** | JSON/파일 출력 | `export.py` — write_*_json, write_layered_json, write_streams_sections_json |
| **L6** | 엔트리 스크립트 | `scripts/01_basic_test/`, `scripts/02_layered_onset_export/` — engine.onset만 사용 |

### 4.2 Anchor + Band Evidence

- **이벤트 수**: 항상 **broadband(anchor) onset 1회 검출** 기준. 대역별 onset은 **merge하지 않고** 각 anchor에 ±tol 내에서만 **evidence**로 연결.
- **역할 할당**: `assign_roles_by_band(..., band_evidence=...)` 시 P1은 “반복 집합 소속 + band evidence present”로 대역별 P1 리스트 생성.

### 4.3 Band 기반 역할 (P0/P1/P2)

- **단위**: 이벤트×대역. 같은 이벤트에서 여러 대역이 서로 다른 역할을 가질 수 있음.
- **P0**: 반복 집합 내 band별 상위 quantile(기본 80%) — accent.
- **P1**: 반복 집합 소속(IOI 유사) + (선택) band_evidence present — 패턴 유지.
- **P2**: dependency gate + E < P0×ratio, E > abs_floor, P0 대역 제외 — 뉘앙스.
- **반복 집합**: IOI가 연속으로 유사한 이벤트 묶음. `_repetition_groups_from_ioi(onset_times, rel_tol=0.2)`.

### 4.4 스트림·섹션

- **스트림**: band별 onset 시퀀스를 IOI·시간 연속성으로 묶은 단위. `build_streams(band_onset_times, band_onset_strengths)`.
- **섹션**: 윈도우별 스트림 상태 벡터의 변화점으로 구간 분할. `segment_sections(streams, duration)`.
- **키포인트**: 섹션 경계 + 스트림 accent → `keypoints[]`. JSON은 `write_streams_sections_json`으로 출력.
- **CNN 스트림**: 11_cnn_streams_layers에서 `simplify_shaker_clap_streams`로 mid/high 고밀도 스트림을 temporal pooling하여 쉐이커·클랩 과검출을 압축. `assign_layer_to_streams`로 스트림별 P0/P1/P2 레이어 부여.

---

## 5. 문서 참조

| 문서 | 내용 |
|------|------|
| [README.md](README.md) | 문서 구조·분류·목차 |
| [onset_module.md](onset_module.md) | 모듈 구조·공개 API·검증 |
| [pipeline.md](pipeline.md) | 데이터 흐름·스크립트 01~07 실행 순서 |
| [json_spec.md](json_spec.md) | JSON 스키마 |
| [layering.md](layering.md) | band 기반 역할·P0/P1/P2 설계 |
| [onset_stability.md](onset_stability.md) | 안정화 계획·Phase 0~4 |
| [progress.md](progress.md) | 진행 현황·값 가공 표·점수 해석 가이드 |
