# 파이프라인 — 데이터 흐름·스크립트 실행 순서

전체 흐름을 **1. 대역 분류 → 2. (선택) 대역별 onset → 3. 이벤트별 피처 → 4. 스코어링/레이어링** 순으로 정리합니다.

---

## 1. 전체 흐름

```
오디오 파일
    → Step 1 탐색 (explore/01_explore)        → onset_beats.json
    → Step 2 스템 분리 (explore/02_split_stem) → stems/htdemucs/{트랙}/drums|bass|vocals|other.wav
    → Step 3 시각화 (explore/03_visualize_point) → onset_events.json
    → 레이어드 익스포트 (onset_layered/01_energy ~ 05_context) → onset_events_energy|clarity|temporal|spectral|context.json
    → 레이어 통합 (onset_layered/06_layered_export)  → onset_events_layered.json
    → (선택) 드럼 대역 (drum/cnn_band_onsets, drum/madmom_band)
    → 통합 진입점 (export/run_stem_folder) → drum + bass → streams_sections_cnn.json
    → Web (JsonUploader, parseEvents) → 파형 위 이벤트/레이어 표시
```

**메인 드럼 파이프라인은 스트림/섹션을 사용하지 않음.** 드럼은 `drum/run.py`(CNN → keypoints_by_band, texture_blocks_by_band)로, 베이스는 `bass/run.py`로 분석 후 `export/run_stem_folder.py`에서 한 번에 JSON 출력. 레거시 스트림·섹션 스크립트는 `legacy/` 참고.

**06 내부 파이프라인 (목표 순서)**  
1. **대역 분류**: `compute_band_hz(y, sr)` — 곡 전체 스펙트럼 + 고정 Hz 혼합으로 저/중/고 경계 산출.  
2. **(선택) Anchor + band evidence**: `build_context_with_band_evidence(audio_path)` — anchor(broadband) 1회 검출 후, 대역별 onset을 ±tol 내에서만 해당 anchor에 evidence로 연결(merge로 이벤트 생성 안 함).  
   - 기본은 `build_context(audio_path)` (전대역 onset 1회).  
3. **이벤트별 피처**: 에너지(대역 경계 사용), clarity, temporal, spectral, context.  
4. **스코어링/레이어링**: `assign_roles_by_band(energy_extras, temporal=..., dependency=..., focus=...)` → `write_layered_json(..., role_composition)`.

---

## 2. 스크립트·엔트리 (실제 경로)

| 스크립트 | 경로 | 역할 | 출력 JSON |
|----------|------|------|-----------|
| 01_explore | `audio_engine/scripts/explore/01_explore.py` | Onset/Beat 검출 | `onset_beats.json` |
| 02_split_stem | `audio_engine/scripts/explore/02_split_stem.py` | Demucs 스템 분리 | (WAV 4개) |
| 03_visualize_point | `audio_engine/scripts/explore/03_visualize_point.py` | 세기·질감 시각화용 JSON | `onset_events.json` |
| 01_energy ~ 06_layered_export | `audio_engine/scripts/onset_layered/01_energy.py` ~ `06_layered_export.py` | Energy/Clarity/Temporal/Spectral/Context + 레이어 통합 | `onset_events_*.json`, `onset_events_layered.json` |
| drum/run | `audio_engine/scripts/drum/run.py` | CNN band onset → keypoints_by_band, texture_blocks_by_band (스트림 미사용) | (반환값만, JSON 직접 쓰지 않음) |
| drum/cnn_band_onsets | `audio_engine/scripts/drum/cnn_band_onsets.py` | CNN band onset만 → drum_band_energy JSON (선택) | (선택) |
| drum/madmom_band | `audio_engine/scripts/drum/madmom_band.py` | madmom 드럼 대역 (선택) | (선택) |
| bass/run | `audio_engine/scripts/bass/run.py` | run_bass_pipeline → curve, keypoints | (반환값만) |
| **export/run_stem_folder** | `audio_engine/scripts/export/run_stem_folder.py` | stem 폴더명 → drum.run + bass.run(조건부) → write_streams_sections_json | `streams_sections_cnn.json` |
| legacy/streams_sections | `audio_engine/scripts/legacy/streams_sections.py` | (LEGACY) build_streams → segment_sections | 실행 비활성 |
| legacy/drum_band_energy | `audio_engine/scripts/legacy/drum_band_energy.py` | (LEGACY) stem 기반 low/mid/high 에너지 | 실행 비활성 |

공용 경로·스템 기준 디렉터리는 `scripts/_common.py`의 `find_project_root`, `get_stems_base_dir` 사용.

---

## 3. 06_layered_export 흐름 (실제 코드)

1. `build_context_with_band_evidence(audio_path, include_temporal=True)` → `OnsetContext` (anchor 1회 + band_evidence 연결).
2. `compute_energy(ctx)` → scores + **energy_extras** (고정 BAND_HZ: 20–200, 200–3k, 3k–10k Hz).  
   나머지 4개 지표 → `metrics`.
3. `assign_roles_by_band(energy_extras, temporal=..., dependency=..., focus=..., onset_times=ctx.onset_times, band_evidence=ctx.band_evidence)` → **role_composition** (P1은 band별 last seen + IOI 유사도).
4. `write_layered_json(ctx, metrics, role_composition, json_path, ...)` → `onset_events_layered.json` (events[].**bands**, 호환용 layer) + `web/public` 복사.

---

## 4. 샘플 오디오·출력 위치

- **입력 예시**: `audio_engine/samples/stems/htdemucs/sample_ropes_short/drums.wav`
- **출력**: `audio_engine/samples/onset_events_*.json`, `onset_events_layered.json`
- **웹 복사**: `web/public/` (동일 파일명)
