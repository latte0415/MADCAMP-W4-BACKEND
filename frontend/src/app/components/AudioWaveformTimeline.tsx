import { useRef, useEffect, useState } from 'react';

interface AudioWaveformTimelineProps {
  audioUrl?: string | null;
  duration: number;
  currentTime: number;
  onSeek: (time: number) => void;
}

const BAR_INTERVAL_SEC = 4;

export function AudioWaveformTimeline({
  audioUrl,
  duration,
  currentTime,
  onSeek,
}: AudioWaveformTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [waveformData, setWaveformData] = useState<Float32Array | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!audioUrl || duration <= 0) {
      setWaveformData(null);
      return;
    }
    let cancelled = false;
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    fetch(audioUrl)
      .then((res) => res.arrayBuffer())
      .then((buf) => ctx.decodeAudioData(buf))
      .then((buffer) => {
        if (cancelled) return;
        const ch = buffer.getChannelData(0);
        const step = Math.max(1, Math.floor(ch.length / (buffer.duration * 50)));
        const samples: number[] = [];
        for (let i = 0; i < ch.length; i += step) {
          samples.push(Math.abs(ch[i]));
        }
        setWaveformData(new Float32Array(samples));
      })
      .catch(() => setWaveformData(null));
    return () => {
      cancelled = true;
      ctx.close();
    };
  }, [audioUrl, duration]);

  const pixelsPerSecond = 80 * zoom;
  const timelineWidth = Math.max(duration * pixelsPerSecond, 400);
  const height = 80;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || duration <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = timelineWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${timelineWidth}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, timelineWidth, height);

    if (waveformData && waveformData.length > 0) {
      const centerY = height / 2;
      const step = timelineWidth / waveformData.length;
      ctx.fillStyle = '#2f2f2f';
      for (let i = 0; i < waveformData.length; i++) {
        const x = i * step;
        const v = waveformData[i];
        const barHeight = Math.max(2, v * centerY);
        ctx.fillRect(x, centerY - barHeight / 2, Math.max(1, step), barHeight);
      }
    }

    for (let t = 0; t <= duration; t += BAR_INTERVAL_SEC) {
      const x = (t / duration) * timelineWidth;
      ctx.strokeStyle = '#2f2f2f';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#606060';
      ctx.font = '10px -apple-system, system-ui, sans-serif';
      ctx.fillText(`${Math.floor(t)}s`, x + 2, 12);
    }

    const playheadX = (currentTime / duration) * timelineWidth;
    ctx.strokeStyle = '#fafafa';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();
  }, [duration, currentTime, waveformData, zoom, timelineWidth]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || duration <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = rect.width > 0 ? (x / rect.width) * duration : 0;
    onSeek(Math.max(0, Math.min(duration, time)));
  };

  if (!audioUrl) {
    return (
    <div className="rounded border border-neutral-800 bg-neutral-950/80 p-4 text-center text-sm text-neutral-500">
      음악을 업로드하면 파형이 표시됩니다.
    </div>
  );
}

  return (
    <div className="flex flex-col gap-2 rounded border border-neutral-800 bg-neutral-950/80 p-4">
      <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-500">
        음악 파형 (마디 구분: {BAR_INTERVAL_SEC}초 간격)
      </div>
      <div
        ref={containerRef}
        className="relative h-20 overflow-x-auto overflow-y-hidden rounded border border-neutral-800 bg-neutral-950"
      >
        <canvas
          ref={canvasRef}
          onClick={handleClick}
          className="cursor-pointer"
          style={{ minWidth: timelineWidth }}
        />
      </div>
    </div>
  );
}
