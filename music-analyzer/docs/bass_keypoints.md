# 베이스 키포인트 — 정리 문서

베이스 스템(bass.wav) 분석에서 **노트(notes)** 와 **연속 곡선(bass_curve_v3)** 을 추출해 `streams_sections_cnn.json`의 `bass` 필드로 저장·웹에서 시각화하는 흐름을 정리한 문서입니다.

---

## 1. 개요

- **목적**: bass.wav에서 **madmom Dual Onset Track**(v4, 메인) 또는 레거시 Rise+Sustain(v2)으로 노트를 검출하고, 연속 곡선(v3)을 별도로 생성합니다.
- **정책 v4**: RNNOnset(구조용) + SpectralOnset(superflux, 밀도/연결용). 노트 경계는 RNN onset peak picking으로 확정. superflux mean/var로 render_type(point/line), groove_confidence 계산.
- **출력**: `{"notes": [...], "render": {...}, "bass_curve_v3"?: [...], "bass_curve_v3_meta"?: {...}}` → `write_streams_sections_json(..., bass=...)` 로 저장.

---

## 2. 파이프라인 흐름

### v4 (메인 — madmom Dual Onset Track)

```
bass.wav
  → Track A: RNNOnsetProcessor + OnsetPeakPickingProcessor  → onset_times_sec
  → Track B: SpectralOnsetProcessor(superflux)              → activation curve (peak picking 없음)
  → 세그먼트 [onset[i], onset[i+1])                        → note boundaries
  → 각 세그먼트: pyin 피치 + Hilbert 에너지 + superflux_mean/var
  → render_type(point|line), groove_confidence 판별
  → build_bass_output(notes)
```

- **엔트리**: `run_bass_v4(bass_wav_path, sr)` ([`engine/bass/bass_v4.py`](../audio_engine/engine/bass/bass_v4.py)).
- **스크립트**: `audio_engine/scripts/bass/run.py` — `run_bass_v4` 호출. `run_stem_folder.py`에서 bass.wav 있으면 이 run 호출 후 JSON 저장.

### v2 (레거시 — 노트)

```
bass.wav
  → Step A: band-pass 30~250 Hz           → bass_wave
  → Step B: Hilbert envelope + 10ms 그리드  → times, amp
  → Step C: Rise 검출                     → rise_indices
  → Step D: Sustain 통과                  → (start_frame, end_frame) 블록
  → Step E: 노트 블록 (duration 최소/최대, 인접 중복 제거)
  → Step F: 각 블록에 pyin 피치 붙이기    → notes (dict)
  → Step G: energy_mean 임계값 미만 제거
  → 인접 같은 피치 필터
  → build_bass_output(notes)             → { notes, render }
```

### v3 (연속 곡선)

```
bass.wav
  → band-pass + Hilbert envelope
  → pyin 피치(보간) + 공통 10ms 그리드
  → bass_curve_v3: [{ t, pitch, amp }, ...]
```

- **엔트리**: `run_bass_v2`, `run_bass_v3` (레거시, engine 내부 참조용).

---

## 3. 백엔드 — 디렉터리·파일

| 파일 | 역할 |
|------|------|
| `engine/bass/bass_v4.py` | **v4 메인**: madmom Dual Onset Track (RNN onset + superflux) → render_type, groove_confidence |
| `engine/bass/bass_v2.py` | **v2 [LEGACY]**: band-pass → Hilbert envelope → Rise/Sustain → 노트 블록 |
| `engine/bass/bass_v3.py` | **v3 [LEGACY]**: Hilbert + pyin(보간) → bass_curve_v3 |
| `engine/bass/export.py` | `build_bass_output(notes)` — notes → `{ notes, render }` (JSON 스키마, superflux/render_type/groove_confidence 포함) |
| `scripts/bass/run.py` | `run(bass_wav_path)` — run_bass_v4 호출 |

---

## 4. v2 상수 및 로직 (bass_v2.py)

### Step A — 대역

- `BAND_LOW_HZ = 30`, `BAND_HIGH_HZ = 250`, `BAND_ORDER = 4`  
- band-pass 필터로 베이스 대역만 유지 (노이즈·고역 제거).

### Step B — 엔벨로프

- `HOP_SEC = 0.01` (10ms 그리드)
- Hilbert envelope: `amp = |hilbert(bass_wave)|`  
- 프레임별 amp = 해당 hop 구간 평균.

### Step C — Rise 검출

- **조건**: `amp[t] > percentile(amp[t-w:t], RISE_BASELINE_PERCENTILE) * (1 + RISE_RATIO)`
- `RISE_WINDOW_SEC = 0.03` — lookback 구간
- `RISE_RATIO = 0.15`
- `RISE_BASELINE_PERCENTILE = 25` — median(50) 대신 하위 백분위 사용 → 이전 피크 감쇠 직후 상승(3번째 라이즈 등)도 인정.

### Step D — Sustain

- **조건**: 구간 내 **평균 진폭** ≥ `amp[i0] * SUSTAIN_RATIO`
- `SUSTAIN_WIN_SEC = 0.04`, `SUSTAIN_RATIO = 0.4`
- `SUSTAIN_USE_FRONT_HALF_ONLY = True` — **구간 앞쪽 절반만** 평균 계산 → 빨리 감소하는 피크도 통과.

### Step E — 노트 블록

- `MIN_NOTE_DURATION_SEC = 0.05` — 이보다 짧으면 버림
- `DECAY_RATIO = 0.35` — end = amp가 `amp[t0]*DECAY_RATIO` 이하로 떨어지는 시점
- `MAX_NOTE_DURATION_SEC = 0.6`
- `MIN_GAP_BETWEEN_STARTS_SEC = 0.03` — 인접 rise 중 같은 히트로 보이는 것 제거

### Step G — 에너지 필터

- `ENERGY_MEAN_MIN = 0.2` — 평균 진폭이 이 미만이면 노이즈로 제거

### 인접 같은 피치

- `PITCH_SAME_TOLERANCE = 0.35` (MIDI), `ADJACENT_SAME_PITCH_MAX_GAP_SEC = 0.8`  
- 같은 피치이고 시작 시각이 gap 이내면 하나만 유지 (energy_peak 큰 쪽).

### Step F — 피치

- 각 노트 블록 구간에 대해 `librosa.pyin` (PYIN_FMIN=50, PYIN_FMAX=250).  
- 실패 시 `DEFAULT_PITCH_HZ = 80`.

---

## 5. v3 연속 곡선 (bass_v3.py)

- Hilbert envelope + `librosa.pyin` 피치 (NaN 구간 보간)
- 10ms 공통 그리드에 time, pitch(MIDI), amp 정규화
- 출력: `bass_curve_v3: [{ t, pitch, amp }, ...]`, `bass_curve_v3_meta`

---

## 6. 스크립트·실행

### 베이스만 실행 (bass.wav 한 파일)

```bash
python -m audio_engine.scripts.bass.run <bass.wav 경로>
# 샘플레이트 지정(선택): ... <bass.wav 경로> 44100
```

- **반환**: `{ notes, render, bass_curve_v3, bass_curve_v3_meta }`. 터미널에 notes 개수, bass_curve_v3 점 수 출력.

### 드럼 + 베이스 → streams_sections_cnn.json

```bash
python -m audio_engine.scripts.export.run_stem_folder
```

- stem 폴더에 `bass.wav` 가 있으면 `bass/run.run(bass_path, sr)` 호출 후 `write_streams_sections_json(..., bass=bass_dict)` 로 저장.
- **기본 저장 경로**: `audio_engine/samples/streams_sections_cnn.json`.

### JSON을 웹에서 쓰려면 (복사)

```bash
cp audio_engine/samples/streams_sections_cnn.json web/public/streams_sections_cnn.json
```

---

## 7. JSON 스키마 (bass 필드)

- **`bass`** (선택): `{ "notes": [...], "render": {...}, "bass_curve_v3"?: [...], "bass_curve_v3_meta"?: {...} }`

### bass.notes[]

각 요소 (한 노트):

- `start`, `end`, `duration`: 구간 (초)
- `pitch_curve`: `[[t, p], ...]` — t(초), p(MIDI 또는 null)
- `pitch_center`, `pitch_median`: MIDI
- `energy_peak`, `energy_mean`
- `attack_time`, `decay_time` (선택)
- `simplified_curve` (선택)
- **v4 확장**: `superflux_mean`, `superflux_var`, `render_type` ("point"|"line"), `groove_confidence` (0~1), `groove_group` (선택), `superflux_curve` (선택)

### bass.render

- `y_axis`, `thickness`, `curve` — 웹 렌더 힌트

### bass.bass_curve_v3 (v3 연속 곡선)

- `[{ t, pitch, amp }, ...]` — t(초), pitch(MIDI), amp(0~1 정규화)

### bass.bass_curve_v3_meta

- v3 곡선 메타 정보 (선택)

---

## 8. 웹 — 타입·파싱·뷰

### 타입 (web/src/types/streamsSections.ts)

- `BassNote`: start, end, duration, pitch_curve, pitch_center, energy_peak, energy_mean, simplified_curve?, superflux_mean?, superflux_var?, render_type?, groove_confidence?, groove_group?, superflux_curve? 등
- `BassCurveV3Point`: t, pitch, amp
- `BassData`: notes, render?, bass_curve_v3?, bass_curve_v3_meta?

### 파싱 (web/src/utils/parseEvents.ts)

- `parseBassData(raw)`: notes, render, bass_curve_v3, bass_curve_v3_meta 파싱
- `parseStreamsSectionsJson`: obj.bass → parseBassData

### 뷰 (web/src/components/Tab14BassView.tsx)

- **입력**: `audioUrl`, `data` (StreamsSectionsData; `data.bass` 사용).
- **트랙 2개**: (1) 파형 WaveSurfer, (2) 피치 스트립 (v2 노트 또는 v3 연속 곡선). 동일 visibleRange로 시간축 맞춤.
- **v2/v4 노트**: polyline + 시작 마커(원), 재생선, 현재 재생 노트 활성화. `render_type === "line"`이고 `groove_confidence` 있으면 strokeWidth/opacity에 반영.
- **v3**: Canvas 연속 곡선 (두께 = amp).
- **탭**: "베이스"(최종본) / "14 베이스"(테스트). 샘플 경로 `/streams_sections_cnn.json`.

---

## 9. 요약 표

| 항목 | 내용 |
|------|------|
| 노트 검출 방식 (v4 메인) | madmom Dual Onset Track: RNN onset(구조) + superflux(밀도/연결) |
| render_type | superflux var/duration/연속성 → "point" 또는 "line" |
| groove_confidence | superflux mean/var/duration 기반 0~1 |
| 피치 | 노트 검출 후 각 블록 pyin (50~250 Hz) |
| v3 곡선 | Hilbert + pyin 보간, 10ms 그리드, pitch/amp |
| 백엔드 진입점 | `run_bass_v4`, `scripts/bass/run.run` |
| 저장 | `write_streams_sections_json(..., bass=...)` → 기본 `audio_engine/samples/streams_sections_cnn.json` |
| 웹 | Tab14BassView, 트랙 2개(파형 / 피치), groove_confidence 기반 stroke |
