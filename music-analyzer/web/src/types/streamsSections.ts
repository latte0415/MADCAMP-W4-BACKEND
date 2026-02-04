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

/** 베이스 선(그루브) — 노트와 독립. 한 선 = 연속 sustain 구간. */
export interface BassLine {
  id: number;
  start: number;
  end: number;
  pitch_curve: [number, number | null][];
  energy_curve: number[];
  decay_ratio?: number;
}

/** 베이스 note (run_bass_v4 출력). pitch_center는 pyin 누락 구간에서 null. 선에 속한 노트는 pitch_curve/energy_curve 없음. */
export interface BassNote {
  start: number;
  end: number;
  duration: number;
  pitch_center: number | null;
  pitch_min?: number | null;
  pitch_max?: number | null;
  /** standalone 노트만 가짐. 선 소속 노트는 없음 */
  pitch_curve?: [number, number | null][];
  energy_curve?: number[];
  energy_peak: number;
  energy_mean?: number;
  attack_time?: number;
  decay_time?: number;
  /** 구간 끝 에너지/peak (0~1, 붓 decay) */
  decay_ratio?: number;
  simplified_curve?: [number, number | null][];
  /** 속한 선 id. standalone이면 null */
  line_id?: number | null;
  /** standalone | start | mid | end */
  role?: "standalone" | "start" | "mid" | "end";
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

/** 그루브 밀도 곡선: 점(onset) 집합의 흐름을 근사한 envelope. [t, value], value 0~1. */
export type GrooveCurvePoint = [number, number];

export interface BassData {
  notes: BassNote[];
  /** @deprecated 선 구현 제거. 밀도 곡선은 groove_curve 사용. */
  lines?: BassLine[];
  /** 점(onset) 밀도·에너지 흐름 곡선. 두께 = curve 값. */
  groove_curve?: GrooveCurvePoint[];
  render?: BassRenderHint;
  bass_curve_v3?: BassCurveV3Point[];
  bass_curve_v3_meta?: BassCurveV3Meta;
}

/** 보컬 연속 곡선 한 점 (시간–피치, 선 굵기=amp/centroid) */
export interface VocalCurvePoint {
  t: number;
  pitch: number;
  amp: number;
  centroid?: number;
}

/** 보컬 제스처 이벤트 (phrase_start / pitch_gesture / accent) */
export interface VocalKeypoint {
  t: number;
  type?: "phrase_start" | "pitch_gesture" | "accent" | "pitch_change" | "energy_change" | "phrase";
  score?: number;
  direction?: "up_to_down" | "down_to_up";
  delta_pitch?: number;
  strength?: number;
}

/** phrase 내부 제스처 */
export interface VocalGesture {
  t: number;
  type: "phrase_start" | "pitch_gesture" | "accent" | "onset";
  score?: number;
  direction?: "up_to_down" | "down_to_up";
  delta_pitch?: number;
  strength?: number;
}

/** 보컬 phrase 구간 (시작/끝 + 제스처 목록) */
export interface VocalPhrase {
  start: number;
  end: number;
  gestures: VocalGesture[];
}

/** phrase 없이 전체 구간 Turn 포인트 (20초당 2~4개) */
export interface VocalTurn {
  t: number;
  type: "turn";
  direction?: "up_to_down" | "down_to_up";
  delta_pitch?: number;
  score?: number;
}

/** vocal onset (activation peak, Turn과 별도로 얹는 용도) */
export interface VocalOnset {
  t: number;
  type: "onset";
  strength?: number;
  score?: number;
}

export interface VocalData {
  vocal_curve: VocalCurvePoint[];
  vocal_keypoints: VocalKeypoint[];
  vocal_phrases?: VocalPhrase[];
  vocal_turns?: VocalTurn[];
  vocal_onsets?: VocalOnset[];
  vocal_curve_meta?: { pitch_unit?: string; amp?: string; y_axis_hint?: string };
}

/** Other 곡선 한 점 (시간–멜로디/밀도) */
export interface OtherCurvePoint {
  t: number;
  density?: number;
  pitch?: number | null;
  amp?: number;
  voiced?: boolean;
}

/** Other 패드 영역 (반투명 밴드) */
export interface OtherRegion {
  start: number;
  end: number;
  intensity?: number;
  flux_mean?: number;
  pitch_mean?: number;
}

export interface OtherData {
  other_curve?: OtherCurvePoint[];
  other_keypoints?: { t: number; type?: string; score?: number }[];
  other_regions?: OtherRegion[];
  other_meta?: Record<string, unknown>;
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
  /** 보컬 곡선 + 제스처 키포인트 */
  vocal?: VocalData;
  /** other 스템: 곡선(밀도) + 영역(패드) */
  other?: OtherData;
}
