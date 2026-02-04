import { useRef, useEffect, useState } from 'react';
import { MusicKeypoint, MotionKeypoint } from '../types';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from './ui/button';

interface TimelineProps {
  duration: number;
  currentTime: number;
  musicKeypoints: MusicKeypoint[];
  motionKeypoints: MotionKeypoint[];
  onSeek: (time: number) => void;
  onHoverTime?: (time: number | null) => void;
}

export function Timeline({
  duration,
  currentTime,
  musicKeypoints,
  motionKeypoints,
  onSeek,
  onHoverTime,
}: TimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);

  const pixelsPerSecond = 100 * zoom;
  const timelineWidth = duration * pixelsPerSecond;

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onHoverTime) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = rect.width > 0 ? (x / rect.width) * duration : 0;
    onHoverTime(Math.max(0, Math.min(duration, time)));
  };

  const handleCanvasMouseLeave = () => {
    onHoverTime?.(null);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = rect.width > 0 ? (x / rect.width) * duration : 0;
    onSeek(Math.max(0, Math.min(duration, time)));
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(prev => Math.max(0.5, Math.min(5, prev * delta)));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    
    canvas.width = timelineWidth * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${timelineWidth}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, timelineWidth, rect.height);

    const height = rect.height;
    const musicLayerHeight = height * 0.6;
    const motionLayerHeight = height * 0.4;

    // Draw time markers
    ctx.strokeStyle = '#3f3f46';
    ctx.lineWidth = 1;
    const secondInterval = Math.max(1, Math.floor(10 / zoom));
    for (let i = 0; i <= duration; i += secondInterval) {
      const x = (i / duration) * timelineWidth;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      // Time labels
      ctx.fillStyle = '#71717a';
      ctx.font = '11px -apple-system, system-ui, sans-serif';
      ctx.fillText(`${i}s`, x + 4, 14);
    }

    // Draw music keypoints (3 frequency layers)
    const frequencyColors = {
      low: '#ef4444',    // red
      mid: '#22c55e',    // green
      high: '#3b82f6',   // blue
    };

    const frequencyLayers = {
      low: 0,
      mid: musicLayerHeight / 3,
      high: (musicLayerHeight / 3) * 2,
    };

    musicKeypoints.forEach(kp => {
      const x = (kp.time / duration) * timelineWidth;
      const y = frequencyLayers[kp.frequency];
      const layerHeight = musicLayerHeight / 3;

      ctx.fillStyle = frequencyColors[kp.frequency];
      ctx.globalAlpha = 0.3 + kp.intensity * 0.5;
      
      // Draw vertical line for music keypoint
      ctx.fillRect(x - 1, y, 2, layerHeight);
      
      ctx.globalAlpha = 1;
    });

    // Draw motion keypoints
    const motionStartY = musicLayerHeight;

    motionKeypoints.forEach(kp => {
      const x = (kp.time / duration) * timelineWidth;

      if (kp.type === 'hit') {
        // Hit: full height bar
        const gradient = ctx.createLinearGradient(0, motionStartY, 0, height);
        gradient.addColorStop(0, '#a855f7');
        gradient.addColorStop(1, '#ec4899');
        
        ctx.fillStyle = gradient;
        ctx.globalAlpha = 0.4 + kp.intensity * 0.4;
        ctx.fillRect(x - 2, motionStartY, 4, motionLayerHeight);
        ctx.globalAlpha = 1;
      } else if (kp.type === 'hold' && kp.duration) {
        // Hold: thin line at top of motion layer
        const endX = ((kp.time + kp.duration) / duration) * timelineWidth;
        const holdY = motionStartY + 10;
        
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.5 + kp.intensity * 0.3;
        ctx.beginPath();
        ctx.moveTo(x, holdY);
        ctx.lineTo(endX, holdY);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
      } else if (kp.type === 'appear' || kp.type === 'vanish') {
        const color = kp.type === 'appear' ? '#34d399' : '#fb923c';
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.4 + kp.intensity * 0.4;
        ctx.fillRect(x - 2, motionStartY, 4, motionLayerHeight);
        ctx.globalAlpha = 1;
      }
    });

    // Draw playhead
    const playheadX = (currentTime / duration) * timelineWidth;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();

    // Playhead circle
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(playheadX, height / 2, 4, 0, Math.PI * 2);
    ctx.fill();

  }, [duration, currentTime, musicKeypoints, motionKeypoints, timelineWidth, zoom]);

  // Auto-scroll to keep playhead visible
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const playheadX = (currentTime / duration) * timelineWidth;
    const scrollLeft = container.scrollLeft;
    const containerWidth = container.clientWidth;

    if (playheadX < scrollLeft || playheadX > scrollLeft + containerWidth) {
      container.scrollLeft = playheadX - containerWidth / 2;
    }
  }, [currentTime, duration, timelineWidth]);

  return (
    <div className="flex flex-col gap-3 bg-zinc-900/50 rounded-lg border border-white/10 p-4">
      {/* Timeline header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Integrated Timeline</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            Music Keypoints (Low/Mid/High) + Motion (Hit/Hold)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setZoom(prev => Math.max(0.5, prev * 0.8))}
            className="bg-white/5 border-white/10 hover:bg-white/10"
          >
            <ZoomOut className="size-4" />
          </Button>
          <span className="text-xs text-zinc-400 min-w-12 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setZoom(prev => Math.min(5, prev * 1.2))}
            className="bg-white/5 border-white/10 hover:bg-white/10"
          >
            <ZoomIn className="size-4" />
          </Button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs">
        <div className="flex items-center gap-4">
          <span className="text-zinc-400">Music:</span>
          <div className="flex items-center gap-1.5">
            <div className="size-2 rounded-full bg-red-500" />
            <span className="text-zinc-500">Low</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="size-2 rounded-full bg-green-500" />
            <span className="text-zinc-500">Mid</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="size-2 rounded-full bg-blue-500" />
            <span className="text-zinc-500">High</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-zinc-400">Motion:</span>
          <div className="flex items-center gap-1.5">
            <div className="size-2 rounded-full bg-gradient-to-r from-purple-500 to-pink-500" />
            <span className="text-zinc-500">Hit</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-0.5 rounded-full bg-yellow-500" />
            <span className="text-zinc-500">Hold</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="size-2 rounded-full bg-emerald-400" />
            <span className="text-zinc-500">Appear</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="size-2 rounded-full bg-orange-400" />
            <span className="text-zinc-500">Vanish</span>
          </div>
        </div>
      </div>

      {/* Timeline canvas */}
      <div
        ref={containerRef}
        className="relative h-40 overflow-x-auto overflow-y-hidden bg-zinc-950 rounded border border-white/5"
        onWheel={handleWheel}
      >
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          onMouseMove={handleCanvasMouseMove}
          onMouseLeave={handleCanvasMouseLeave}
          className="cursor-pointer"
        />
      </div>
    </div>
  );
}
