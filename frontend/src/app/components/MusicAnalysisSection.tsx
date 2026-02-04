import { useRef, useEffect } from 'react';
import { MusicKeypoint } from '../types';
import type { BassNote } from '../types';

interface MusicAnalysisSectionProps {
  duration: number;
  currentTime: number;
  musicKeypoints: MusicKeypoint[];
  bassNotes?: BassNote[];
  onSeek?: (time: number) => void;
}

const BAND_LABELS = { low: 'LOW', mid: 'MID', high: 'HIGH' } as const;
const BAND_COLORS = { low: '#a3a3a3', mid: '#737373', high: '#525252' };
const BASS_COLOR = '#f59e0b';
const PIXELS_PER_SECOND = 80;

export function MusicAnalysisSection({
  duration,
  currentTime,
  musicKeypoints,
  bassNotes = [],
  onSeek,
}: MusicAnalysisSectionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  const setCanvasRef = (i: number) => (el: HTMLCanvasElement | null) => {
    canvasRefs.current[i] = el;
  };

  const timelineWidth = duration * PIXELS_PER_SECOND;

  useEffect(() => {
    if (duration <= 0) return;
    const bandKeys = ['low', 'mid', 'high'] as const;
    const height = 32;
    bandKeys.forEach((band, bandIndex) => {
      const canvas = canvasRefs.current[bandIndex];
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = timelineWidth * dpr;
      canvas.height = height * dpr;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, timelineWidth, height);
      const kps = musicKeypoints.filter((k) => k.frequency === band);
      ctx.fillStyle = BAND_COLORS[band];
      kps.forEach((kp) => {
        const x = (kp.time / duration) * timelineWidth;
        ctx.globalAlpha = 0.3 + kp.intensity * 0.5;
        ctx.fillRect(Math.max(0, x - 1), 0, 2, height);
        ctx.globalAlpha = 1;
      });
      const playheadX = (currentTime / duration) * timelineWidth;
      ctx.strokeStyle = '#fafafa';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();
    });

    const bassCanvas = canvasRefs.current[3];
    if (bassCanvas) {
      const dpr = window.devicePixelRatio || 1;
      bassCanvas.width = timelineWidth * dpr;
      bassCanvas.height = height * dpr;
      const ctx = bassCanvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, timelineWidth, height);
        ctx.fillStyle = BASS_COLOR;
        bassNotes.forEach((note) => {
          const x = (note.time / duration) * timelineWidth;
          const w = Math.max(2, ((note.duration ?? 0) / duration) * timelineWidth);
          ctx.globalAlpha = 0.6;
          ctx.fillRect(x, 0, w, height);
          ctx.globalAlpha = 1;
        });
        const playheadX = (currentTime / duration) * timelineWidth;
        ctx.strokeStyle = '#fafafa';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(playheadX, 0);
        ctx.lineTo(playheadX, height);
        ctx.stroke();
      }
    }
  }, [duration, currentTime, musicKeypoints, bassNotes, timelineWidth]);

  const handleCanvasClick = (index: number) => (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSeek || duration <= 0) return;
    const canvas = canvasRefs.current[index];
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = rect.width > 0 ? (x / rect.width) * duration : 0;
    onSeek(Math.max(0, Math.min(duration, time)));
  };

  if (duration <= 0) return null;

  const bandKeys = ['low', 'mid', 'high'] as const;

  return (
    <div ref={containerRef} className="flex flex-col gap-2 rounded border border-neutral-800 bg-neutral-950/80 p-4">
      <h4 className="text-sm font-semibold text-white">분석</h4>
      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-500">드럼</div>
        {bandKeys.map((band, i) => (
          <div key={band} className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-[10px] uppercase tracking-widest text-neutral-400">
              {BAND_LABELS[band]}
            </span>
            <div className="h-8 flex-1 overflow-x-auto overflow-y-hidden rounded border border-neutral-800 bg-neutral-950">
              <canvas
                ref={setCanvasRef(i)}
                className="cursor-pointer"
                style={{ width: timelineWidth, height: 32, display: 'block' }}
                onClick={handleCanvasClick(i)}
              />
            </div>
          </div>
        ))}
        <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-500 pt-1">베이스</div>
        <div className="flex items-center gap-2">
          <span className="w-10 shrink-0 text-[10px] uppercase tracking-widest text-neutral-400">
            —
          </span>
          <div className="h-8 flex-1 overflow-x-auto overflow-y-hidden rounded border border-neutral-800 bg-neutral-950">
            <canvas
              ref={setCanvasRef(3)}
              className="cursor-pointer"
              style={{ width: timelineWidth, height: 32, display: 'block' }}
              onClick={handleCanvasClick(3)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
