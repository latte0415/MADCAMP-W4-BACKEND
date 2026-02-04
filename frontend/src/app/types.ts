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
  status: ProjectStatus;
}
