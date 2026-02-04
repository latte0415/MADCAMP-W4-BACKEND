# 보컬 키포인트 — 정리 문서

보컬 스템(vocals.wav) 분석에서 **연속 곡선(vocal_curve)** 과 **변화율 기반 키포인트(vocal_keypoints)** 를 추출해 `streams_sections_cnn.json`의 `vocal` 필드로 저장·웹에서 시각화하는 흐름을 정리한 문서입니다.

---

## 1. 개요

- **목적**: vocals.wav에서 **onset 노트 검출은 사용하지 않고**, 시간–피치 연속 곡선 + “의미 있는 변화” 지점(제스처 키포인트)만 추출합니다.
- **정책**: Bass v3와 동일한 재료(pyin + Hilbert envelope, 선택 spectral centroid)를 **vocal 주파수 대역**(80~1000 Hz)으로 적용. 키포인트는 `|Δpitch/Δt|` 또는 `|Δenergy/Δt|` 임계 초과 지점.
- **출력**: `{"vocal_curve": [...], "vocal_keypoints": [...], "vocal_curve_meta": {...}}` → `write_streams_sections_json(..., vocal=...)` 로 저장.

---

## 2. 파이프라인 흐름

```
vocals.wav
  → pyin (fmin=80, fmax=1000) + Hilbert envelope + (선택) spectral centroid
  → 공통 10ms 그리드 → vocal_curve: [{ t, pitch, amp, centroid? }, ...]
  → Δpitch/Δt, Δenergy/Δt 계산 → 임계 초과 지점 → vocal_keypoints: [{ t, type, score }, ...]
  → build_vocal_output(curve, keypoints, meta)
```

- **엔트리**: `run_vocal_curve` + `compute_vocal_keypoints` ([`engine/vocal/vocal_curve.py`](../audio_engine/engine/vocal/vocal_curve.py), [`engine/vocal/vocal_keypoints.py`](../audio_engine/engine/vocal/vocal_keypoints.py)).
- **스크립트**: `audio_engine/scripts/vocal/run.py` — vocals.wav 경로 받아 curve + keypoints 생성 후 dict 반환. `run_stem_folder.py`에서 vocals.wav 있으면 이 run 호출 후 JSON 저장.

---

## 3. 백엔드 — 디렉터리·파일

| 파일 | 역할 |
|------|------|
| `engine/vocal/vocal_curve.py` | pyin + envelope (+ centroid) → 공통 그리드 vocal_curve |
| `engine/vocal/vocal_keypoints.py` | vocal_curve에서 Δpitch/Δt, Δenergy/Δt 임계 기반 vocal_keypoints |
| `engine/vocal/export.py` | `build_vocal_output(curve, keypoints, meta)` — JSON 호환 dict |
| `scripts/vocal/run.py` | `run(vocals_wav_path, sr)` — vocal 파이프라인 실행 |

---

## 4. vocal_curve 스키마

- **vocal_curve**: `[{ t, pitch, amp, centroid? }, ...]`
  - `t`: 시간(초)
  - `pitch`: MIDI
  - `amp`: 0~1 정규화 (Hilbert envelope)
  - `centroid`: (선택) 0~1 정규화 spectral centroid
- **vocal_curve_meta**: `{ pitch_unit, amp, y_axis_hint? }`

---

## 5. vocal_keypoints 정의

- **vocal_keypoint** := `|Δpitch/Δt| > th_pitch` OR `|Δenergy/Δt| > th_energy` (추후: phrase boundary)
- **type**: `"pitch_change"` | `"energy_change"` | `"phrase"`(추후 정의)
- **phrase boundary**: 추후 별도 문서/이슈에서 정의 (예: silence 구간, 에너지 극소, 또는 모델 기반).

---

## 6. 스크립트·실행

### 보컬만 실행 (vocals.wav 한 파일)

```bash
python -m audio_engine.scripts.vocal.run <vocals.wav 경로>
```

- **반환**: `{ vocal_curve, vocal_keypoints, vocal_curve_meta }`. 터미널에 curve 점 수, keypoints 개수 출력.

### 드럼 + 베이스 + 보컬 → streams_sections_cnn.json

```bash
python -m audio_engine.scripts.export.run_stem_folder
```

- stem 폴더에 `vocals.wav` 가 있으면 `vocal/run.run(vocals_path, sr)` 호출 후 `write_streams_sections_json(..., vocal=vocal_dict)` 로 저장.

---

## 7. 웹 — 타입·파싱·뷰

- **타입** (`web/src/types/streamsSections.ts`): `VocalCurvePoint`, `VocalKeypoint`, `VocalData`.
- **파싱** (`web/src/utils/parseEvents.ts`): `parseVocalData(raw)`.
- **뷰** (`web/src/components/Tab15VocalView.tsx`): 시간(x)–피치(y, log scale) 연속 곡선, 선 굵기=amp, 작은 마커=vocal_keypoints.

---

## 8. 요약

| 항목 | 내용 |
|------|------|
| 노트 검출 | 사용하지 않음 (리듬 악기 아님) |
| 기본 표현 | 연속 곡선 (시간–피치) |
| 키포인트 의미 | 제스처 (pitch/energy 변화율 임계 초과) |
| phrase boundary | 추후 정의 |
