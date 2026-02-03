/**
 * 05_context (맥락 의존성) JSON — 이벤트별 Local SNR 및 마스킹 정보
 */
export interface ContextEvent {
  index: number;
  time: number;
  frame: number;
  strength: number;
  snr_db: number;
  masking_low: number;
  masking_mid: number;
  masking_high: number;
  dependency_score: number;
}

export interface ContextJsonMeta {
  source: string;
  sr: number;
  duration_sec: number;
  hop_length: number;
  n_fft: number;
  bpm: number;
  event_win_sec: number;
  bg_win_sec: number;
  total_events: number;
}

export interface ContextJsonData {
  events: ContextEvent[];
  meta: ContextJsonMeta;
}
