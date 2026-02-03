/**
 * 03_temporal (박자 기여도 / 반복성) JSON — 이벤트별 그리드 정렬 및 반복성 정보
 */
export interface TemporalEvent {
  index: number;
  time: number;
  frame: number;
  strength: number;
  grid_align_score: number;
  repetition_score: number;
  temporal_score: number;
  ioi_prev?: number;
  ioi_next?: number;
}

export interface TemporalJsonMeta {
  source: string;
  sr: number;
  duration_sec: number;
  hop_length: number;
  bpm: number;
  bpm_dynamic_used: boolean;
  total_events: number;
}

export interface TemporalJsonData {
  events: TemporalEvent[];
  meta: TemporalJsonMeta;
}
