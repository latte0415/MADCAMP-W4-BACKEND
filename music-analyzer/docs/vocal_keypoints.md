# 보컬 키포인트 — 정리 문서

보컬 스템(vocals.wav) 분석에서 **연속 곡선(vocal_curve)** 과 **프레이즈/제스처(vocal_phrases 또는 vocal_turns + vocal_onsets)** 를 추출해 `streams_sections_cnn.json`의 `vocal` 필드로 저장·웹에서 시각화하는 흐름을 정리한 문서입니다.

---

## 1. 개요

- **목적**: vocals.wav에서 **onset 노트 검출은 사용하지 않고**, 시간–피치 연속 곡선 + "의미 단위"(프레이즈·제스처·온셋)만 추출합니다.
- **정책**: `USE_PHRASE=True`(기본) 시 phrase boundary(amp/activation OR 조건) → phrase 내부 gesture → `vocal_phrases` + flatten → `vocal_keypoints`. `USE_PHRASE=False` 시 turn(피치 극값) + vocal_onsets(activation peak) → `vocal_turns`, `vocal_onsets` + keypoints.
- **출력**: `{"vocal_curve": [...], "vocal_keypoints": [...], "vocal_curve_meta": {...}, "vocal_phrases"?: [...], "vocal_turns"?: [...], "vocal_onsets"?: [...]}` → `write_streams_sections_json(..., vocal=...)` 로 저장.

---

## 2. 파이프라인 흐름

**USE_PHRASE=True (메인)**  
```
vocals.wav → run_vocal_curve → vocal_curve, vocal_activation
  → compute_vocal_phrases(curve, activation) → phrase boundary(OR) + phrase 내부 gesture
  → vocal_phrases, keypoints_flat → build_vocal_output(curve, keypoints_flat, meta, vocal_phrases=phrases)
```

**USE_PHRASE=False**  
```
vocals.wav → run_vocal_curve → vocal_curve, vocal_activation
  → compute_vocal_turns(curve) + compute_vocal_onsets(t, activation 또는 amp) → vocal_turns, vocal_onsets
  → keypoints_flat 정렬 → build_vocal_output(curve, keypoints_flat, meta, vocal_turns=..., vocal_onsets=...)
```

- **엔트리**: `scripts/vocal/run.py` — `run_vocal_curve` → `compute_vocal_phrases` 또는 `compute_vocal_turns` + `compute_vocal_onsets` → `build_vocal_output`.
- **스크립트**: `audio_engine/scripts/vocal/run.py`. `run_stem_folder.py`에서 vocals.wav 있으면 이 run 호출 후 JSON 저장.

---

## 3. 백엔드 — 디렉터리·파일

| 파일 | 역할 |
|------|------|
| `engine/vocal/vocal_curve.py` | pyin + envelope + centroid → vocal_curve, vocal_activation |
| `engine/vocal/vocal_phrases.py` | phrase boundary(OR) + phrase 내부 gesture → vocal_phrases, keypoints_flat (USE_PHRASE=True) |
| `engine/vocal/vocal_onsets.py` | activation/amp 기반 peak → vocal_onsets (USE_PHRASE=False) |
| `engine/vocal/export.py` | `build_vocal_output(curve, keypoints_flat, meta, vocal_phrases=..., vocal_turns=..., vocal_onsets=...)` |
| `scripts/vocal/run.py` | `run(vocals_wav_path, sr)` — USE_PHRASE 분기 후 위 파이프라인 실행 |

---

## 4. vocal_curve 스키마

- **vocal_curve**: `[{ t, pitch, amp, centroid? }, ...]`
  - `t`: 시간(초)
  - `pitch`: MIDI
  - `amp`: 0~1 정규화 (Hilbert envelope)
  - `centroid`: (선택) 0~1 정규화 spectral centroid
- **vocal_curve_meta**: `{ pitch_unit, amp, y_axis_hint? }`

---

## 5. vocal_keypoints · vocal_phrases · vocal_turns · vocal_onsets

- **vocal_keypoints**: 시각화/플랫 리스트. `USE_PHRASE=True` 시 `vocal_phrases[].gestures`를 시간순 이어붙인 것; `USE_PHRASE=False` 시 `vocal_turns` + `vocal_onsets` 정렬.
- **vocal_phrases**: `[{ "start", "end", "gestures": [{ "t", "type", "direction?", "delta_pitch?", "strength?" }] }]` — phrase boundary(OR: amp/activation 임계 + 최소 길이) 내부에서 pitch smoothing + local extremum 기반 gesture.
- **vocal_turns**: 피치 극값(turn) 지점. `{ "t", "direction", "delta_pitch", "score" }` 등.
- **vocal_onsets**: activation(또는 amp) peak 기반 onset 시점. `{ "t", "score", "strength" }` 등.
- **phrase boundary**: (amp < AMP_LOW for ≥ T1) OR (activation < ACT_LOW for ≥ T2), phrase_duration ≥ PHRASE_MIN_LEN. 자세한 것은 [vocal_refactor_spec.md](vocal_refactor_spec.md) 참고.

---

## 6. 스크립트·실행

### 보컬만 실행 (vocals.wav 한 파일)

```bash
python -m audio_engine.scripts.vocal.run <vocals.wav 경로>
```

- **반환**: `{ vocal_curve, vocal_keypoints, vocal_curve_meta, vocal_phrases?, vocal_turns?, vocal_onsets? }`. 터미널에 curve 점 수, keypoints 개수, phrases 개수 출력.

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
| USE_PHRASE=True | phrase boundary(OR) + phrase 내부 gesture → vocal_phrases, vocal_keypoints |
| USE_PHRASE=False | vocal_turns(피치 극값) + vocal_onsets(activation peak) |
| phrase boundary | (amp/activation 임계 + 최소 길이) — vocal_refactor_spec.md 참고 |
| 백엔드 진입점 | `scripts/vocal/run.run`, `build_vocal_output` |
| 저장 | `write_streams_sections_json(..., vocal=...)` → streams_sections_cnn.json |
