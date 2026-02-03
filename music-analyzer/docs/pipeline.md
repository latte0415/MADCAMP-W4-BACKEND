# 파이프라인 — 데이터 흐름·스크립트 실행 순서

전체 흐름을 **1. 대역 분류 → 2. (선택) 대역별 onset → 3. 이벤트별 피처 → 4. 스코어링/레이어링** 순으로 정리합니다.

---

## 1. 전체 흐름

```
오디오 파일
    → Step 1 탐색 (01_explore)        → onset_beats.json
    → Step 2 스템 분리 (02_split_stem) → stems/htdemucs/{트랙}/drums|bass|vocals|other.wav
    → Step 3 시각화 (03_visualize_point) → onset_events.json
    → 레이어드 익스포트 (01_energy ~ 05_context) → onset_events_energy|clarity|temporal|spectral|context.json
    → 레이어 통합 (06_layered_export)  → onset_events_layered.json
    → 스트림·섹션 (07_streams_sections) → streams_sections.json (streams, sections, keypoints)
    → Web (JsonUploader, parseEvents) → 파형 위 이벤트/레이어 표시
```

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
| 01_explore | `audio_engine/scripts/01_basic_test/01_explore.py` | Onset/Beat 검출 | `onset_beats.json` |
| 02_split_stem | `audio_engine/scripts/01_basic_test/02_split_stem.py` | Demucs 스템 분리 | (WAV 4개) |
| 03_visualize_point | `audio_engine/scripts/01_basic_test/03_visualize_point.py` | 세기·질감 시각화용 JSON | `onset_events.json` |
| 01_energy | `audio_engine/scripts/02_layered_onset_export/01_energy.py` | Energy(RMS·대역) | `onset_events_energy.json` |
| 02_clarity | `audio_engine/scripts/02_layered_onset_export/02_clarity.py` | Clarity(attack time) | `onset_events_clarity.json` |
| 03_temporal | `audio_engine/scripts/02_layered_onset_export/03_temporal.py` | Temporal(그리드·반복) | `onset_events_temporal.json` |
| 04_spectral | `audio_engine/scripts/02_layered_onset_export/04_spectral.py` | Spectral(focus) | `onset_events_spectral.json` |
| 05_context | `audio_engine/scripts/02_layered_onset_export/05_context.py` | Context(dependency) | `onset_events_context.json` |
| **06_layered_export** | `audio_engine/scripts/02_layered_onset_export/06_layered_export.py` | 5개 피처 + band 기반 역할(P0/P1/P2) 할당 | `onset_events_layered.json` |
| **07_streams_sections** | `audio_engine/scripts/02_layered_onset_export/07_streams_sections.py` | band_onset_times → build_streams → segment_sections → 키포인트 → JSON | `streams_sections.json` |

02_layered_onset_export 스크립트는 모두 `audio_engine.engine.onset`만 사용합니다.

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
