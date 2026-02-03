# 개발자 온보딩 — 환경·실행·검증

새로 합류한 개발자가 환경을 맞추고, 스크립트를 실행하고, 검증을 한 번에 할 수 있도록 정리합니다.

---

## 1. 환경

- **Python**: 3.10+ 권장. `requirements.txt` 기준.
- **의존성**: 프로젝트 루트에서 `pip install -r requirements.txt`. (librosa, numpy, scipy 등.)
- **웹(선택)**: `web/` 디렉터리에서 `npm install`, `npm run dev`.

---

## 2. 디렉터리·샘플 오디오

- **프로젝트 루트**: `music-anaylzer/` (또는 저장소 루트).
- **샘플 오디오**: `audio_engine/samples/stems/htdemucs/sample_ropes_short/drums.wav` 등.  
  없으면 먼저 02_split_stem으로 스템 분리하거나, 다른 WAV 경로를 스크립트에서 지정.

---

## 3. 실행 순서 (레이어드 익스포트)

1. **컨텍스트 + 피처별 JSON**  
   ```bash
   python audio_engine/scripts/02_layered_onset_export/01_energy.py
   python audio_engine/scripts/02_layered_onset_export/02_clarity.py
   python audio_engine/scripts/02_layered_onset_export/03_temporal.py
   python audio_engine/scripts/02_layered_onset_export/04_spectral.py
   python audio_engine/scripts/02_layered_onset_export/05_context.py
   ```

2. **레이어 통합 JSON**  
   ```bash
   python audio_engine/scripts/02_layered_onset_export/06_layered_export.py
   ```

3. **(선택) 스트림·섹션 JSON**  
   ```bash
   python audio_engine/scripts/02_layered_onset_export/07_streams_sections.py
   ```
   - `build_context_with_band_evidence` 필요. 산출: `streams_sections.json`.

- 산출: `audio_engine/samples/onset_events_*.json`, `onset_events_layered.json`, (선택) `streams_sections.json`.  
- `web/public/` 이 있으면 동일 파일이 복사됨.

---

## 4. 검증 한 번에

**공개 API import**:
```bash
cd /path/to/music-anaylzer
python -c "
from audio_engine.engine.onset import (
    build_context, build_context_with_band_evidence,
    compute_energy, compute_clarity, compute_temporal, compute_spectral, compute_context_dependency,
    assign_roles_by_band, write_layered_json,
)
print('OK: 공개 API import 성공')
"
```

**엔드투엔드 (06까지)**:
```bash
python audio_engine/scripts/02_layered_onset_export/06_layered_export.py
# 종료 코드 0, onset_events_layered.json 생성 확인
```

---

## 5. 문서 참조

| 문서 | 내용 |
|------|------|
| [README.md](README.md) | 기록 정보 정리·분류·목차 |
| [onset_module.md](onset_module.md) | 모듈 구조·API·검증 |
| [pipeline.md](pipeline.md) | 데이터 흐름·스크립트 01~06 |
| [json_spec.md](json_spec.md) | JSON 스키마 |
| [layering.md](layering.md) | band 기반 역할·레이어링 설계 |
| [onset_stability.md](onset_stability.md) | 안정화 계획 |
| [progress.md](progress.md) | 진행·값 가공·점수 해석 |
