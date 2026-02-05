import { useMemo } from 'react';
import { motion } from 'motion/react';
import { MusicKeypoint, MotionKeypoint } from '../types';

interface ScorePanelProps {
  musicKeypoints: MusicKeypoint[];
  motionKeypoints: MotionKeypoint[];
  selectionStart: number;
  selectionDuration: number;
  audioClipStart: number;
  audioClipOffset: number;
  audioClipDuration: number;
  hasAudioClip: boolean;
}

interface Event {
  t: number;
  weight: number;
  kind: string;
}

const DEFAULT_WEIGHTS = {
  music_low: 0.6,
  music_mid: 0.8,
  music_high: 1.0,
  hit: 1.0,
  hold: 0.7,
  appear: 0.8,
  vanish: 0.8,
};

function gaussianScore(dt: number, sigma: number): number {
  return Math.exp(-(dt * dt) / (2 * sigma * sigma));
}

function loadMusicEvents(keypoints: MusicKeypoint[], clipStart: number, clipOffset: number): Event[] {
  const events: Event[] = [];
  for (const kp of keypoints) {
    const band = kp.frequency || 'mid';
    const weight = DEFAULT_WEIGHTS[`music_${band}` as keyof typeof DEFAULT_WEIGHTS] || 0.8;
    // Adjust time: music keypoint time is relative to audio, map to video timeline
    const adjustedTime = kp.time - clipOffset + clipStart;
    events.push({ t: adjustedTime, weight, kind: `music_${band}` });
  }
  return events.sort((a, b) => a.t - b.t);
}

function loadMotionEvents(keypoints: MotionKeypoint[]): Event[] {
  const events: Event[] = [];
  for (const kp of keypoints) {
    const weight = DEFAULT_WEIGHTS[kp.type as keyof typeof DEFAULT_WEIGHTS] || 0.7;
    events.push({ t: kp.time, weight, kind: kp.type });
  }
  return events.sort((a, b) => a.t - b.t);
}

function nearestMatchScore(
  music: Event[],
  motion: Event[],
  sigma: number,
  tau: number
): { base: number; scores: number[] } {
  if (!music.length || !motion.length) {
    return { base: 0, scores: [] };
  }

  const scores: number[] = [];
  for (const m of music) {
    let bestDt = Infinity;
    for (const d of motion) {
      const dt = Math.abs(m.t - d.t);
      if (dt < bestDt) bestDt = dt;
    }
    if (bestDt > tau) {
      scores.push(0);
    } else {
      scores.push(m.weight * gaussianScore(bestDt, sigma));
    }
  }
  const totalWeight = music.reduce((sum, m) => sum + m.weight, 0);
  const base = scores.reduce((sum, s) => sum + s, 0) / Math.max(1, totalWeight);
  return { base, scores };
}

function windowScores(
  music: Event[],
  motion: Event[],
  sigma: number,
  tau: number,
  windowSize: number,
  step: number
): { t: number; score: number }[] {
  if (!music.length) return [];

  const start = Math.min(...music.map(e => e.t));
  const end = Math.max(...music.map(e => e.t));
  const out: { t: number; score: number }[] = [];

  for (let t = start; t <= end; t += step) {
    const musicW = music.filter(e => e.t >= t && e.t < t + windowSize);
    const motionW = motion.filter(e => e.t >= t && e.t < t + windowSize);
    const { base } = nearestMatchScore(musicW, motionW, sigma, tau);
    out.push({ t, score: base });
  }
  return out;
}

function calculateFinalScore(
  music: Event[],
  motion: Event[],
  sigma = 0.1,
  tau = 0.22,
  windowSize = 6.0,
  step = 3.0,
  penaltyWeight = 0.3
): { score: number; base: number; penalty: number; weakWindows: { t: number; score: number }[] } {
  const { base } = nearestMatchScore(music, motion, sigma, tau);
  const windows = windowScores(music, motion, sigma, tau, windowSize, step);

  let penalty = 0;
  let weakWindows: { t: number; score: number }[] = [];

  if (windows.length > 0) {
    const sorted = [...windows].sort((a, b) => a.score - b.score);
    weakWindows = sorted.slice(0, 2);
    penalty = weakWindows.reduce((sum, w) => sum + w.score, 0) / weakWindows.length;
  }

  const raw = Math.max(0, base - penaltyWeight * penalty);
  const score = Math.round(raw * 100);

  return { score, base, penalty, weakWindows };
}

export function ScorePanel({
  musicKeypoints,
  motionKeypoints,
  selectionStart,
  selectionDuration,
  audioClipStart,
  audioClipOffset,
  audioClipDuration,
  hasAudioClip,
}: ScorePanelProps) {
  const scoreData = useMemo(() => {
    if (!hasAudioClip || musicKeypoints.length === 0 || motionKeypoints.length === 0) {
      return null;
    }

    const selectionEnd = selectionStart + selectionDuration;

    // Filter music keypoints within selection (adjusted for clip position)
    const musicEvents = loadMusicEvents(musicKeypoints, audioClipStart, audioClipOffset)
      .filter(e => e.t >= selectionStart && e.t < selectionEnd);

    // Filter motion keypoints within selection
    const motionEvents = loadMotionEvents(motionKeypoints)
      .filter(e => e.t >= selectionStart && e.t < selectionEnd);

    if (musicEvents.length === 0 || motionEvents.length === 0) {
      return null;
    }

    return {
      ...calculateFinalScore(musicEvents, motionEvents),
      musicCount: musicEvents.length,
      motionCount: motionEvents.length,
    };
  }, [musicKeypoints, motionKeypoints, selectionStart, selectionDuration, audioClipStart, audioClipOffset, hasAudioClip]);

  if (!scoreData) {
    return (
      <div className="rounded border border-neutral-800 bg-neutral-950/80 p-5">
        <h3 className="text-base font-semibold text-white mb-2">매칭 스코어</h3>
        <p className="text-sm text-neutral-500">
          {!hasAudioClip
            ? '오디오 클립을 배치하면 점수를 계산합니다.'
            : musicKeypoints.length === 0
              ? '음악 키포인트가 없습니다.'
              : motionKeypoints.length === 0
                ? '모션 키포인트가 없습니다.'
                : '선택 구간에 데이터가 부족합니다.'}
        </p>
      </div>
    );
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return '#22c55e'; // green
    if (score >= 60) return '#eab308'; // yellow
    if (score >= 40) return '#f97316'; // orange
    return '#ef4444'; // red
  };

  const scoreColor = getScoreColor(scoreData.score);

  return (
    <div className="rounded border border-neutral-800 bg-neutral-950/80 p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-white">매칭 스코어</h3>
          <p className="text-[11px] text-neutral-500 mt-1 uppercase tracking-[0.25em]">
            Motion-Music Alignment
          </p>
        </div>
        <motion.div
          className="text-4xl font-bold"
          style={{ color: scoreColor }}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          key={scoreData.score}
        >
          {scoreData.score}
        </motion.div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="rounded bg-neutral-900/60 p-3">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Base Score</div>
          <div className="text-lg font-semibold text-white">{(scoreData.base * 100).toFixed(1)}</div>
        </div>
        <div className="rounded bg-neutral-900/60 p-3">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Penalty</div>
          <div className="text-lg font-semibold text-red-400">-{(scoreData.penalty * 30).toFixed(1)}</div>
        </div>
      </div>

      <div className="space-y-2 text-xs text-neutral-400">
        <div className="flex justify-between">
          <span>음악 이벤트</span>
          <span className="text-neutral-300">{scoreData.musicCount}개</span>
        </div>
        <div className="flex justify-between">
          <span>모션 이벤트</span>
          <span className="text-neutral-300">{scoreData.motionCount}개</span>
        </div>
        {scoreData.weakWindows.length > 0 && (
          <div className="pt-2 border-t border-neutral-800">
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">약한 구간</div>
            {scoreData.weakWindows.map((w, i) => (
              <div key={i} className="flex justify-between text-neutral-500">
                <span>{w.t.toFixed(1)}s</span>
                <span className="text-red-400">{(w.score * 100).toFixed(1)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-neutral-800">
        <div className="text-[10px] text-neutral-600">
          σ=0.1s, τ=0.22s, window=6s, penalty=30%
        </div>
      </div>
    </div>
  );
}
