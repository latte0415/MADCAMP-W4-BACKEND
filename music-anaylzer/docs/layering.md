# 레이어링 설계 (band 기반 이벤트×대역 역할 분해)

판단 단위는 **이벤트×대역(low/mid/high)**이며, "이벤트 분류"가 아니라 **이벤트 내부의 에너지·역할 분해**를 목표로 합니다.

---

## 0. 전제: 단위는 이벤트(타격) × 대역

Onset detection으로 타격 이벤트(시간 `t_i`)를 잡고, 각 이벤트마다 **대역별** 에너지와 역할을 부여합니다.

---

## 0.1 왜 “반복 집합 대비 상대성”인가

- **“튀는가?”**는 절대 에너지가 아니라 **같은 반복 안에서의 상대 에너지**다.
- 직전 이벤트만 비교하면, 같은 반복 그룹 안에서 1·3이 2·4보다 튀는 구조를 못 본다.
- 따라서 **비교 축**이 필요하다: **반복 집합(Local Repetition Group)**. 마디/박을 모르더라도, 비슷한 IOI로 반복되는 이벤트 묶음만 있으면 된다.

---

## 0.2 반복 집합 만드는 최소 규칙

**규칙**: IOI(inter-onset interval)가 거의 같은 **연속** 이벤트들을 하나의 반복 집합으로 묶는다.

- `ioi[i] = onset_times[i] - onset_times[i-1]`
- `median_ioi = median(ioi[1:])`, `tol = rel_tol * median_ioi` (예: rel_tol=0.2)
- `i >= 1`에서: `|ioi[i] - ioi[i-1]| <= tol` 이면 이벤트 `i`는 이벤트 `i-1`과 **같은 집합**; 아니면 **새 집합** 시작.
- **첫 이벤트(0)**: `ioi[0]` 없음 → 원래 혼자 그룹 0이면 `group_size=1`이라 P1 불가. 따라서 **예외**: `ioi[1]`이 있고 (`n≥3`일 때 `ioi[1]`과 `ioi[2]`가 유사하거나, `n=2`일 때) 이벤트 0을 이벤트 1과 같은 그룹에 넣어 **첫박도 P1 후보**가 되도록 함.

→ 마디/패턴 추정 없이 **순수 신호(onset 간격)** 만으로 반복 집합을 얻는다.

---

## 1. 역할 정의 (Role Definition) — P0/P1 독립 속성, 중복 허용

**P1 — Pattern Carrier (반복 집합 소속)**  
- **“이 이벤트가 반복 집합에 속하는가?”** → 속하면 해당 이벤트의 band evidence 전부 P1.
- 반복 집합 크기 ≥ 2인 구간에 있는 이벤트는 모두 P1 후보. (패턴 추정 없음.)

**P0 — Accent / Impact (반복 집합 내 상대 에너지)**  
- **“이 이벤트가 자기 반복 집합 대비 에너지가 튀는가?”**
- band별로, **같은 반복 집합 내** 에너지 분포에서 상위 quantile(예: 80%) 이상이면 P0.
- 절대값이 아니라 **집합 내 상대값**으로만 판단.

**P0 group-relative 의사코드**:
```
for each event i:
  g = group_id[i]
  in_g = (group_id == g)
  for each band b:
    E_b_in_group = energy[b][in_g]
    th = percentile(E_b_in_group, p0_quantile * 100)   // 예: 80%ile
    if energy[i][b] >= th:
      event i, band b → P0
```

**P2 — Nuance / Texture (뉘앙스)**  
- Band-level 조건: dependency gate, `E < P0*ratio`, `E > abs_floor`. P0 대역은 P2 아님.

(레거시: `use_repetition_group=False`일 때만 P0=argmax, P1=repeat_score 기반.)

---

## 2. 5개 지표 (구현 기준)

| 지표 | 모듈 | P0/P1/P2 사용 |
|------|------|----------------|
| Energy | `features/energy.py` | P0 argmax, P1 repeat_score, P2 조건(E &lt; P0*0.6, E &gt; abs_floor) |
| Temporal | `features/temporal.py` | P1 repeat_score에만 사용 |
| Dependency | `features/context.py` | P2 gate |
| Focus | `features/spectral.py` | (선택) P2 gate 보조 |
| Clarity | `features/clarity.py` | 이벤트 레벨, 필요 시 확장 |

---

## 3. 출력 구조

- 이벤트당 **역할 구성**: P0 대역 1개, P1 대역 0~N개(리스트, P0와 중복 가능), P2 대역 0~N개.  
- JSON: `events[].bands` = `[{ band, roles: ["P0","P1"], role(호환용) }, ...]`. **layer**는 시각화 호환용(deprecated).

---

## 4. 비율 보정 없음

- P0/P1/P2 비율을 목표로 두지 않음.

---

## 5. 핵심 문장

> **P0는 “얼마나 강한가”, P1은 “계속 반복되는가”다. 둘은 경쟁하지 않고 겹쳐도 된다.**
