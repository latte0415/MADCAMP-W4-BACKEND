import { useEffect, useMemo, useRef, useState } from 'react';
import type { MusicKeypoint, BassNote } from '../types';

interface AudioDetailAnalysisSectionProps {
  audioUrl?: string | null;
  duration: number;
  currentTime: number;
  selectionStart: number;
  selectionDuration: number;
  musicKeypoints: MusicKeypoint[];
  bassNotes?: BassNote[];
  onSeek?: (time: number) => void;
}

type DrumBand = 'low' | 'mid' | 'high';

type DetailTab = 'drums' | 'bass' | 'vocal';

const BAR_SECONDS = 4;
const WAVEFORM_HEIGHT = 120;
const BASE_PX_PER_SEC = 120;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 4;

const STEM_COLORS: Record<DetailTab | DrumBand, string> = {
  drums: '#f59e0b',
  bass: '#10b981',
  vocal: '#f472b6',
  low: '#f59e0b',
  mid: '#fbbf24',
  high: '#fb7185',
};

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function AudioDetailAnalysisSection({
  audioUrl,
  duration,
  currentTime,
  selectionStart,
  selectionDuration,
  musicKeypoints,
  bassNotes = [],
  onSeek,
}: AudioDetailAnalysisSectionProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('drums');
  const [drumBand, setDrumBand] = useState<DrumBand>('low');
  const [zoom, setZoom] = useState(1);
  const [waveformData, setWaveformData] = useState<Float32Array | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const selectionEnd = selectionStart + selectionDuration;
  const viewDuration = Math.max(0.001, selectionDuration);
  const pxPerSec = BASE_PX_PER_SEC * zoom;
  const timelineWidth = Math.max(viewDuration * pxPerSec, 480);

  const drumEvents = useMemo(
    () => musicKeypoints.filter((kp) => kp.frequency === drumBand),
    [musicKeypoints, drumBand]
  );
  const vocalEvents = useMemo(
    () => musicKeypoints.filter((kp) => kp.frequency === 'high'),
    [musicKeypoints]
  );

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
        const step = Math.max(1, Math.floor(ch.length / (buffer.duration * 60)));
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || duration <= 0 || selectionDuration <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = timelineWidth * dpr;
    canvas.height = WAVEFORM_HEIGHT * dpr;
    canvas.style.width = `${timelineWidth}px`;
    canvas.style.height = `${WAVEFORM_HEIGHT}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, timelineWidth, WAVEFORM_HEIGHT);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, timelineWidth, WAVEFORM_HEIGHT);

    if (waveformData && waveformData.length > 0) {
      const samplesPerSec = waveformData.length / duration;
      const startIndex = clamp(Math.floor(selectionStart * samplesPerSec), 0, waveformData.length);
      const endIndex = clamp(Math.ceil(selectionEnd * samplesPerSec), 0, waveformData.length);
      const slice = waveformData.subarray(startIndex, endIndex);
      const centerY = WAVEFORM_HEIGHT / 2;
      const step = slice.length > 0 ? timelineWidth / slice.length : timelineWidth;
      ctx.fillStyle = '#2f2f2f';
      for (let i = 0; i < slice.length; i++) {
        const x = i * step;
        const v = slice[i] ?? 0;
        const barHeight = Math.max(2, v * centerY);
        ctx.fillRect(x, centerY - barHeight / 2, Math.max(1, step), barHeight);
      }
    }

    for (let t = selectionStart; t <= selectionEnd + 0.0001; t += BAR_SECONDS) {
      const x = ((t - selectionStart) / viewDuration) * timelineWidth;
      ctx.strokeStyle = '#1f1f1f';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, WAVEFORM_HEIGHT);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [duration, selectionStart, selectionEnd, selectionDuration, timelineWidth, viewDuration, waveformData]);

  const handleZoomIn = () => setZoom((prev) => clamp(prev * 1.35, MIN_ZOOM, MAX_ZOOM));
  const handleZoomOut = () => setZoom((prev) => clamp(prev / 1.35, MIN_ZOOM, MAX_ZOOM));

  const handleSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek || duration <= 0) return;
    const container = scrollRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const scrollLeft = container.scrollLeft;
    const x = e.clientX - rect.left + scrollLeft;
    const time = selectionStart + (x / timelineWidth) * viewDuration;
    onSeek(clamp(time, 0, duration));
  };

  if (selectionDuration <= 0 || duration <= 0) return null;

  const selectionBars = Math.max(1, Math.round(selectionDuration / BAR_SECONDS));
  const clampedTime = clamp(currentTime, selectionStart, selectionEnd);
  const xScale = (t: number) => ((t - selectionStart) / viewDuration) * timelineWidth;
  const playheadX = xScale(clampedTime);

  const renderOverlay = () => {
    const keypointRadius = (intensity?: number) => {
      const safe = clamp(intensity ?? 0.6, 0.1, 1);
      return 2 + safe * 10;
    };

    if (activeTab === 'bass') {
      return (
        <svg width={timelineWidth} height={WAVEFORM_HEIGHT} style={{ display: 'block' }}>
          {bassNotes
            .filter((note) => note.time >= selectionStart && note.time <= selectionEnd)
            .map((note, index) => {
              const x = xScale(note.time);
              const w = Math.max(4, ((note.duration ?? 0) / viewDuration) * timelineWidth);
              return (
                <rect
                  key={`bass-${index}`}
                  x={x}
                  y={WAVEFORM_HEIGHT * 0.55}
                  width={w}
                  height={WAVEFORM_HEIGHT * 0.25}
                  fill={STEM_COLORS.bass}
                  opacity={0.6}
                  rx={2}
                />
              );
            })}
          <line x1={playheadX} x2={playheadX} y1={0} y2={WAVEFORM_HEIGHT} stroke="#fafafa" strokeWidth={2} />
        </svg>
      );
    }

    const events = activeTab === 'drums' ? drumEvents : vocalEvents;
    const color = activeTab === 'drums' ? STEM_COLORS[drumBand] : STEM_COLORS.vocal;
    return (
      <svg width={timelineWidth} height={WAVEFORM_HEIGHT} style={{ display: 'block' }}>
        {events
          .filter((kp) => kp.time >= selectionStart && kp.time <= selectionEnd)
          .map((kp, index) => (
            <circle
              key={`kp-${kp.time}-${index}`}
              cx={xScale(kp.time)}
              cy={WAVEFORM_HEIGHT / 2}
              r={keypointRadius(kp.intensity)}
              fill={color}
              opacity={0.9}
            />
          ))}
        <line x1={playheadX} x2={playheadX} y1={0} y2={WAVEFORM_HEIGHT} stroke="#fafafa" strokeWidth={2} />
      </svg>
    );
  };

  return (
    <div className="rounded border border-neutral-800 bg-neutral-950/80 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-base font-semibold text-white">오디오 상세 분석</h3>
          <p className="text-[11px] text-neutral-500 mt-1 uppercase tracking-[0.25em]">
            Selected {selectionBars} Bars · {formatTime(selectionStart)} - {formatTime(selectionEnd)}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <span>{formatTime(clampedTime)}</span>
          <span className="text-neutral-600">/</span>
          <span>{formatTime(selectionEnd)}</span>
          <div className="ml-3 flex items-center gap-1">
            <button
              type="button"
              onClick={handleZoomOut}
              className="h-7 w-7 rounded border border-neutral-700 text-neutral-400 hover:border-neutral-500"
            >
              −
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              className="h-7 w-7 rounded border border-neutral-700 text-neutral-400 hover:border-neutral-500"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        {([
          { id: 'drums', label: '드럼 키포인트' },
          { id: 'bass', label: '베이스' },
          { id: 'vocal', label: '보컬' },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.2em] ${
              activeTab === tab.id
                ? 'border-neutral-200 text-neutral-100'
                : 'border-neutral-700 text-neutral-500 hover:border-neutral-500'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'drums' && (
        <div className="flex items-center justify-between text-xs text-neutral-400 uppercase tracking-[0.2em] mb-2">
          <span>드럼 대역</span>
          <div className="flex items-center gap-1">
            {(['low', 'mid', 'high'] as DrumBand[]).map((band) => (
              <button
                key={band}
                onClick={() => setDrumBand(band)}
                className={`px-2 py-1 rounded border text-[10px] ${
                  drumBand === band
                    ? 'border-amber-400/70 bg-amber-500/20 text-amber-200'
                    : 'border-neutral-700 text-neutral-500 hover:border-neutral-500'
                }`}
              >
                {band.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        onClick={handleSeekClick}
        className="relative h-[120px] overflow-x-auto overflow-y-hidden rounded border border-neutral-800 bg-neutral-950 cursor-pointer"
      >
        {audioUrl ? (
          <>
            <canvas ref={canvasRef} style={{ width: timelineWidth, height: WAVEFORM_HEIGHT, display: 'block' }} />
            <div className="absolute left-0 top-0" style={{ width: timelineWidth, height: WAVEFORM_HEIGHT }}>
              {renderOverlay()}
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-neutral-500">
            오디오가 필요합니다.
          </div>
        )}
      </div>
    </div>
  );
}
