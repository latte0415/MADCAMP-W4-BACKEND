/**
 * Drum Band Energy JSON — 대역별 추출된 onset에 대한 에너지 (막대그래프용)
 */
export interface DrumBandOnsetEvent {
  t: number;
  energy: number;
}

export interface DrumBandEnergyMeta {
  source: string;
  duration_sec: number;
  sr: number;
}

export interface DrumBandEnergyJsonData {
  bands: {
    low: DrumBandOnsetEvent[];
    mid: DrumBandOnsetEvent[];
    high: DrumBandOnsetEvent[];
  };
  meta: DrumBandEnergyMeta;
}
