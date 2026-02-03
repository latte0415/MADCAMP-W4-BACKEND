# onset 모듈 구조

## 드럼 키포인트 파이프라인 (최종본)

**진입점**: `compute_cnn_band_onsets_with_odf` → `select_key_onsets_by_band` → `merge_texture_blocks_by_band`

- **CNN+ODF**: band별 onset 시점·strength 검출 (스트림 미사용)
- **필터·에너지**: 짧은 구간(t±30ms) 진폭(RMS) 기준 percentile 게이트, low 관대 / mid·high 고스트 억제
- **출력**: `keypoints_by_band`, `texture_blocks_by_band`

스크립트: `scripts/drum/run.py`, 통합: `scripts/export/run_stem_folder.py`

---

## 파일 역할

| 구분 | 파일 | 역할 |
|------|------|------|
| L1 | types.py, constants.py, utils.py | 타입·상수·유틸 |
| L2 | pipeline.py, band_classification.py | onset 검출·정제·컨텍스트, 대역 분류 |
| L3 | features/*.py | energy, clarity, temporal, spectral, context |
| L4 | scoring.py | 정규화·역할 할당 |
| L5 | export.py | JSON 출력 |
| **드럼(최종)** | **drum/** | band_onset_merge, drum_band_energy, key_onset_selector, texture_block_merge, cnn_band_pipeline, cnn_band_onsets |
| 레거시 | legacy/ | streams, sections, stream_layer, stream_simplify (스트림/섹션·실험용, 메인 파이프라인 미사용) |
| 기타 | madmom_drum_band.py | madmom 기반 드럼 대역 키포인트 (선택 사용) |
