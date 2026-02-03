# Dance + Magic Analysis Lab

## 개요
이 프로젝트는 **춤(Dance)**과 **마술(Magic)** 영상에서 핵심 이벤트(타임라인 마커)를 추출하고,
마커에 대응하는 포즈를 **3D 아바타(SMPL‑X) 메시**로 렌더링해 타임라인에서 확인할 수 있도록 합니다.

- **Dance 모드:** Hit/Hold 기반 모션 이벤트
- **Magic 모드:** Object vanish/appear 기반 이벤트 + (보조) strict hit/hold

## 현재 저장소 구조 안내
이 리포지토리는 상위에 **backend/**, **motion/**, **music-anaylzer/** 폴더가 있습니다.  
아래 문서의 기존 경로(`pipelines/`, `gpu/` 등)는 **motion/** 하위 경로를 기준으로 이해하면 됩니다.

## 폴더 구조
```
.
├─ demo/                     # 로컬 데모 UI + API
│  ├─ index.html
│  ├─ styles.css
│  ├─ app.js
│  ├─ api.py                 # FastAPI (로컬) + GPU 워커 연동
│  └─ server.py              # (구버전) Flask 서버
├─ pipelines/                # Dance 파이프라인 코드
│  ├─ motion_pipeline.py
│  ├─ segment_motion.py
│  ├─ visualize_motion.py
│  ├─ visualize_parts.py
│  ├─ export_segments.py
│  └─ extract_keyframes.py
├─ gpu/
│  ├─ sam3/                   # GPU 서버 전용 (마술 이벤트)
│  │  ├─ detect_object_events.py
│  │  ├─ extract_object_keyframes.py
│  │  ├─ merge_object_events.py
│  │  ├─ split_and_run.sh
│  │  └─ detect_object_events_hf.py  # (실험용)
│  └─ pixie/                  # GPU 서버 전용 (3D 메시)
│     ├─ PIXIE/               # PIXIE 원본
│     ├─ overlay_obj_on_keyframe.py
│     └─ overlay_obj_meshfill.py
├─ scripts/                   # 실행 스크립트
│  └─ run_pipeline.sh
├─ tools/                     # 디버그/실험용 유틸
│  ├─ overlay_video.py
│  ├─ overlay_events.py
│  ├─ overlay_obj_debug.py
│  ├─ bg_change_detect.py
│  └─ check_owlvit_input.py
├─ inputs/                    # 입력 영상
├─ outputs*/                  # 결과물 (자동 생성)
└─ weights/                   # 모델 가중치
```

## 각 코드 역할
### Dance 파이프라인 (`pipelines/`)
- `motion_pipeline.py` : MediaPipe Pose 기반 포즈 추출 + hit/hold 이벤트 계산
- `segment_motion.py` : 모션 시계열 기반 구간 분할
- `visualize_motion.py` : 모션 특징 시각화
- `extract_keyframes.py` : hit/hold 키프레임 추출
- `export_segments.py`, `visualize_parts.py` : 보조 유틸

### Magic 파이프라인 (`gpu/sam3/`)
- `detect_object_events.py` : SAM3 기반 object vanish/appear 검출
- `extract_object_keyframes.py` : vanish/appear 키프레임 추출
- `merge_object_events.py` : 분할 실행 결과 병합
- `split_and_run.sh` : 영상 분할 병렬 처리
- `detect_object_events_hf.py` : HF 기반 실험용 (현재 비권장)

### 3D 메시 (`gpu/pixie/`)
- `PIXIE/` : PIXIE 원본 코드
- `overlay_obj_on_keyframe.py` : wireframe 오버레이
- `overlay_obj_meshfill.py` : meshfill 오버레이

### 데모 (`demo/`)
- `api.py` : 로컬 FastAPI 서버. 마술 분석은 SSH로 GPU 서버에 위임.
- `index.html / app.js / styles.css` : 데모 UI

## 마커 추출 방법론 (자세히)
### 1) 춤 모드 (Hit/Hold)
1. **포즈 추출**
   - MediaPipe Pose로 프레임별 관절 좌표를 추출합니다.
   - 관절 좌표는 정규화/스무딩되어 시간축 시계열로 정리됩니다.
2. **모션 특징 계산**
   - 관절 이동량, 속도/가속도 기반 에너지를 계산합니다.
   - 노이즈를 줄이기 위해 시간축 smoothing과 최소 간격 제약을 둡니다.
3. **Hit 검출**
   - 에너지 피크(peak)를 찾고 임계값 이상 구간만 hit으로 채택합니다.
   - 연속 피크는 최소 간격으로 병합하거나 대표 피크만 남깁니다.
4. **Hold 검출**
   - 속도/에너지가 일정 이하인 구간을 hold로 분류합니다.
   - 최소 지속 시간, 구간 병합 규칙을 적용해 과도한 hold를 줄입니다.
5. **키프레임 추출**
   - hit은 단일 프레임, hold는 시작 프레임 기준으로 키프레임을 저장합니다.

### 2) 마술 모드 (Vanish/Appear)
1. **SAM3 기반 개념 추적**
   - 텍스트 프롬프트로 객체 개념을 정의합니다.
   - 대상 프레임은 `target_fps`로 다운샘플링해 처리합니다.
2. **트래킹 및 이벤트화**
   - 프레임별 탐지 결과를 IoU 기반으로 연결해 트랙을 구성합니다.
   - 일정 시간 동안 트랙이 등장하면 `appear`, 사라지면 `vanish` 이벤트를 기록합니다.
   - `min_hits`: 최소 연속 등장 프레임 수
   - `vanish_gap_s`: 사라짐 판정을 위한 시간 갭
3. **옵션: 인물 크롭**
   - MediaPipe Pose로 인물 ROI를 추정하고, 고정 크롭을 적용할 수 있습니다.
   - 작은 소품(공, 스카프 등) 탐지를 안정화하는 데 사용합니다.
4. **키프레임 추출**
   - appear/vanish 프레임을 별도 키프레임으로 저장합니다.

## 실행 방법 (자세히)
### 1) 로컬 데모 (FastAPI)
1. 로컬 의존성 설치
   ```bash
   pip install -r requirements-local.txt
   ```
2. 환경 변수 설정
   ```bash
   export DANCE_SSH_PASS='(서버 비밀번호)'
   ```
3. 서버 실행
   ```bash
   python demo/api.py
   ```
4. 브라우저 접속
   - `http://127.0.0.1:8000`

### 2) GPU 서버 의존성 설치
```bash
pip install -r requirements-gpu.txt
```

### 3) Dance 파이프라인 (로컬/서버 모두 가능)
```bash
bash scripts/run_pipeline.sh --video inputs/dance.mp4
```

### 4) Magic 파이프라인 (GPU 서버에서 실행)
```bash
python gpu/sam3/detect_object_events.py \
  --video inputs/magic.mp4 \
  --out_json outputs_magic/object_events.json \
  --out_video outputs_magic/object_events_overlay.mp4 \
  --model /opt/dance/weights/sam3.pt \
  --prompt "red small ball, red scarf" \
  --target_fps 5 \
  --conf 0.6 \
  --min_hits 3 \
  --vanish_gap_s 1.5 \
  --max_fraction 1.0 \
  --device cuda:0
```

### 5) Magic 키프레임 추출
```bash
python gpu/sam3/extract_object_keyframes.py \
  --video inputs/magic.mp4 \
  --json outputs_magic/object_events.json \
  --out_dir outputs_magic/object_keyframes
```

### 6) PIXIE 메시 생성
```bash
cd gpu/pixie/PIXIE
python demos/demo_fit_body.py \
  -i ../../outputs/keyframes/hit \
  -s ../../outputs/pixie_mesh/hit \
  --device cuda:0 \
  --iscrop True \
  --saveObj True \
  --saveVis False \
  --saveParam True \
  --savePred True \
  --saveImages False \
  --useTex False \
  --lightTex False \
  --extractTex False
```

### 환경 변수
- `DANCE_SSH_PASS` (필수)
- `DANCE_SSH_HOST` (기본 `172.10.5.177`)
- `DANCE_SSH_USER` (기본 `root`)
- `DANCE_REMOTE_ROOT` (기본 `/opt/dance`)
- `DANCE_REMOTE_VENV` (기본 `/opt/venvs/dance-gpu/bin/activate`)
- `DANCE_REMOTE_MODEL` (기본 `/opt/dance/weights/sam3.pt`)

## 주의사항
- `gpu/` 폴더는 GPU 서버에서만 실행하는 코드가 포함됩니다.
- `tools/` 폴더는 디버깅/실험용이며 프로덕션 파이프라인에는 사용되지 않습니다.
