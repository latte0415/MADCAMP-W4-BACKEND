# Other 스템 키포인트 — 정리 문서

Other 스템(other.wav) 분석에서 **리듬(onset 밀도 곡선)** 과 **패드/앰비언트(유지 구간 영역)** 를 추출해 `streams_sections_cnn.json`의 `other` 필드로 저장·웹에서 시각화하는 흐름을 정리한 문서입니다.

---

## 1. 개요

- **목적**: other.wav에서 두 가지 해석을 동시에 낼 수 있도록 함.
  - **리듬적 Other**(기타 스트럼, 펑크, 신스 리듬): window 내 onset 개수(density) → `other_curve`.
  - **패드/앰비언트 Other**: onset은 거의 무의미 → RMS 기반 “유지 구간” → `other_regions` (반투명 밴드용).
- **출력**: `{"other_curve": [...], "other_keypoints": [...], "other_regions": [...], "other_meta": {...}}` → `write_streams_sections_json(..., other=...)` 로 저장.

---

## 2. 파이프라인 흐름

```
other.wav
  → [리듬] onset_strength + onset_detect → window(WINDOW_SEC)별 onset 개수 → other_curve: [{ t, density }, ...]
  → [패드] RMS (hop=RMS_HOP) → RMS ≥ 백분위 임계인 연속 구간 → 병합 → other_regions: [{ start, end, intensity }, ...]
  → build_other_output(curve, keypoints, regions, meta)
```

- **엔트리**: `run_other_pipeline` ([`engine/other/other_pipeline.py`](../audio_engine/engine/other/other_pipeline.py)).
- **스크립트**: `audio_engine/scripts/other/run.py` — other.wav 경로 받아 curve + regions 생성 후 dict 반환. `run_stem_folder.py`에서 other.wav 있으면 이 run 호출 후 JSON 저장.

---

## 3. 백엔드 — 디렉터리·파일

| 파일 | 역할 |
|------|------|
| `engine/other/other_pipeline.py` | onset density 곡선 + RMS 기반 other_regions |
| `engine/other/export.py` | `build_other_output(...)` — JSON 호환 dict |
| `scripts/other/run.py` | `run(other_wav_path, sr)` — other 파이프라인 실행 |

---

## 4. 스키마

### other_curve (리듬)

- `[{ t, density }, ...]`
  - `t`: window 중심 시간(초)
  - `density`: 0~1 정규화 (window 내 onset 개수)

### other_regions (패드)

- `[{ start, end, intensity? }, ...]`
  - `start`, `end`: 구간(초)
  - `intensity`: 구간 평균 RMS (선택)

### other_keypoints

- 현재 빈 배열. 추후 리듬 peak 시점 등 보조 마커용으로 확장 가능.

---

## 5. 상수 (other_pipeline.py)

- `HOP_LENGTH = 512`
- `WINDOW_SEC = 0.5` — density window
- `MIN_REGION_SEC = 0.3` — 패드 최소 구간
- `RMS_PERCENTILE = 25` — 이 백분위 이상 = 유지 구간 후보
- `RMS_HOP = 512`

---

## 6. 스크립트·실행

### Other만 실행 (other.wav 한 파일)

```bash
python -m audio_engine.scripts.other.run <other.wav 경로>
```

### 드럼 + 베이스 + 보컬 + Other → streams_sections_cnn.json

```bash
python -m audio_engine.scripts.export.run_stem_folder
```

- stem 폴더에 `other.wav` 가 있으면 `other/run.run(other_path, sr)` 호출 후 `write_streams_sections_json(..., other=other_dict)` 로 저장.

---

## 7. 웹 — 타입·파싱·뷰

- **타입** (`web/src/types/streamsSections.ts`): `OtherCurvePoint`, `OtherRegion`, `OtherData`.
- **파싱** (`web/src/utils/parseEvents.ts`): `parseOtherData(raw)`.
- **뷰** (`web/src/components/Tab16OtherView.tsx`): 리듬 = onset 밀도 곡선, 패드 = 반투명 밴드(구간).

---

## 8. 요약

| 항목 | 내용 |
|------|------|
| 리듬적 표현 | other_curve (window onset density) |
| 패드 표현 | other_regions (RMS 유지 구간, 반투명 밴드) |
| 시각화 의도 | 리듬 = 곡선/밀도, 패드 = 영역(텍스처) |
