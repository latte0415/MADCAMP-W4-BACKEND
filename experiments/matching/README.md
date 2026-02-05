# Matching Score Experiments

음악 이벤트(비트/온셋)와 동작 이벤트(hit/hold/appear/vanish)의 싱크 점수(0~100) 산출 실험용 코드.

## 목표
- 단일 점수(0~100) 산출
- 내부적으로 구간별 약한 싱크 구간 탐지

## 파일
- `match_score.py` : 핵심 점수 계산 함수와 간단 실행

## 실행
```bash
python experiments/matching/match_score.py --music_json path/to/music.json --motion_json path/to/motion.json
```

## 참고
- 아직 파라미터 튜닝 전 (sigma, tau, window_size 등)
- 결과는 stdout에 출력
