from __future__ import annotations
"""
Engine 공용 설정: 정규화/스케일링 관련 기본값.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class NormalizationConfig:
    percentile_lo: float = 1.0
    percentile_hi: float = 99.0
    mad_scale: float = 1.4826
    z_clip: float = 6.0
    nan_fill: float = 0.5


DEFAULT_NORM_CONFIG = NormalizationConfig()
