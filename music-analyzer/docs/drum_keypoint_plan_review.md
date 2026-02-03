# 드럼 키포인트 엔진 계획 — 구체 검토 (의존성·애매한 점·잠재 이슈)

이 문서는 `드럼_키포인트_엔진_구현` 계획을 구현 전에 검토한 내용을 정리한 것이다. 문제가 될 수 있는 부분과 애매한 점을 명시했다.

---

## 1. 에너지/클래리티를 band에 쓰는 방법 (구체)

**상황**
- `features/energy.py`의 `compute_energy(ctx)`는 **OnsetContext** 전체를 인자로 받는다 (y, onset_times, duration, n_events, onset_frames, bpm, onset_env 등 필수).
- `features/clarity.py`의 `compute_clarity(ctx)`도 OnsetContext의 y, onset_times, strengths, sr만 실제로 쓰지만, 시그니처는 ctx 하나뿐이다.
- OnsetContext는 단일 오디오(풀 믹스 또는 단일 파일) + librosa 파이프라인 결과를 전제로 하며, band별 wav + CNN band_onset_times와는 구조가 다르다.

**결론**  
OnsetContext를 band별로 억지로 만드는 것보다, **band 전용 헬퍼 함수**를 두는 편이 낫다.

- **에너지**: `(times, y, sr, duration)`만 있으면 된다. energy.py의 mid_prev~mid_next 구간 RMS + log + robust_norm 로직만 떼어와서, **인자 (times, y, sr, duration)를 받는 함수** 하나 추가  
  - 예: `compute_energy_scores_for_times(times, y, sr, duration)`  
  - 단일 band wav에서는 STFT/band_energy(low/mid/high 분해)가 불필요하므로 제외.
- **클래리티**: `(y, times, strengths, sr)`이 있으면 된다. clarity.py의 attack time + strength/safe_attack → clarity_score 로직을 **인자 (y, times, strengths, sr)를 받는 함수**로 분리  
  - 예: `compute_clarity_scores_for_times(y, times, strengths, sr)`  
  - 구현 위치: clarity.py 내부에 추가하거나, key_onset_selector에서만 쓰는 작은 유틸로 둘 수 있음.

이렇게 해야 KeyOnsetSelector가 band wav 경로만 받고, 내부에서 로드한 뒤 위 두 함수를 호출할 수 있다.

---

## 2. 1차 게이트 "상위 q%" 의미 (애매)

**계획 문구**: "energy_score 상위 q% 또는 log_rms 상위 q% (예: 70~85%ile)"

- **해석 1**: "threshold = 70~85 백분위" → energy **≥** 70th percentile인 onset만 유지 (즉 상위 30% 유지).
- **해석 2**: "상위 70~85% 구간" → 상위 15~30%만 유지.

**권장**: "센 타격만 남긴다"는 목표라면 **해석 1**이 맞다.  
구현 시 파라미터 이름을 `energy_percentile_threshold`(이 percentile 이상만 유지)로 두고, 기본값 70 정도로 두면 혼동을 줄일 수 있다.

---

## 3. Band wav 경로를 누가 넘기나

**상황**  
`compute_cnn_band_onsets_with_odf`는 내부에서 `stems_base_dir / stem_folder_name`과 `drum_low.wav` 등 경로를 만들지만, **경로 자체는 반환하지 않는다** (band_onsets, band_strengths, duration, sr만 반환).

**결론**  
11 스크립트에서 **동일 규칙**으로 경로를 한 번 더 만들고, KeyOnsetSelector(및 band energy 유틸)에 넘기는 방식이 좋다. CNN 파이프라인 시그니처는 건드리지 않는다.

```python
folder = Path(stems_base_dir) / STEM_FOLDER_NAME
band_audio_paths = {"low": folder / "drum_low.wav", "mid": folder / "drum_mid.wav", "high": folder / "drum_high.wav"}
keypoints_by_band = select_key_onsets_by_band(..., band_audio_paths=band_audio_paths, ...)
```

---

## 4. KeyOnsetSelector vs TextureBlockMerger 순서·중복

- 둘 다 **동일한** `band_onset_times` / `band_strengths`(merge·filter 이후)를 입력으로 쓴다.
- KeyOnsetSelector: "에너지 높은 것만" 걸러서 keypoints_by_band 생성.
- TextureBlockMerger: "연속 촘촘한 구간"을 burst로 묶어 texture_blocks_by_band 생성.

같은 onset이 **키포인트이면서 어떤 burst의 일부**일 수 있다(예: 스네어 한 방이 burst 시작점).  
**결론**: 두 출력은 **독립적으로 유지**하고, 시간축 겹침은 허용하는 것이 맞다. "개별 후속 onset 제거"는 **UX/표시**에서만 처리: 리스트로는 keypoints + texture_blocks를 그대로 두고, 화면에서는 텍스처 블록 구간 안의 개별 점을 숨기거나 블록 하나로 표시하면 된다.

---

## 5. TextureBlockMerger "burst" 정의 (구체)

**문구**: "연속 onset 간 IOI < burst_ioi_sec가 **K개 이상 지속**"

- **해석**: 연속 (K-1)개 IOI가 모두 < burst_ioi_sec이면, onset이 K개 이어지는 구간이 되므로 **최소 K개 onset**이 한 burst를 이룬다.
- **구현**: times를 정렬한 뒤 앞에서부터 스캔하며, `times[i+1] - times[i] < burst_ioi_sec`인 구간을 확장하고, 구간 길이(onset 개수) ≥ K이면 하나의 block으로 출력. 인접한 두 burst는 같은 burst_ioi_sec 경계에서 끊어지므로 별도 block이 됨.

---

## 6. min_sep_sec 값과 기존 merge와의 관계

- CNN 파이프라인 안에서 이미 `merge_close_band_onsets`가 호출된다 (low 30ms, mid 100ms, high 120ms).
- KeyOnsetSelector의 **2차 min_sep_sec**(예: 60~120ms)는 **"키포인트끼리"** 최소 간격을 주는 용도라서, 위 merge와 **역할이 다르다**.  
상수명은 `KEY_ONSET_MIN_SEP_SEC`처럼 구분하는 것이 좋다.

---

## 7. Clarity "3차(선택)" 시 band wav 로드

KeyOnsetSelector에서 clarity를 쓰려면 band별로 wav를 로드해야 한다. 에너지용으로 이미 band wav를 로드한다면, **같은 로드된 y**를 clarity 헬퍼에도 넘기면 된다(band당 한 번 로드).

**구현 순서 제안** (band별):  
1) wav 로드  
2) `compute_energy_scores_for_times(times, y, sr, duration)`  
3) (선택) `compute_clarity_scores_for_times(y, times, strengths, sr)`  
4) 1차·2차·3차 규칙 적용  

이렇게 하면 의존성이 명확하다.

---

## 8. 에너지 없이 ODF strength만 쓸 때

`band_audio_paths`를 넘기지 않으면 band_strengths(ODF)만으로 1차 게이트를 수행하도록 할 수 있다.  
이때는 "energy_score 상위 q%" 대신 **"strength 상위 q%"**로 통일하고, clarity는 스킵하거나 strength 기반으로 단순화하는 **fallback 규칙**을 하나 정해 두면 된다.

---

## 9. write_streams_sections_json 시그니처 확장

- **현재**: `write_streams_sections_json(path, source, sr, duration_sec, streams, sections, keypoints, project_root=None, events=None)`.
- **추가 인자**: `keypoints_by_band=None`, `texture_blocks_by_band=None`.  
  둘 다 None이면 기존 동작과 동일; 값이 있으면 `out["keypoints_by_band"]`, `out["texture_blocks_by_band"]`를 설정.  
기존 호출부(07, 11)에서 새 인자를 넘기지 않아도 동작하므로 **하위 호환**이 유지된다.
