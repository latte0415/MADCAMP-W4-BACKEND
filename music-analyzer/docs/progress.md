# Progress — 작업 내용 및 핵심 요약

프로젝트별·파일별 진행 상황, 값 가공 흐름, 산출물을 정리한 문서입니다.

---

## 파이프라인 아키텍처

```mermaid
flowchart LR
    subgraph input["입력"]
        A[오디오 파일]
    end

    subgraph step1["Step 1 · 탐색"]
        B[01_explore]
        B --> B1[onset_detect<br/>beat_track]
        B1 --> J1[onset_beats.json]
    end

    subgraph step2["Step 2 · 스템 분리"]
        C[02_split_stem]
        C --> C1[Demucs htdemucs]
        C1 --> S[drums / bass / vocals / other]
    end

    subgraph step3["Step 3 · 시각화"]
        D[03_visualize_point]
        D --> D1[onset + strength<br/>spectral_centroid]
        D1 --> J2[onset_events.json]
    end

    subgraph layered["레이어드 익스포트"]
        E1[01_energy]
        E2[02_clarity]
        E3[03_temporal]
        E4[04_spectral]
        E5[05_context]
        E1 --> E1a[RMS · 대역 에너지<br/>energy_score]
        E2 --> E2a[Attack time<br/>clarity_score]
        E3 --> E3a[가변 그리드 · 로컬 템포<br/>temporal_score]
        E4 --> E4a[centroid · bandwidth · flatness<br/>focus_score]
        E5 --> E5a[Local SNR · 대역별 마스킹<br/>dependency_score]
        E1a --> J3[onset_events_energy.json]
        E2a --> J3
        E3a --> J4[onset_events_temporal.json]
        E4a --> J5[onset_events_spectral.json]
        E5a --> J6[onset_events_context.json]
    end

    subgraph web["웹"]
        W1[JsonUploader]
        W2[parseEvents]
        W3[WaveformWithOverlay]
        W1 --> W2 --> W3
    end

    A --> B
    A --> C
    S -.->|선택| B
    S -.->|선택| D
    B --> D
    D --> E1
    D --> E2
    D --> E3
    D --> E4
    D --> E5
    J1 --> W1
    J2 --> W1
    J3 --> W1
    J4 --> W1
    J5 --> W1
    J6 --> W1
```

---

## 1. 진행 현황

### 1.1 레이어링·JSON (onset_layered/)

**01_energy.ipynb**

- **JSON**: `web` 호환 형식. 메타데이터 `source`, `sr`, `duration_sec`, `energy_rms_min/max`, `hop_length`, `bpm`, `total_events`. 이벤트별 `t`, `time`, `strength`, `texture`, `color`, `rms`, `e_norm`, `band_low/mid/high` + 확장 필드 `index`, `frame`, `onset_strength`, `log_rms`, `energy_score`, `E_norm_*`, `left_sec`, `right_sec`, `overlap_prev`.
- **저장**: `audio_engine/samples/onset_events_energy.json`. `web/public` 존재 시 동일 파일 복사.

**02_clarity.ipynb**

- **Clarity 안정화** (계획 반영):
  1. Envelope 스무딩: `np.abs(y_segment)` → `uniform_filter1d(..., size=3~11, mode='nearest')`
  2. Attack time: 하한 0.05 ms, 상한 50 ms clip. `attack_samples = max(t90 - t10, 1)`
  3. Valley: peak과 거리 ≥ 약 2 ms, 값 < peak의 30%인 **마지막** 로컬 최소만 사용
  4. 후처리: `attack_times`에 `median_filter(size=3, mode='nearest')`
  5. Clarity: `robust_norm(clarity_raw)` 후 상·하위 1% clip
- **임포트**: `scipy.ndimage`: `uniform_filter1d`, `median_filter`

**03_temporal.py**

- **가변 그리드 + 로컬 템포** 기반 Temporal Salience (layering.md 3) 구현.
- 로컬 템포: `librosa.feature.tempo(aggregate=None)` → onset envelope 길이로 보간 → `beat_track(bpm=tempo_dynamic)`.
- 가변 그리드: beat 구간 선형 분할 → 1/2, 1/4, 1/8, 1/16 서브비트. 계층별 가중치(1/4>1/8>1/16).
- grid_align_score: 거리 `exp(-d/tau)` × 계층 가중치. tau = beat×0.06.
- repetition_score: IOI를 beat 단위 정규화 후 0.125~2 beat 그리드 배수에 가까우면 높음. 50ms 미만 IOI 필터.
- temporal_score = grid_align × repetition × strength_weight(0.85~1.0).
- **저장**: `onset_events_temporal.json`. `web/public` 복사.

**04_spectral.py**

- **Spectral Focus** (layering.md 4) 구현. "주파수 에너지가 한 대역에 뭉쳐 또렷한가".
- 이벤트 구간 [mid_prev, mid_next]에서 STFT → spectral_centroid, spectral_bandwidth, spectral_flatness.
- focus_score = 1 - 0.5×norm(flatness) - 0.5×norm(bandwidth). flatness·bandwidth 낮을수록 포커스 높음.
- **저장**: `onset_events_spectral.json`. `web/public` 복사.

**05_context.py**

- **Context Dependency** (layering.md 5) 구현. "혼자 있을 때만 들리는가? 다른 소리에 묻히는가?"
- Local SNR: 이벤트 윈도우(±50ms) 에너지 vs 배경 윈도우(직전/직후 100ms) 에너지. `snr_db = 10*log10(E_event/E_bg)`
- 대역별 마스킹: 이벤트/배경 스펙트럼을 Low(20-200Hz)/Mid(200-3kHz)/High(3k-10kHz) 대역별로 비교. `masking_ratio = E_bg/E_event`
- dependency_score = 1 - norm(SNR). SNR 낮을수록 의존성 높음.
- **저장**: `onset_events_context.json`. `web/public` 복사.

**현재 상태**

| 항목 | 메모 |
|------|------|
| 에너지 | 일관성 양호. |
| Clarity | 추가 검증 필요. 드럼 트랙에서는 의미가 제한적일 수 있음. |
| Temporal | 가변 그리드·로컬 템포·beat 정규화 IOI 적용 완료. |
| Spectral | centroid/bandwidth/flatness → focus_score 적용 완료. |
| Context | Local SNR·대역별 마스킹 → dependency_score 적용 완료. |

---

## 1.2 점수 해석 가이드 (의미적 기준)

각 점수가 **어떤 의미를 갖고**, 높고 낮음이 **무엇을 뜻하는지** 정리합니다.

### Energy Score (에너지 점수)

| 범위 | 해석 | 예시 |
|------|------|------|
| 0.8–1.0 | **매우 강한 타격** — 킥, 스네어 백비트, 악센트 | 1번·3번 박 킥, 2번·4번 박 스네어 |
| 0.5–0.8 | **중간 타격** — 일반적인 연주 범위 | 고스트 노트 없는 일반 스네어, 하이햇 |
| 0.2–0.5 | **약한 타격** — 고스트 노트, 부드러운 터치 | 고스트 스네어, 브러쉬 |
| 0.0–0.2 | **매우 약함** — 잔향, 노이즈 경계 | 룸 앰비언스, 블리드 |

**주의**: 에너지가 낮아도 브러쉬 같은 중요한 연주일 수 있음 → 단독 결정 변수로 쓰지 말 것.

### Clarity Score (명확도 점수)

| 범위 | 해석 | 예시 |
|------|------|------|
| 0.8–1.0 | **매우 또렷한 어택** — "툭" 하고 박히는 타격 | 림샷, 우드블럭, 타이트한 스네어 |
| 0.5–0.8 | **적당한 어택** — 일반적인 드럼 연주 | 표준 킥/스네어 |
| 0.2–0.5 | **부드러운 어택** — 느린 상승, 텍스처성 | 브러쉬 스와이프, 말렛 |
| 0.0–0.2 | **불명확** — 어택이 뭉개짐, 잔향 속에 묻힘 | 리버브 깊은 스네어, 페이드인 |

**관계**: Clarity↓ + Dependency↑ = 잔향/마스킹에 의해 어택이 묻힌 상태.

### Temporal Score (박자 기여도 점수)

| 범위 | 해석 | 예시 |
|------|------|------|
| 0.8–1.0 | **핵심 그루브 형성** — 박자 인식의 뼈대 | 킥(1,3박), 스네어(2,4박), 하이햇 정박 |
| 0.5–0.8 | **그루브 보조** — 패턴에 규칙적으로 기여 | 하이햇 오프비트, 심벌 악센트 |
| 0.2–0.5 | **장식적 요소** — 비정형 타이밍, 필인 | 고스트 노트, 탐탐 필 |
| 0.0–0.2 | **비주기적** — 그리드와 무관한 자유로운 타격 | 임의 악센트, 루바토 |

**세부 점수**:
- `grid_align_score`: 비트/서브비트 그리드에 얼마나 가까운가 (거리 기반)
- `repetition_score`: IOI(이벤트 간 간격)가 리듬 배수인가 (1/4, 1/8 등)

### Focus Score (주파수 집중도 점수)

| 범위 | 해석 | 예시 |
|------|------|------|
| 0.8–1.0 | **집중된 스펙트럼** — 뚜렷한 음색, 분리됨 | 튜닝된 킥, 타이트 스네어 |
| 0.5–0.8 | **적당한 집중** — 일반적인 드럼 소리 | 오픈 하이햇, 일반 탐 |
| 0.2–0.5 | **퍼진 스펙트럼** — 노이즈 성분, 텍스처 | 크래시 심벌, 라이드 벨 |
| 0.0–0.2 | **텍스처/노이즈** — 평탄한 스펙트럼 | 브러쉬, 쉐이커, 룸 노이즈 |

**관련 값**:
- `spectral_centroid_hz`: 무게중심 (높으면 밝은 소리)
- `spectral_bandwidth_hz`: 퍼짐 (높으면 넓은 대역)
- `spectral_flatness`: 평탄도 (높으면 노이즈성)

### Dependency Score (맥락 의존성 점수)

| 범위 | 해석 | 예시 |
|------|------|------|
| 0.8–1.0 | **매우 의존적** — 맥락 없이 안 들림, 마스킹됨 | 믹스 속 고스트 노트, 저음량 하이햇 |
| 0.5–0.8 | **부분 의존** — 배경이 크면 묻힐 수 있음 | 복잡한 패시지 속 탐 |
| 0.2–0.5 | **독립적** — 대부분 상황에서 들림 | 일반 스네어, 킥 |
| 0.0–0.2 | **완전 독립** — 맥락 무관하게 뚜렷 | 솔로 구간 타격, 강한 악센트 |

**관련 값**:
- `snr_db`: 이벤트/배경 에너지 비율 (높을수록 독립적)
- `masking_low/mid/high`: 대역별 마스킹 정도 (높을수록 해당 대역이 묻힘)

---

### Precision 레이어 할당 방향

| 레이어 | 조건 | 의미 |
|--------|------|------|
| **P0 (저정밀)** | Energy↑ + Temporal↑ + Clarity↑ + Dependency↓ | 누구나 듣는 핵심 타격. 허용 오차 ±30ms |
| **P1 (중정밀)** | Temporal↑ + Energy 중간 + Focus 중간 | 패턴 유지에 필요. 허용 오차 ±15ms |
| **P2 (고정밀)** | Dependency↑ + Focus↓(텍스처) + Clarity↓ | 뉘앙스/그루브 디테일. 허용 오차 ±5ms |

---

## 2. 값 가공 요약 (데이터 흐름)

각 노트북에서 **입력 → 계산 → 정규화 → JSON/시각화**로 이어지는 흐름을 요약합니다.

### 2.1 01_explore.ipynb

| 단계 | 값 | 가공 |
|------|-----|------|
| Onset | `onset_strength` → `onset_detect` | delta=0.05, wait=2, backtrack=True, hop_length=256 → `onset_times_sec` |
| Beat | `beat_track` | `tempo_bpm`, `beat_times_sec` |
| 드럼 스템 | (선택) | `drums.wav` 있으면 동일 파라미터로 onset 재계산 → `drum_onset_times_sec` |
| JSON | — | 위 리스트 그대로 저장. 정규화 없음. |

### 2.2 03_visualize_point.ipynb

| 단계 | 값 | 가공 |
|------|-----|------|
| 세기 | `onset_strength` → `onset_detect` | `strengths = onset_env[onset_frames]` (원시) |
| 질감 | `spectral_centroid` | `textures = centroid[0, onset_frames]` (Hz) |
| JSON strength | `strengths` | min–max → 0~1 |
| JSON texture | `textures` | min–max → 0~1. `texture_hz`는 원시 Hz |
| 시각화 점 크기 | `strengths` | min–max 후 30~500 선형 매핑 |

### 2.3 01_energy.ipynb (onset_layered/)

| 단계 | 값 | 가공 |
|------|-----|------|
| Onset | `onset_detect` (delta=0.07, wait=4) + `refine_onset_times` | ±80 ms, hop_refine=64 로컬 피크 → `onset_times`, `strengths` |
| 구간 | 이벤트 i | `mid_prev`/`mid_next` = 인접 onset 시간의 중점. seg = y[start:end] |
| RMS | seg | `rms = sqrt(mean(seg²))`. `log_rms = log(1e-10 + rms)` |
| 대역 에너지 | seg, n_fft=2048 | rfft 절대값 제곱. Low 20–200, Mid 200–3k, High 3k–10k Hz 구간 합 |
| energy_score | rms | `robust_norm(log_rms)` → 0~1 (median/MAD, clip(0.5+z/6, 0, 1)) |
| E_norm_* | band_energy | 각 대역별 `robust_norm` → 0~1 |
| JSON | — | `strength`=energy_score, `texture`=E_norm_high. 원시·정규화 값 모두 포함 |

### 2.4 02_clarity.ipynb (onset_layered/)

| 단계 | 값 | 가공 |
|------|-----|------|
| Onset | 01_energy와 동일 | `refine_onset_times`까지 동일 |
| 윈도우 | 이벤트 i | `pre_sec = min(50ms, 0.45*gap_prev)`, `post_sec = min(20ms, 0.45*gap_next)` |
| Envelope | y_segment | `abs(y)` → `uniform_filter1d(env, size=3~11)` |
| Valley | peak 이전 | 거리 ≥ 약 2 ms, 값 < peak 30%인 **마지막** 로컬 최소 |
| 10%–90% | pre_peak_env | t10/t90 선형 보간. `attack_samples = max(t90-t10, 1)` |
| attack_time_ms | attack_samples | `(attack_samples/sr)*1000` → clip(0.05, 50) ms |
| 후처리 | attack_times | `median_filter(size=3, mode='nearest')` |
| clarity_raw | — | `safe_attack = clip(attack_times, 0.1, None)`. `strengths * (1/safe_attack)` |
| clarity_score | clarity_raw | percentile 1–99 정규화 → 0~1, 이후 상·하위 1% clip |
| JSON | — | `attack_time_ms`, `clarity_score` 저장 |

### 2.5 03_temporal.py (onset_layered/)

| 단계 | 값 | 가공 |
|------|-----|------|
| Onset | 01_energy와 동일 | `refine_onset_times`까지 동일 |
| 로컬 템포 | `librosa.feature.tempo(aggregate=None, std_bpm=4)` | onset_env 길이로 보간 → `beat_track(bpm=...)` |
| 비트 | beat_track | `beats_dynamic` (가변 템포 반영) |
| 가변 그리드 | beats_dynamic | 1/2, 1/4, 1/8, 1/16 서브비트. 계층 level(1,2,4,8,16) 저장 |
| grid_align_score | onset_times vs grid | `exp(-d/tau)` × level_weight. tau=beat×0.06 |
| repetition_score | IOI (prev/next) | beat 정규화 → 0.125~2 beat 그리드 배수 근접도. 50ms 미만 필터 |
| temporal_score | — | `grid_align × repetition × strength_weight(0.85~1.0)`. robust_norm |
| JSON | — | `grid_align_score`, `repetition_score`, `temporal_score`, `ioi_prev/next` |

### 2.6 04_spectral.py (onset_layered/)

| 단계 | 값 | 가공 |
|------|-----|------|
| Onset | 01_energy와 동일 | `refine_onset_times`까지 동일 |
| 구간 | 이벤트 i | [mid_prev, mid_next]. seg = y[start:end] |
| STFT | seg, n_fft=2048 | `librosa.stft` → S (power spectrum) |
| centroid | S | `librosa.feature.spectral_centroid` (Hz) |
| bandwidth | S | `librosa.feature.spectral_bandwidth` (Hz) |
| flatness | S | `librosa.feature.spectral_flatness` (0~1) |
| focus_score | flatness, bandwidth | `1 - 0.5×norm(flat) - 0.5×norm(bw)`. robust_norm |
| JSON | — | `spectral_centroid_hz`, `spectral_bandwidth_hz`, `spectral_flatness`, `focus_score` |

### 2.7 05_context.py (onset_layered/)

| 단계 | 값 | 가공 |
|------|-----|------|
| Onset | 01_energy와 동일 | `refine_onset_times`까지 동일 |
| 이벤트 윈도우 | onset ±50ms | `seg_event = y[ev_start:ev_end]` |
| 배경 윈도우 | 직전/직후 100ms | `seg_bg = concat(seg_bg_prev, seg_bg_next)` |
| Local SNR | E_event, E_bg | `snr_db = 10 * log10(E_event / E_bg)` |
| 대역별 마스킹 | rfft, band_hz | Low(20-200Hz), Mid(200-3kHz), High(3k-10kHz). `masking = E_bg_band / E_event_band` |
| dependency_score | snr_db | `1 - robust_norm(snr_db)`. SNR 낮을수록 의존성 높음 |
| JSON | — | `snr_db`, `masking_low`, `masking_mid`, `masking_high`, `dependency_score` |

**06_layered_export.py**

- **Band 기반 역할 할당** (layering.md): `assign_roles_by_band(energy_extras, dependency=..., focus=...)` → role_composition. P0 = 대역별 에너지 argmax, P1 = MVP 생략, P2 = dependency/focus gate + P0 제외 나머지 대역.
- **저장**: `write_layered_json(ctx, metrics, role_composition, path, ...)` → `onset_events_layered.json`. events[].**bands** `[{ band, role }]`, 호환용 **layer** (deprecated).

**legacy/streams_sections.py (실행 비활성)**

- **입력**: `build_context_with_band_evidence()` → `band_onset_times`, `band_onset_strengths`.
- **흐름**: `build_streams(band_onset_times, band_onset_strengths)` → 스트림 목록. `segment_sections(streams, duration)` → 섹션 목록. 섹션 경계 + 스트림 accent → keypoints.
- **저장**: `write_streams_sections_json(..., streams, sections, keypoints, events, ...)` → `streams_sections.json`. 작업 과정 상세는 [work_process.md](work_process.md) §1.3 참고.

**drum/cnn_band_onsets.py, drum/madmom_band.py (선택)**

- CNN band onset만: `compute_cnn_band_onsets` → drum_band_energy JSON(선택). madmom: `compute_madmom_drum_band_keypoints`.
- 메인 드럼 파이프라인: drum/run.py → `compute_cnn_band_onsets_with_odf` → keypoints_by_band, texture_blocks_by_band (스트림 미사용).

**export/run_stem_folder.py (드럼+베이스+보컬+Other 통합)**

- **입력**: stem 폴더명. **흐름**: drum/run(CNN band onset → keypoints_by_band, texture_blocks_by_band, **스트림/섹션 호출 없음**) + bass/run(bass.wav 있으면) + vocal/run(vocals.wav 있으면) + other/run(other.wav 있으면).
- **저장**: `write_streams_sections_json(..., keypoints_by_band=..., texture_blocks_by_band=..., bass=bass_dict, vocal=vocal_dict, other=other_dict)` → `streams_sections_cnn.json`.

---

## 3. 오디오 엔진 (파일별)

### 3.1 01_explore.ipynb

**역할**  
음악 파형 탐색 + Onset/Beat 기본 검출 (Step 1).

**작업**

- 오디오 로드, 전체/확대 파형 시각화 (10~15초 구간).
- Onset: `librosa.onset.onset_detect` (delta=0.05, wait=2, backtrack=True, hop_length=256).
- Beat: `librosa.beat.beat_track` → BPM, 박자 그리드.
- 드럼 스템: `stems/htdemucs/{트랙명}/drums.wav` 있으면 해당 파일로 onset 재계산.
- JSON: `audio_engine/samples/onset_beats.json` (source, sr, duration_sec, tempo_bpm, onset_times_sec, beat_times_sec, 선택 drum_onset_times_sec). 값 가공은 §2.1 참고.
- 시각화: 파형 위 beat(주황), onset(빨강), 드럼 onset(초록) 세로선.

**핵심**  
Step 1 산출물(onset/beat 리스트 + JSON). 드럼 스템 사용 시 타격점 검출 수 증가.

---

### 3.2 02_split_stem.ipynb

**역할**  
Stem 분리 검증 (Step 2).

**작업**

- Demucs(htdemucs)로 4 stem 분리.
- 출력: `samples/stems/htdemucs/{트랙명}/` — drums, bass, vocals, other.
- 엔진: `audio_engine/engine/stems.py` `separate()` (필요 시 MP3→WAV 후 Demucs).

**핵심**  
drums stem 확보 → 01_explore·03_visualize_point 드럼 입력으로 사용.

---

### 3.3 03_visualize_point.ipynb

**역할**  
타격점 세기·질감 시각화 (Step 1 확장).

**작업**

- 입력: 원본 또는 드럼 스템 경로 1개.
- Onset + 세기: `onset_strength` → `onset_detect` → `strengths = onset_env[onset_frames]`.
- 질감: Spectral Centroid (Hz) — `spectral_centroid` 프레임별 계산 후 onset 프레임만 추출.
- 값 가공: §2.2 참고 (JSON strength/texture min–max 0~1, 시각화 점 크기 30~500).
- 시각화: 파형 + scatter(시간·진폭, 점 크기=세기), 시간–질감 scatter 전체/확대(12초).
- JSON: `audio_engine/samples/onset_events.json` — events (t, strength 0~1, layer, color, texture_hz).

**핵심**  
세기=점 크기, y=질감(Hz)로 타격 특성 구분. 웹 시각화용 events JSON.

---

### 3.4 01_energy.ipynb, 02_clarity.ipynb, 03_temporal.py, 04_spectral.py, 05_context.py (onset_layered/)

- **01_energy**: 구간별 RMS·대역 에너지 → energy_score, E_norm_* → JSON. §2.3 참고.
- **02_clarity**: 구간별 Attack Time(10%→90%) → clarity_score → JSON. §2.4 참고.
- **03_temporal**: 가변 그리드·로컬 템포 → grid_align_score, repetition_score → temporal_score → JSON. §2.5 참고.
- **04_spectral**: 구간별 spectral centroid/bandwidth/flatness → focus_score → JSON. §2.6 참고.
- **05_context**: Local SNR·대역별 마스킹 → dependency_score → JSON. §2.7 참고.

---

### 3.5 audio_engine/engine/

| 파일/디렉터리 | 역할 | 비고 |
|---------------|------|------|
| stems.py | Demucs 래퍼 | 비-WAV는 WAV 변환 후 실행, stem별 wav 경로 반환 |
| schemas.py | 결과 스키마 | 스텁(주석) |
| keypoints.py | 키포인트 추출 | 스텁(주석) |
| viz.py | 시각화 유틸 | 스텁(주석) |
| **tempo/** | BPM·마디 파이프라인 | bpm.py(infer_bpm), bars.py(bars_from_bpm), pipeline.py(run_tempo_pipeline), export.py(build_tempo_output). 스크립트: tempo/run.py → tempo_bars.json |
| **bass/** | 베이스 노트·렌더 | bass_v4.py(run_bass_v4, 메인), bass_v2/v3(레거시), export.py(build_bass_output) |
| **vocal/** | 보컬 곡선·프레이즈·키포인트 | vocal_curve.py, vocal_phrases.py, vocal_onsets.py, export.py(build_vocal_output). USE_PHRASE 시 phrases, 아니면 turns+onsets |
| **other/** | Other 밀도·패드 | other_pipeline.py(run_other_pipeline), export.py(build_other_output) |

---

## 4. 웹 (web)

**역할**  
파형 + 이벤트 포인트 오버레이 시각화.

**구성**

- **JsonUploader**: JSON 업로드 → `parseEventsFromJson` → `EventPoint[]`.
- **WaveformWithOverlay**: 파형 + 이벤트(세로선/마커), 레이어별 토글.
- **parseEvents.ts**: `onset_times_sec` 단일 배열 또는 `events` 배열 → `{ t, strength?, color?, layer? }` 정규화. (의미적 역할은 JSON `bands` 기준, `layer`는 시각화 호환용.)

**핵심**  
`onset_beats.json` 또는 `events` JSON 업로드 시 파형 위 타격점 표시.

---

## 5. 문서 참조

| 문서 | 내용 |
|------|------|
| docs/README.md | 기록 정보 정리·분류·목차 |
| docs/onset_module.md | onset 모듈 구조·공개 API·검증 |
| docs/pipeline.md | 데이터 흐름·스크립트 01~11 |
| docs/json_spec.md | 파일별 JSON 스키마·Web 수용 형식 |
| docs/layering.md | band 기반 역할·레이어링 설계(assign_roles_by_band, bands) |
| docs/work_process.md | 작업 과정 — 추출·안정화·점수·아키텍처 |
| docs/onset_stability.md | 같은 비트·다른 값 안정화 계획 |
| docs/dev_onboarding.md | 환경·실행 순서·검증 한 번에 |
| docs/progress.md | 본 문서 — 진행 상황·값 가공·점수 해석 |
