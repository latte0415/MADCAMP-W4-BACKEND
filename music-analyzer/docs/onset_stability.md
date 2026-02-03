# 같은 비트·다른 값 문제 — 수정 계획안

Energy/Clarity가 "같은 비트(MIDI·청각 동일)인데 다른 값"으로 나오는 원인(프레임 양자화, backtrack, 인접 타격 겹침)을 줄이기 위한 수정 계획.  
**측정 정의**를 바꿔서 기준 시점·윈도우에 덜 민감하게 만드는 방향으로 정리함.

---

## 현재 구현 상태 (engine.onset)

- **backtrack=False**: `pipeline.py` `detect_onsets()`에서 이미 사용.
- **refine_onset_times**: `pipeline.py`에서 ±80ms, hop_refine=64 로컬 피크 정제. `build_context()`에서 호출.
- **Energy 구간**: `features/energy.py`에서 [mid_prev, mid_next] 온셋 간 구간으로 RMS·대역 에너지 계산.
- **Clarity**: `features/clarity.py`에서 가변 윈도우(pre/post = gap 기반) 사용.

나머지(노트북 단독 수정, parabolic, Phase 4 등)는 계획대로 적용 대상.

---

## 적용 대상

| 대상 | 역할 |
|------|------|
| `audio_engine/scripts/02_layered_onset_export/01_energy.py` | Energy(RMS·대역별), energy_score |
| `audio_engine/scripts/02_layered_onset_export/02_clarity.py` | Attack time, clarity_score |
| `audio_engine/engine/onset/` | 위 계획 중 일부 이미 반영(backtrack=False, refine, mid_prev/mid_next) |

노트북이 **동일한 onset 파이프라인**을 쓰므로, 0·1·2단계는 한 번 적용하면 둘 다 이득.

---

## Phase 0: 즉시 패치 (우선 적용)

### 0-1) `backtrack=False`로 통일

**목적**: valley까지 당기는 backtrack이 타격마다 기준 시점을 흔들어서, 같은 비트가 다른 값으로 나오는 것을 완화.

**수정 위치**: 01_energy.ipynb, 02_clarity.ipynb — Onset 검출 셀에서 `onset_detect(..., backtrack=True)` → `backtrack=False`.  
*(engine.onset은 이미 `pipeline.detect_onsets()`에서 backtrack=False 사용.)*

### 0-2) 샘플 변환은 `round` 사용

**목적**: `int(t*sr)`는 항상 내림이라 편향이 생김. `round`로 바꿔 분산 완화.

**수정 위치**: 02_clarity.ipynb — Attack time 계산 루프에서 `center_sample = int(round(t * sr))`.  
*(engine.onset clarity는 이미 round 사용.)*

### 0-3) 윈도우를 "이웃 onset 기반" 가변으로 변경 (겹침 방지)

**목적**: 인접 타격이 한 윈도우에 섞이지 않게 함.

**공통 전제**: `onset_times`, `gap_prev[i]`, `gap_next[i]` (경계는 np.inf 등).

**01_energy.ipynb**: 시간 기준 가변 half-win — `left_sec = min(half_win_sec_fixed, 0.45*gap_prev[i])`, `right_sec = min(..., 0.45*gap_next[i])`, `start_sample = round((onset_times[i]-left_sec)*sr)` 등.

**02_clarity.ipynb**: `pre_sec = min(0.05, 0.45*gap_prev[i])`, `post_sec = min(0.02, 0.45*gap_next[i])`, `center_sample = round(onset_times[i]*sr)` 등.

*(engine.onset energy는 mid_prev/mid_next 구간, clarity는 gap 기반 가변 윈도우 이미 사용.)*

---

## Phase 1: 프레임 양자화 줄이기

### 1-1) hop_length 축소 (선택)

- 256 → 128 또는 64. 비용: 연산량 2x~4x.

### 1-2) 멀티해상도 로컬 리파인 (권장)

- 전체는 hop_length=256으로 onset 검출 후, 각 onset 주변 ±80ms만 hop_refine=64로 재계산해 피크 프레임으로 정제.  
*(engine.onset은 이미 `refine_onset_times()`로 동일 로직 적용.)*

---

## Phase 2: 서브프레임 기준점 추정

### 2-1) Parabolic interpolation

- peak 주변 3점 포물선 보간 → 프레임 소수 → ms 시점.

### 2-2) 로컬 파형/에너지 기반 미세 정렬 (선택)

- Onset 근처 band-limited envelope 또는 RMS 상승 구간(derivative peak)으로 onset 재정의.

---

## Phase 3: Energy/Clarity 정의를 "구간 안정형"으로 변경

### 3-1) Energy: "온셋 간 구간" 집계

- 구간 [mid(t_{i-1}, t_i), mid(t_i, t_{i+1})]에서 RMS·대역 에너지.  
*(engine.onset features/energy.py는 이미 해당 구간 사용.)*

### 3-2) Clarity: "로컬 최소 → 로컬 최대" 구간에서 10–90%

- peak 이전 직전 로컬 최소 ~ peak 구간만 잘라서 10%–90% 도달 시간 계산.

---

## Phase 4: 드럼 stem artefact 대응 (선택)

- HPSS, band 제한 envelope 등 검토.

---

## MVP 적용 순서 (권장)

1. Phase 0 전부 (노트북에서 아직 미적용인 부분만)
2. Phase 1-2 로컬 리파인 (노트북 기준; engine은 이미 적용)
3. Phase 3 (노트북 기준; engine energy는 이미 구간 안정형)
4. Phase 2-1, 1-1, 2-2, 4 — 필요 시

---

## 수정 시 주의사항

- 가변 윈도우 사용 시 겹침 조건을 이벤트별 left/right에 맞게 재정의.
- JSON export 시 정제된 onset_times 사용하면 웹 파이프라인과 호환 유지.
