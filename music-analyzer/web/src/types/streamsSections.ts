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
}
