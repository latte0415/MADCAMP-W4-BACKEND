export interface StreamItem {
  id: string;
  band: string;
  start: number;
  end: number;
  events: number[];
  median_ioi: number;
  ioi_std: number;
  density: number;
  strength_median: number;
  accents: number[];
}

export interface SectionItem {
  id: number;
  start: number;
  end: number;
  active_stream_ids: string[];
  summary: Record<string, number | string>;
}

export interface KeypointItem {
  time: number;
  type: string;
  section_id?: number;
  stream_id?: string;
  label?: string;
}

/** 대역별 핵심 타격 (KeyOnsetSelector 출력) */
export interface KeypointByBandItem {
  time: number;
  score: number;
}

/** 대역별 텍스처 블록 (TextureBlockMerger 출력) */
export interface TextureBlockItem {
  start: number;
  end: number;
  representative_time: number;
  intensity: number;
  density: number;
  count: number;
}

/** 베이스 note (run_bass_v4 출력). pitch_center는 pyin 누락 구간에서 null. */
export interface BassNote {
  start: number;
  end: number;
  duration: number;
  pitch_center: number | null;
  pitch_min?: number | null;
  pitch_max?: number | null;
  pitch_curve: [number, number | null][];
  energy_curve?: number[];
  energy_peak: number;
  energy_mean?: number;
  attack_time?: number;
  decay_time?: number;
  simplified_curve?: [number, number | null][];
  /** Dual Onset Track: superflux 구간 평균 */
  superflux_mean?: number;
  /** Dual Onset Track: superflux 구간 분산 */
  superflux_var?: number;
  /** 시각화 모드: "point" | "line" */
  render_type?: "point" | "line";
  /** 0~1 그루브 신뢰도 */
  groove_confidence?: number;
  /** 연속 선 노트 그룹 ID */
  groove_group?: number;
  /** pitch_curve와 동일 타임스탬프의 superflux 값 (선 굵기/alpha용) */
  superflux_curve?: number[];
}

export interface BassRenderHint {
  y_axis?: string;
  thickness?: string;
  curve?: string;
}

/** v3 연속 곡선 한 점 */
export interface BassCurveV3Point {
  t: number;
  pitch: number;
  amp: number;
}

/** v3 메타 */
export interface BassCurveV3Meta {
  pitch_unit?: string;
  amp?: string;
}

export interface BassData {
  notes: BassNote[];
  render?: BassRenderHint;
  bass_curve_v3?: BassCurveV3Point[];
  bass_curve_v3_meta?: BassCurveV3Meta;
}

import type { EventPoint } from "./event";

export interface StreamsSectionsData {
  source: string;
  sr: number;
  duration_sec: number;
  streams: StreamItem[];
  sections: SectionItem[];
  keypoints: KeypointItem[];
  /** 정밀도 기반 P0/P1/P2 이벤트(roles 포함). 레이어 표시용 */
  events?: EventPoint[];
  /** 드럼 대역별 핵심 타격 (11 확장) */
  keypoints_by_band?: Record<string, KeypointByBandItem[]>;
  /** 드럼 mid/high 텍스처 블록 (11 확장) */
  texture_blocks_by_band?: Record<string, TextureBlockItem[]>;
  /** [LEGACY] 베이스 스템 분석 결과 (notes). 새 계획 후 교체 예정 */
  bass?: BassData;
}
