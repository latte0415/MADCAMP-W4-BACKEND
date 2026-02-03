# JSON 추출 형식 (파일별)

## explore/
- **01_explore** → `onset_beats.json` (onset/beat/드럼 onset 시점)
- **02_split_stem** → JSON 없음 (WAV 4개)
- **03_visualize_point** → `onset_events.json` (이벤트: t, strength, texture)

## onset_layered/
- **01_energy** → `onset_events_energy.json`
- **02_clarity** → `onset_events_clarity.json`
- **03_temporal** → `onset_events_temporal.json`
- **04_spectral** → `onset_events_spectral.json`
- **05_context** → `onset_events_context.json`
- **06_layered_export** → `onset_events_layered.json`

## legacy/ (실행 비활성)
- **streams_sections** → `streams_sections.json`
- **drum_band_energy** → (드럼 대역 에너지 JSON/시각화)

## export/run_stem_folder → streams_sections_cnn.json
- **입력**: stem 폴더명. **흐름**: drum/run + bass/run(조건부) → write_streams_sections_json.
- **스키마**: 아래 §10-2 참고 (streams/sections/keypoints 빈 배열, keypoints_by_band, texture_blocks_by_band, bass).

## Web
- 수용 형식: `onset_times_sec`, `events[]`, 배열 직접

---

## 1. 01_explore → onset_beats.json

**출력 경로**: `audio_engine/samples/onset_beats.json`

**스키마**: `source`, `sr`, `duration_sec`, `tempo_bpm`, `onset_times_sec`, `beat_times_sec`, (선택) `drum_onset_times_sec`.

---

## 2. 02_split_stem

**JSON 없음.** 산출물: `samples/stems/htdemucs/{트랙명}/` — drums, bass, vocals, other.wav.

---

## 3. 03_visualize_point → onset_events.json

**출력 경로**: `audio_engine/samples/onset_events.json`

**스키마 (최상위)**: `source`, `sr`, `duration_sec`, `texture_min_hz`, `texture_max_hz`, `events[]`.  
**events[]**: `t`, `strength`, `texture`, `texture_hz`, `layer`, `color`.

---

## 4. 01_energy.py → onset_events_energy.json

**출력 경로**: `audio_engine/samples/onset_events_energy.json`

**스키마 (최상위)**: `source`, `sr`, `duration_sec`, `energy_rms_min`, `energy_rms_max`, `hop_length`, `bpm`, `total_events`, `events[]`.  
**events[]**: `t`, `time`, `strength`, `texture`, `color`, `rms`, `e_norm`, `band_low`, `band_mid`, `band_high`, `index`, `frame`, `onset_strength`, `log_rms`, `energy_score`, `left_sec`, `right_sec`, `overlap_prev`.

---

## 5. 02_clarity.py → onset_events_clarity.json

**스키마**: `metadata` (source, sr, hop_length, bpm, total_events), `events[]` (index, time, frame, strength, attack_time_ms, clarity_score).

---

## 6. 03_temporal.py → onset_events_temporal.json

**스키마**: `metadata` (source, sr, duration_sec, hop_length, bpm, bpm_dynamic_used, total_events), `events[]` (index, time, frame, strength, grid_align_score, repetition_score, temporal_score, ioi_prev, ioi_next).

---

## 7. 04_spectral.py → onset_events_spectral.json

**스키마**: `metadata`, `events[]` (index, time, frame, strength, spectral_centroid_hz, spectral_bandwidth_hz, spectral_flatness, focus_score).

---

## 8. 05_context.py → onset_events_context.json

**스키마**: `metadata` (event_win_sec, bg_win_sec 포함), `events[]` (index, time, frame, strength, snr_db, masking_low, masking_mid, masking_high, dependency_score).

---

## 9. 06_layered_export.py → onset_events_layered.json

**출력 경로**: `audio_engine/samples/onset_events_layered.json`  
**생성**: `write_layered_json(ctx, metrics, role_composition, path, ...)` (L5 export). 스크립트 `06_layered_export.py`.

**의미적 레이어 판단**: **layer/color는 시각화용이며, 의미적 판단은 roles를 기준으로 한다.**

**스키마 (최상위)**:

| 필드 | 타입 | 설명 |
|------|------|------|
| `source` | string | 입력 오디오 파일명 |
| `sr` | number | 샘플링 레이트 (Hz) |
| `duration_sec` | number | 오디오 길이 (초) |
| `total_events` | number | 총 이벤트 수 |
| `layer_counts` | object | **이벤트 기준** `{"P0": 전체 이벤트 수, "P1": P1이 하나라도 있는 이벤트 수, "P2": P2가 하나라도 있는 이벤트 수}` |
| `events` | object[] | 이벤트 배열 |

**events[] 항목**:

| 필드 | 타입 | 설명 |
|------|------|------|
| `time` | number | 시간(초) |
| `t` | number | time과 동일 |
| `roles` | object | `{ "P0": band[], "P1": band[], "P2": band[] }` — 역할별 대역 목록. P0/P1 중복 허용(같은 band가 여러 역할 가능). 의미적 판단은 roles 기준. |
| `layer` | string | 시각화용 주 역할 하나(P2 > P1 > P0). roles에서 유도. |
| `strength` | number | onset strength |
| `color` | string | hex (P0=#2ecc71, P1=#f39c12, P2=#3498db) |
| `energy_score` | number | 0~1 |
| `clarity_score` | number | 0~1 |
| `temporal_score` | number | 0~1 |
| `focus_score` | number | 0~1 |
| `dependency_score` | number | 0~1 |

---

## 10. legacy/streams_sections.py → streams_sections.json (LEGACY)

**출력 경로**: `audio_engine/samples/streams_sections.json`. **실행**: 비활성(export/run_stem_folder 사용 권장).

**스키마 (최상위)**: `source`, `sr`, `duration_sec`, `streams[]`, `sections[]`, `keypoints[]`, (선택) `events[]`.

**streams[]**: band별 IOI·시간 연속성으로 묶은 리듬 스트림. `id`, `band`, `start`, `end`, `events`, `median_ioi`, `ioi_std`, `density`, `strength_median`, `accents`.

**sections[]**: 윈도우별 스트림 상태 벡터 변화점에서 나눈 파트. `id`, `start`, `end`, `active_stream_ids`, `summary`.

**keypoints[]**: 섹션 경계 + 스트림 accent. `time`, `type` ("section_boundary" | "accent"), `section_id`?, `stream_id`?, `label`.

---

## 10-2. export/run_stem_folder → streams_sections_cnn.json

**출력 경로**: `audio_engine/samples/streams_sections_cnn.json` (또는 지정 경로)

**입력**: stem 폴더명. **흐름**: `drum/run.py`(CNN band onset → keypoints_by_band, texture_blocks_by_band, 스트림 미사용) + `bass/run.py`(bass.wav 있으면 run_bass_pipeline) → `write_streams_sections_json(..., bass=bass_dict)`.

**스키마 (최상위)**:
- `source`, `sr`, `duration_sec`
- `streams`: [] (미사용)
- `sections`: [] (미사용)
- `keypoints`: [] (미사용)
- `keypoints_by_band`: 드럼 대역별 키온셋 목록 (drum/run 출력)
- `texture_blocks_by_band`: 드럼 대역별 질감 블록 (drum/run 출력)
- `bass`: (선택) `{ "curve": [...], "keypoints": [...] }` — 베이스 피치 곡선·키포인트

---

## 11. Web (시각화) — 수용 JSON 형식

**수용 형식**: `onset_times_sec` 단일 배열, `events[]` 배열, 최상위 배열 직접.  
필드: `t`/`time`, `strength`, `color`, `layer`, (선택) `texture`, `texture_hz`.  
EventPoint: `t`, `strength`, `color`, `layer`.
