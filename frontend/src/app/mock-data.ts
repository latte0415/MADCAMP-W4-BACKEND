import { Project, MusicKeypoint, MotionKeypoint } from './types';

// Generate sample music keypoints
const generateMusicKeypoints = (duration: number): MusicKeypoint[] => {
  const keypoints: MusicKeypoint[] = [];
  const frequencies: Array<'low' | 'mid' | 'high'> = ['low', 'mid', 'high'];
  
  for (let i = 0; i < duration; i += 0.3) {
    frequencies.forEach(freq => {
      if (Math.random() > 0.6) {
        keypoints.push({
          time: i + Math.random() * 0.3,
          frequency: freq,
          intensity: 0.3 + Math.random() * 0.7,
        });
      }
    });
  }
  
  return keypoints.sort((a, b) => a.time - b.time);
};

// Generate sample motion keypoints
const generateMotionKeypoints = (duration: number): MotionKeypoint[] => {
  const keypoints: MotionKeypoint[] = [];
  
  for (let i = 0; i < duration; i += 0.5) {
    // Add hits
    if (Math.random() > 0.5) {
      keypoints.push({
        time: i + Math.random() * 0.5,
        type: 'hit',
        intensity: 0.5 + Math.random() * 0.5,
      });
    }
    
    // Add holds
    if (Math.random() > 0.7) {
      keypoints.push({
        time: i + Math.random() * 0.5,
        type: 'hold',
        duration: 0.5 + Math.random() * 2,
        intensity: 0.4 + Math.random() * 0.6,
      });
    }
  }
  
  return keypoints.sort((a, b) => a.time - b.time);
};

export const mockProjects: Project[] = [
  {
    id: '1',
    title: 'Contemporary Dance Performance',
    mode: 'dance',
    duration: 180,
    createdAt: new Date('2026-02-01'),
    completedAt: new Date('2026-02-02'),
    musicKeypoints: generateMusicKeypoints(180),
    motionKeypoints: generateMotionKeypoints(180),
    status: 'done',
  },
  {
    id: '2',
    title: 'Card Magic Routine',
    mode: 'magic',
    duration: 120,
    createdAt: new Date('2026-02-03'),
    completedAt: new Date('2026-02-03'),
    musicKeypoints: generateMusicKeypoints(120),
    motionKeypoints: generateMotionKeypoints(120),
    status: 'done',
  },
  {
    id: '3',
    title: 'Hip Hop Choreography',
    mode: 'dance',
    duration: 210,
    createdAt: new Date('2026-02-04'),
    musicKeypoints: generateMusicKeypoints(210),
    motionKeypoints: generateMotionKeypoints(210),
    status: 'running',
  },
];
