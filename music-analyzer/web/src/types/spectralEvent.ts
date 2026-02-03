/**
 * 04_spectral (주파수 집중도) JSON — 이벤트별 스펙트럴 특성
 */
export interface SpectralEvent {
  index: number;
  time: number;
  frame: number;
  strength: number;
  spectral_centroid_hz: number | null;
  spectral_bandwidth_hz: number | null;
  spectral_flatness: number | null;
  focus_score: number;
}

export interface SpectralJsonMeta {
  source: string;
  sr: number;
  duration_sec: number;
  hop_length: number;
  n_fft: number;
  bpm: number;
  total_events: number;
}

export interface SpectralJsonData {
  events: SpectralEvent[];
  meta: SpectralJsonMeta;
}
