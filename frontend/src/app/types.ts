import type { StreamsSectionsData } from './types/streamsSections';

export type ProjectMode = 'dance' | 'magic';
export type ProjectStatus = 'queued' | 'running' | 'done' | 'failed' | 'draft';

export interface MusicKeypoint {
  time: number;
  frequency: 'low' | 'mid' | 'high';
  intensity: number;
}

export interface MotionKeypoint {
  time: number;
  type: 'hit' | 'hold' | 'appear' | 'vanish';
  duration?: number; // for hold type
  intensity: number;
  frame?: number; // frame number for linking to PIXIE mesh
}

export interface BassNote {
  time: number;
  duration?: number;
  [key: string]: unknown;
}

export interface StemUrls {
  drums?: string;
  bass?: string;
  vocal?: string;
  other?: string;
  drumBands?: {
    low?: string;
    mid?: string;
    high?: string;
  };
}

export interface DrumKeypointByBandItem {
  time: number;
  score?: number;
  intensity?: number;
}

export interface TextureBlockItem {
  start: number;
  end: number;
  intensity?: number;
  density?: number;
}

export interface BassCurveV3Point {
  t: number;
  pitch: number;
  amp: number;
}

export interface BassAnalysisDetail {
  notes?: BassNote[];
  groove_curve?: [number, number][];
  bass_curve_v3?: BassCurveV3Point[];
}

export interface VocalCurvePoint {
  t: number;
  pitch: number;
  amp: number;
}

export interface VocalAnalysisDetail {
  vocal_curve?: VocalCurvePoint[];
  vocal_phrases?: { start: number; end: number }[];
  vocal_turns?: { t: number; direction?: string }[];
  vocal_onsets?: { t: number }[];
}

export interface OtherCurvePoint {
  t: number;
  density?: number;
  pitch?: number | null;
  amp?: number;
}

export interface OtherRegion {
  start: number;
  end: number;
  intensity?: number;
}

export interface OtherAnalysisDetail {
  other_curve?: OtherCurvePoint[];
  other_regions?: OtherRegion[];
  other_keypoints?: { t: number; score?: number }[];
}

export interface MusicAnalysisDetail {
  keypointsByBand?: Partial<Record<'low' | 'mid' | 'high', DrumKeypointByBandItem[]>>;
  textureBlocksByBand?: Partial<Record<'low' | 'mid' | 'high', TextureBlockItem[]>>;
  bass?: BassAnalysisDetail;
  vocal?: VocalAnalysisDetail;
  other?: OtherAnalysisDetail;
}

export interface PixieMeshInfo {
  s3_prefix: string;
  file_count: number;
}

export interface Project {
  id: string;
  title: string;
  mode: ProjectMode;
  videoUrl?: string;
  audioUrl?: string;
  thumbnailUrl?: string;
  duration: number;
  createdAt: Date;
  completedAt?: Date;
  musicKeypoints: MusicKeypoint[];
  motionKeypoints: MotionKeypoint[];
  bassNotes?: BassNote[];
  musicDetail?: MusicAnalysisDetail;
  streamsSectionsData?: StreamsSectionsData;
  stemUrls?: StemUrls;
  pixieMeshes?: Record<string, PixieMeshInfo>;
  status: ProjectStatus;
  errorMessage?: string;
  progress?: number;
  statusMessage?: string;
  statusLog?: string;
  uploadVideoProgress?: number;
  uploadAudioProgress?: number;
  motionProgress?: number;
  audioProgress?: number;
}
