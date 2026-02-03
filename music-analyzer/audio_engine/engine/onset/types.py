"""
L1 Core: 도메인 데이터 계약.
OnsetContext, 이벤트/메타 타입 정의. 외부 라이브러리/경로 의존 없음.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import numpy as np


@dataclass(frozen=True)
class OnsetContext:
    """
    Onset 검출·정제 후의 공통 데이터. L2 pipeline이 생성하고 L3 feature 모듈에 전달.
    band_evidence: (선택) 이벤트별 대역 증거. evidence[i]["low"] = {"present": bool, "onset_strength": float, "dt": float} 또는 None.
    """
    y: np.ndarray
    sr: int
    duration: float
    onset_times: np.ndarray
    onset_frames: np.ndarray
    strengths: np.ndarray
    bpm: float
    onset_env: np.ndarray
    # Temporal 전용 (pipeline에서 include_temporal=True 시 채움)
    beats_dynamic: Optional[np.ndarray] = None
    tempo_dynamic: Optional[np.ndarray] = None
    grid_times: Optional[np.ndarray] = None
    grid_levels: Optional[np.ndarray] = None
    bpm_dynamic_used: bool = False
    # Anchor + band evidence: 이벤트는 anchor 기준 1개, 각 이벤트에 low/mid/high 증거 연결
    band_evidence: Optional[list[dict[str, Any]]] = None
    # Band별 onset 시퀀스 (스트림/섹션용). build_context_with_band_evidence에서만 채움.
    band_onset_times: Optional[dict[str, np.ndarray]] = None
    band_onset_strengths: Optional[dict[str, np.ndarray]] = None

    @property
    def n_events(self) -> int:
        return len(self.onset_times)
