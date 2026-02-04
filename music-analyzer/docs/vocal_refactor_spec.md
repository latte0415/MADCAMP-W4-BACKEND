# 보컬 분석/시각화 리팩터링 실행 명세 (Cursor 전달용)

## 1. 개요 (What & Why)

**목표**: 보컬을 리듬 포인트가 아닌 **연속 제스처(phrase + pitch gesture)**로 해석하고, 웹 시각화에서 **의미 단위만** 보이도록 리팩터링한다.

**핵심 전환**
- ❌ 프레임 기반 pitch 점 나열
- ✅ phrase 기반 곡선 + gesture 이벤트

**결과**: “점이 많은 그래프”가 아니라 **퍼포머가 따라갈 수 있는 흐름 가이드**를 제공한다.

---

## 2. 필수사항 (Must-have)

### 2.1 데이터 구조 (백엔드)

`vocal_phrases`를 보컬의 **유일한 1급 구조**로 사용한다.

```json
vocal_phrases: [
  {
    "start": number,
    "end": number,
    "gestures": [
      {
        "t": number,
        "type": "pitch_gesture" | "accent",
        "direction?": "up" | "down" | "up_to_down" | "down_to_up",
        "delta_pitch?": number,
        "strength?": number
      }
    ]
  }
]
```

- `vocal_keypoints`는 deprecated 처리하거나 `flatten(vocal_phrases[].gestures)`의 alias로만 유지.

### 2.2 Phrase Boundary 로직 (최우선)

Boundary 조건은 **OR 구조**여야 한다.

```text
(amp < AMP_LOW for >= T1)  OR  (activation < ACT_LOW for >= T2)
```

- **권장 초기값**: AMP_LOW 0.08~0.12, ACT_LOW 0.15~0.25, T1/T2 300~500ms
- **추가**: `phrase_duration >= PHRASE_MIN_LEN` (예: 1.2s)
- 트랙 시작(t0 ~ 첫 boundary)은 phrase_start 이벤트를 만들지 않는다.

### 2.3 Pitch Gesture 추출 (phrase 내부)

- raw `Δpitch/Δt` thresholding **금지**
- **필수 단계**:
  1. pitch smoothing (Savitzky–Golay / median, 50~100ms)
  2. phrase 내부에서 local extremum 탐색
  3. 의미 조건 필터링: |Δpitch| ≥ 1~2 semitone, 유지 시간 ≥ 최소 ms, phrase당 최대 N개 (권장 2~3)

### 2.4 Accent (선택, 보조)

- accent는 **핵심 이벤트 아님**. phrase 내부, local amp maximum, pitch gesture와 근접/동반 시에만 채택.
- 시각화는 가능하나 점수 계산/추천 로직에는 사용 금지.

### 2.5 웹 시각화

**시각 언어 분리**

| 요소          | 표현               |
| ------------- | ------------------ |
| phrase       | 반투명 영역 밴드   |
| pitch        | 선(polyline/path)  |
| pitch gesture| 소수의 점/마커     |
| accent       | 강조 마커 (옵션)   |

**필수 규칙**
- raw pitch 프레임 점 렌더링 금지
- pitch는 phrase 단위로 이어진 선만 렌더링
- raw 데이터는 디버그 모드에서만 토글로 제공 가능

---

## 3. 제약조건 (Constraints)

- **아키텍처**: drum / bass / other 파이프라인에 영향 없음. `export/run` 구조 변경 최소화. `vocal_phrases`는 기존 JSON에 **추가 필드**로만 존재.
- **성능**: 시각화용 pitch는 downsample 가능 (예: 10ms → 50~100ms). 분석 해상도와 시각화 해상도는 분리.
- **일관성**: 모든 시간 단위는 seconds (float). phrase/gesture는 항상 시간순 정렬.

---

## 4. 주의사항 (Pitfalls)

**❌ 하지 말 것**
- pitch 프레임을 점으로 그대로 그리기
- phrase 없이 gesture만 강조하기
- energy 변화만으로 의미 이벤트 생성
- phrase를 “완전 무음”으로만 정의

**⚠️ 특히 주의**
- phrase가 너무 길어지면 시각화가 망가짐
- gesture 개수 제한 없으면 이후 매칭 점수 설계 불가
- `vocal_keypoints`와 `vocal_phrases`를 동시에 진짜로 쓰면 혼란

---

## 5. 권장 작업 순서 (Execution Order)

1. **Phrase boundary 로직 안정화**: OR 조건, threshold 로그 추가
2. phrase 최소 길이 + (옵션) 최대 길이 가드
3. phrase 내부 pitch smoothing + extremum 기반 gesture
4. gesture 개수 제한 적용
5. raw pitch 렌더링 제거
6. phrase 단위 pitch polyline 시각화
7. gesture 마커 최소 표현
8. (선택) raw/debug 토글

---

## 6. 완료 기준 (Definition of Done)

- **20초 구간 기준**: phrase 수 6~10개 내외, pitch는 점이 아니라 선으로 보임, gesture는 “왜 찍혔는지 설명 가능한 수준”
- **퍼포머 관점**: “여기서 유지” / “여기서 전환”이 직관적으로 보임
