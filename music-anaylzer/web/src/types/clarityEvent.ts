/**
 * 02_clarity (Onset Clarity) JSON — 이벤트별 어택 명확도 정보
 */
export interface ClarityEvent {
  t: number;
  strength: number;
  attack_time_ms: number;
  clarity_score: number;
}

export interface ClarityJsonMeta {
  source: string;
  sr: number;
  hop_length: number;
  bpm: number;
  total_events: number;
}

export interface ClarityJsonData {
  events: ClarityEvent[];
  meta: ClarityJsonMeta;
}
