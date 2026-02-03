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
}
