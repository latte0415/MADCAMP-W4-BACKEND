/**
 * 04 Energy JSON — 이벤트별 상세 에너지 정보
 */
export interface EnergyEvent {
  t: number;
  strength: number;   // E_norm (0~1)
  texture: number;    // E_norm_high
  color: string;
  layer: string;      // 강함/중간/약함
  rms: number;
  e_norm: number;
  band_low: number;   // 20-150Hz
  band_mid: number;   // 150-2kHz
  band_high: number;  // 2k-10kHz
}

export interface EnergyJsonMeta {
  source: string;
  sr: number;
  duration_sec: number;
  energy_rms_min: number;
  energy_rms_max: number;
}

export interface EnergyJsonData {
  events: EnergyEvent[];
  meta: EnergyJsonMeta;
}
