# 개발자 온보딩 — 환경·실행·검증

새로 합류한 개발자가 환경을 맞추고, 스크립트를 실행하고, 검증을 한 번에 할 수 있도록 정리합니다.

---

## 1. 환경

- **Python**: 3.10+ 권장. `requirements.txt` 기준.
- **의존성**: 프로젝트 루트에서 `pip install -r requirements.txt`. (librosa, numpy, scipy 등.)
- **웹(선택)**: `web/` 디렉터리에서 `npm install`, `npm run dev`.

---

## 2. 디렉터리·샘플 오디오

- **프로젝트 루트**: `music-analyzer/` (또는 저장소 루트).
- **샘플 오디오**: `audio_engine/samples/stems/htdemucs/{트랙명}/drums.wav` 또는 CNN용 `drum_low.wav`, `drum_mid.wav`, `drum_high.wav` 등.  
  없으면 먼저 02_split_stem으로 스템 분리하거나, 다른 WAV 경로를 스크립트에서 지정.

---

## 3. 실행 순서 (레이어드 익스포트)

1. **컨텍스트 + 피처별 JSON**  
   ```bash
   python audio_engine/scripts/onset_layered/01_energy.py
   python audio_engine/scripts/onset_layered/02_clarity.py
   python audio_engine/scripts/onset_layered/03_temporal.py
   python audio_engine/scripts/onset_layered/04_spectral.py
   python audio_engine/scripts/onset_layered/05_context.py
   ```

2. **레이어 통합 JSON**  
   ```bash
   python audio_engine/scripts/onset_layered/06_layered_export.py
   ```

3. **드럼 + 베이스 통합 JSON (메인 진입점)**  
   ```bash
   python audio_engine/scripts/export/run_stem_folder.py
   ```
   - stem 폴더명 지정(예: sample_animal_spirits_3_45). drum/run + bass/run(조건부) → `streams_sections_cnn.json`.

- 산출: `audio_engine/samples/onset_events_*.json`, `onset_events_layered.json`, `streams_sections_cnn.json`.  
- `web/public/` 이 있으면 동일 파일이 복사됨.

---

## 4. 웹에서 듣고 테스트

웹 앱에서 **오디오 재생 + JSON 시각화**를 함께 테스트할 수 있습니다.

1. **웹 실행**: `music-analyzer/web/`에서 `npm install` 후 `npm run dev`.
2. **샘플 오디오 로드**: 상단 **「샘플 오디오 로드」** 버튼 클릭 → `web/public/sample_drums.wav`(sample_animal_spirits_3_45 드럼 스템) 재생 가능.
3. **JSON 로드**: 원하는 탭(예: **13 Drum Keypoints**) 선택 후 **「○○ 샘플 로드」** 클릭 → `streams_sections_cnn.json` 등 로드.
4. **재생**: 파형 위 **재생 버튼** 클릭 → 오디오 재생, 시각화와 동기화.

**직접 오디오 파일 사용**: 상단 **「오디오 파일 업로드」**로 WAV/MP3 업로드 후, 같은 방식으로 JSON 로드·재생하면 됩니다.  
(샘플 JSON과 시간축이 맞는 오디오를 쓰면 시각화와 재생이 일치합니다.)

---

## 5. 검증 한 번에

**공개 API import**:
```bash
cd /path/to/music-analyzer
python -c "
from audio_engine.engine.onset import (
    build_context, build_context_with_band_evidence,
    compute_energy, compute_clarity, compute_temporal, compute_spectral, compute_context_dependency,
    assign_roles_by_band, write_layered_json,
    build_streams, segment_sections, compute_cnn_band_onsets_with_odf, simplify_shaker_clap_streams, assign_layer_to_streams,
)
print('OK: 공개 API import 성공')
"
```

**엔드투엔드 (06까지)**:
```bash
python audio_engine/scripts/onset_layered/06_layered_export.py
# 종료 코드 0, onset_events_layered.json 생성 확인
```

**엔드투엔드 (드럼+베이스 통합)**:
```bash
python audio_engine/scripts/export/run_stem_folder.py
# stem 폴더명 인자로 전달. streams_sections_cnn.json 생성 확인
```

---

## 6. 문서 참조

| 문서 | 내용 |
|------|------|
| [README.md](README.md) | 기록 정보 정리·분류·목차 |
| [onset_module.md](onset_module.md) | 모듈 구조·API·검증 |
| [pipeline.md](pipeline.md) | 데이터 흐름·스크립트 01~11 |
| [json_spec.md](json_spec.md) | JSON 스키마 |
| [layering.md](layering.md) | band 기반 역할·레이어링 설계 |
| [onset_stability.md](onset_stability.md) | 안정화 계획 |
| [progress.md](progress.md) | 진행·값 가공·점수 해석 |
