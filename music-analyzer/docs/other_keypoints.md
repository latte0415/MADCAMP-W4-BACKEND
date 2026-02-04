# Other 스템 키포인트 — 멜로디 기반 파이프라인

Other 스템(other.wav)에서 **멜로디 피치 곡선**을 추정하고, 그 위에서 **멜로디 이벤트(키포인트)**와 **멜로디 활성 구간(밴드)**를 추출해 `streams_sections_cnn.json`의 `other` 필드로 저장·웹에서 시각화하는 흐름을 정리한 문서입니다.

---

## 1. 개요

- **목적**: other.wav에서 **멜로디 흐름을 눈으로 볼 수 있게** (피치 곡선 + 전환점/강조 지점 + 활성 구간) 제공.
- **핵심 아이디어**
  - **멜로디 곡선**: harmonic 성분 분리 → f0 추정(pyin / torchcrepe) → pitch curve
  - **키포인트**: phrase_start / pitch_turn / accent
  - **영역**: voiced 연속 구간 병합 → other_regions
- **출력**: `{"other_curve": [...], "other_keypoints": [...], "other_regions": [...], "other_meta": {...}}`

---

## 2. 파이프라인 흐름

```
other.wav
  → harmonic 분리
  → f0 추정 (torchcrepe 우선, 없으면 pyin)
  → pitch curve (midi) + amp
  → keypoints (phrase_start, pitch_turn, accent)
  → voiced 연속 구간 → regions
```

- **엔트리**: `run_other_pipeline` (`engine/other/other_pipeline.py`)
- **스크립트**: `audio_engine/scripts/other/run.py` → other.wav 경로 받아 dict 반환

---

## 3. 스키마

### other_curve (멜로디 곡선)

- `[{ t, pitch, amp, voiced }, ...]`
  - `t`: 시간(초)
  - `pitch`: MIDI (없으면 null)
  - `amp`: 0~1 정규화 에너지
  - `voiced`: 멜로디 활성 여부

### other_keypoints

- `[{ t, type, score, ... }, ...]`
  - `type`:
    - `phrase_start` : 멜로디 구간 시작
    - `pitch_turn` : 멜로디 피치 전환점 (direction 포함)
    - `accent` : 에너지 강조 지점

### other_regions (멜로디 활성 밴드)

- `[{ start, end, intensity, pitch_mean }, ...]`
  - `start`, `end`: 구간(초)
  - `intensity`: 구간 평균 amp
  - `pitch_mean`: 구간 평균 pitch (MIDI)

### other_meta

- 예: `{"mode":"melody","pitch_unit":"midi","f0_source":"pyin","fmin_hz":...,"fmax_hz":...,"hop_length":...}`

---

## 4. 요약

| 항목 | 내용 |
|------|------|
| 멜로디 흐름 | other_curve (pitch curve) |
| 멜로디 이벤트 | other_keypoints (start/turn/accent) |
| 멜로디 영역 | other_regions (voiced 구간) |
| 시각화 의도 | 피치 선 + 전환점 + 밴드 |
