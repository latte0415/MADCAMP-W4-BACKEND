import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { MotionKeypoint } from '../types';
import { Button } from './ui/button';
import { MeshPreview } from './MeshPreview';
import { getMeshUrl } from '../api';
import {
  ZoomIn,
  ZoomOut,
  Music2,
  Clapperboard,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

type DrumBand = 'all' | 'low' | 'mid' | 'high';

interface MainTimelineSectionProps {
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  videoKeypoints: MotionKeypoint[];
  videoUrl?: string | null;
  audioUrl?: string | null;
  audioDuration?: number;
  audioAvailable: boolean;
  audioSourceLabel?: string;
  hasAudioClip: boolean;
  onPlaceAudioClip: () => void;
  audioClipStart: number;
  audioClipOffset: number;
  audioClipDuration: number;
  onAudioClipDurationChange: (duration: number) => void;
  onAudioClipOffsetChange: (offset: number) => void;
  onAudioClipChange: (start: number) => void;
  selectionStart: number;
  selectionDuration: number;
  selectionBars: number;
  onSelectionBarsChange: (bars: number) => void;
  onSelectionStart: (start: number) => void;
  onHoverTime?: (time: number | null) => void;
  loading?: boolean;
  controlsDisabled?: boolean;
  // Drum band selection
  drumBand?: DrumBand;
  onDrumBandChange?: (band: DrumBand) => void;
  drumBandUrls?: { low?: string; mid?: string; high?: string };
  // Mesh preview
  projectId?: string | number;
  hasMeshes?: boolean;
}

const KEYPOINT_COLORS: Record<MotionKeypoint['type'], string> = {
  hit: '#f59e0b',
  hold: '#f59e0b',
  appear: '#84cc16',
  vanish: '#fb923c',
};

const BAR_SECONDS = 4;
const BAR_OPTIONS = [2, 4, 8, 16];
const TRACK_HEADER_WIDTH = 160;
const RULER_HEIGHT = 28;
const ROW_HEIGHT = 48;
const ROW_GAP = 10;
const VIDEO_BAR_HEIGHT = 32;
const AUDIO_BAR_HEIGHT = 36;
const SELECTION_BAR_HEIGHT = 30;

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export function MainTimelineSection({
  duration,
  currentTime,
  isPlaying,
  onPlayPause,
  onSeek,
  videoKeypoints,
  videoUrl,
  audioUrl,
  audioDuration,
  audioAvailable,
  audioSourceLabel,
  hasAudioClip,
  onPlaceAudioClip,
  audioClipStart,
  audioClipOffset,
  audioClipDuration,
  onAudioClipDurationChange,
  onAudioClipOffsetChange,
  onAudioClipChange,
  selectionStart,
  selectionDuration,
  selectionBars,
  onSelectionBarsChange,
  onSelectionStart,
  onHoverTime,
  loading = false,
  controlsDisabled = false,
  drumBand = 'all',
  onDrumBandChange,
  drumBandUrls,
  projectId,
  hasMeshes = false,
}: MainTimelineSectionProps) {
  const zoomLevels = [1, 1.5, 3, 6, 12];
  const [zoomIndex, setZoomIndex] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [videoWaveform, setVideoWaveform] = useState<Float32Array | null>(null);
  const [audioWaveform, setAudioWaveform] = useState<Float32Array | null>(null);
  const [audioWaveDuration, setAudioWaveDuration] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoWaveCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioWaveCanvasRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const currentTimeRef = useRef(currentTime);
  const smoothTimeRef = useRef(currentTime);
  const lastFrameRef = useRef<number | null>(null);
  const clipDragRef = useRef<{ startX: number; startTime: number } | null>(null);
  const clipResizeRef = useRef<{ startX: number; startTime: number; startDuration: number; side: 'start' | 'end' } | null>(null);
  const selectionDragRef = useRef<{ startX: number; startTime: number } | null>(null);

  // Mesh preview state
  const [hoveredKeypoint, setHoveredKeypoint] = useState<{ kp: MotionKeypoint; x: number; y: number } | null>(null);
  const [meshUrl, setMeshUrl] = useState<string | null>(null);
  const meshFetchRef = useRef<number>(0);

  const loadWaveform = (
    url: string | null | undefined,
    setTarget: (data: Float32Array | null) => void,
    setDuration?: (duration: number) => void
  ) => {
    if (!url) {
      setTarget(null);
      setDuration?.(0);
      return () => {};
    }
    let cancelled = false;
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    fetch(url)
      .then((res) => res.arrayBuffer())
      .then((buf) => ctx.decodeAudioData(buf))
      .then((buffer) => {
        if (cancelled) return;
        setDuration?.(Number.isFinite(buffer.duration) ? buffer.duration : 0);
        const ch = buffer.getChannelData(0);
        const sampleCount = Math.max(200, Math.floor(buffer.duration * 80));
        const step = Math.max(1, Math.floor(ch.length / sampleCount));
        const samples: number[] = [];
        for (let i = 0; i < ch.length; i += step) {
          samples.push(Math.abs(ch[i]));
        }
        setTarget(new Float32Array(samples));
      })
      .catch(() => {
        setTarget(null);
        setDuration?.(0);
      });
    return () => {
      cancelled = true;
      ctx.close();
    };
  };

  useEffect(() => loadWaveform(videoUrl, setVideoWaveform), [videoUrl]);
  useEffect(() => loadWaveform(audioUrl, setAudioWaveform, setAudioWaveDuration), [audioUrl]);

  // Fetch mesh URL when hovering keypoint
  useEffect(() => {
    if (!hoveredKeypoint || !projectId || hoveredKeypoint.kp.frame == null) {
      setMeshUrl(null);
      return;
    }
    const fetchId = ++meshFetchRef.current;
    const { kp } = hoveredKeypoint;
    getMeshUrl(projectId, kp.type, kp.frame).then((url) => {
      if (fetchId === meshFetchRef.current) {
        setMeshUrl(url);
      }
    });
  }, [hoveredKeypoint, projectId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => setViewportWidth(container.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const zoom = zoomLevels[zoomIndex] ?? 1;
  const isReady = duration > 0 && viewportWidth > 0;
  const basePixelsPerSecond = isReady ? viewportWidth / duration : 0;
  const pixelsPerSecond = basePixelsPerSecond * zoom;
  const rawWidth = duration * pixelsPerSecond;
  const timelineWidth =
    isReady && zoom === 1 ? viewportWidth : isReady ? Math.max(rawWidth, viewportWidth) : 0;
  const maxClipStart = Math.max(0, duration - audioClipDuration);
  const maxSelectionStart = Math.max(0, duration - selectionDuration);
  const selectionEnd = selectionStart + selectionDuration;
  const currentBarsIndex = Math.max(0, BAR_OPTIONS.indexOf(selectionBars));

  useEffect(() => {
    const drawWave = (
      canvas: HTMLCanvasElement | null,
      data: Float32Array | null,
      height: number,
      color: string
    ) => {
      if (!canvas || !isReady || !data) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = timelineWidth * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${timelineWidth}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, timelineWidth, height);
      const centerY = height / 2;
      const step = timelineWidth / data.length;
      ctx.fillStyle = color;
      for (let i = 0; i < data.length; i++) {
        const x = i * step;
        const v = data[i];
        const barHeight = Math.max(2, v * centerY);
        ctx.globalAlpha = 0.5;
        ctx.fillRect(x, centerY - barHeight / 2, Math.max(1, step), barHeight);
      }
      ctx.globalAlpha = 1;
    };

    drawWave(videoWaveCanvasRef.current, videoWaveform, ROW_HEIGHT, 'rgba(56, 189, 248, 0.35)');
    if (audioWaveCanvasRef.current && audioWaveform && hasAudioClip) {
      const canvas = audioWaveCanvasRef.current;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = timelineWidth * dpr;
      canvas.height = ROW_HEIGHT * dpr;
      canvas.style.width = `${timelineWidth}px`;
      canvas.style.height = `${ROW_HEIGHT}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, timelineWidth, ROW_HEIGHT);
      const centerY = ROW_HEIGHT / 2;
      const clipWidth = Math.max(1, audioClipDuration * pixelsPerSecond);
      const clipX = audioClipStart * pixelsPerSecond;
      const totalSamples = audioWaveform.length;
      const audioBaseDuration = Math.max(
        0.001,
        audioWaveDuration > 0 ? audioWaveDuration : (audioDuration ?? duration)
      );
      const samplesPerSecond = totalSamples / audioBaseDuration;
      const startIndex = Math.max(0, Math.floor(audioClipOffset * samplesPerSecond));
      const endIndex = Math.min(totalSamples, Math.ceil((audioClipOffset + audioClipDuration) * samplesPerSecond));
      const slice = audioWaveform.subarray(startIndex, endIndex);
      const step = clipWidth / Math.max(1, slice.length);
      ctx.fillStyle = 'rgba(16, 185, 129, 0.35)';
      for (let i = 0; i < slice.length; i++) {
        const x = clipX + i * step;
        const v = slice[i];
        const barHeight = Math.max(2, v * centerY);
        ctx.globalAlpha = 0.5;
        ctx.fillRect(x, centerY - barHeight / 2, Math.max(1, step), barHeight);
      }
      ctx.globalAlpha = 1;
    }
  }, [
    isReady,
    timelineWidth,
    videoWaveform,
    audioWaveform,
    hasAudioClip,
    audioClipStart,
    audioClipDuration,
    audioClipOffset,
    audioWaveDuration,
    audioDuration,
    pixelsPerSecond,
    duration,
  ]);

  useEffect(() => {
    if (audioClipStart > maxClipStart) onAudioClipChange(maxClipStart);
  }, [audioClipStart, maxClipStart, onAudioClipChange]);

  useEffect(() => {
    if (selectionStart > maxSelectionStart) onSelectionStart(maxSelectionStart);
  }, [selectionStart, maxSelectionStart, onSelectionStart]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || duration <= 0) return;
    const playheadX = (currentTime / duration) * timelineWidth;
    const visibleStart = container.scrollLeft;
    const visibleEnd = visibleStart + container.clientWidth;
    if (playheadX < visibleStart || playheadX > visibleEnd) {
      container.scrollLeft = Math.max(0, playheadX - container.clientWidth / 2);
    }
  }, [currentTime, duration, timelineWidth]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    let rafId: number | null = null;
    const tick = () => {
      const now = performance.now();
      const last = lastFrameRef.current ?? now;
      const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
      lastFrameRef.current = now;
      const target = Math.max(0, Math.min(duration, currentTimeRef.current));
      const prev = smoothTimeRef.current;
      const alpha = 1 - Math.exp(-dt * 28);
      const next = prev + (target - prev) * alpha;
      smoothTimeRef.current = Number.isFinite(next) ? next : target;
      const x = duration > 0 ? (smoothTimeRef.current / duration) * timelineWidth : 0;
      if (playheadRef.current) {
        playheadRef.current.style.transform = `translate3d(${x}px, 0, 0)`;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [duration, timelineWidth]);

  useEffect(() => {
    if (zoomIndex !== 0) return;
    const container = containerRef.current;
    if (container) container.scrollLeft = 0;
  }, [zoomIndex]);

  const timeMarkers = useMemo(() => {
    if (duration <= 0) return [];
    const interval = Math.max(1, Math.round(8 / zoom));
    const markers: number[] = [];
    for (let t = 0; t <= duration; t += interval) markers.push(t);
    return markers;
  }, [duration, zoom]);

  const barMarkers = useMemo(() => {
    if (duration <= 0) return [];
    const markers: number[] = [];
    for (let t = 0; t <= duration + 0.0001; t += BAR_SECONDS) markers.push(t);
    return markers;
  }, [duration]);

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (controlsDisabled || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + e.currentTarget.scrollLeft;
    const time = (x / timelineWidth) * duration;
    onSeek(Math.max(0, Math.min(duration, time)));
  };

  const handleTimelineMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (controlsDisabled || !onHoverTime || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + e.currentTarget.scrollLeft;
    const time = (x / timelineWidth) * duration;
    onHoverTime(Math.max(0, Math.min(duration, time)));
  };

  const handleTimelineLeave = () => {
    onHoverTime?.(null);
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (controlsDisabled) return;
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (e.deltaY > 0) {
      setZoomIndex((prev) => Math.max(0, prev - 1));
    } else {
      setZoomIndex((prev) => Math.min(zoomLevels.length - 1, prev + 1));
    }
  };

  const handleClipPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (controlsDisabled || !audioUrl || !hasAudioClip) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    clipDragRef.current = { startX: e.clientX, startTime: audioClipStart };
  };

  const handleClipPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (controlsDisabled || !clipDragRef.current) return;
    const delta = e.clientX - clipDragRef.current.startX;
    const next = clipDragRef.current.startTime + delta / pixelsPerSecond;
    onAudioClipChange(Math.max(0, Math.min(maxClipStart, next)));
  };

  const handleClipPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (controlsDisabled || !clipDragRef.current) return;
    clipDragRef.current = null;
    const snapped = Math.round(audioClipStart / BAR_SECONDS) * BAR_SECONDS;
    onAudioClipChange(Math.max(0, Math.min(maxClipStart, snapped)));
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleClipResizeDown = (side: 'start' | 'end') => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (controlsDisabled || !audioUrl || !hasAudioClip) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    clipResizeRef.current = {
      startX: e.clientX,
      startTime: audioClipStart,
      startDuration: audioClipDuration,
      side,
    };
  };

  const handleClipResizeMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (controlsDisabled || !clipResizeRef.current) return;
    const { startX, startTime, startDuration, side } = clipResizeRef.current;
    const delta = (e.clientX - startX) / pixelsPerSecond;
    const effectiveAudioDuration =
      audioWaveDuration > 0 ? audioWaveDuration : (audioDuration ?? duration);
    if (side === 'start') {
      const endTime = startTime + startDuration;
      const maxStart = Math.max(0, endTime - 2);
      const nextStart = Math.max(0, Math.min(startTime + delta, maxStart));
      const trimDelta = nextStart - startTime;
      let nextDuration = Math.max(2, endTime - nextStart);
      let nextOffset = Math.max(0, audioClipOffset + trimDelta);
      if (effectiveAudioDuration) {
        const maxOffset = Math.max(0, effectiveAudioDuration - nextDuration);
        nextOffset = Math.min(nextOffset, maxOffset);
        nextDuration = Math.min(nextDuration, effectiveAudioDuration - nextOffset);
      }
      onAudioClipChange(nextStart);
      onAudioClipOffsetChange(nextOffset);
      onAudioClipDurationChange(nextDuration);
    } else {
      const maxByTimeline = Math.max(2, duration - startTime);
      const maxByAudio = effectiveAudioDuration
        ? Math.max(2, effectiveAudioDuration - audioClipOffset)
        : maxByTimeline;
      const nextDuration = Math.max(2, Math.min(startDuration + delta, maxByTimeline, maxByAudio));
      onAudioClipDurationChange(nextDuration);
    }
  };

  const handleClipResizeUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (controlsDisabled || !clipResizeRef.current) return;
    clipResizeRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleSelectionPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (controlsDisabled) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    selectionDragRef.current = { startX: e.clientX, startTime: selectionStart };
  };

  const handleSelectionPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (controlsDisabled || !selectionDragRef.current) return;
    const delta = e.clientX - selectionDragRef.current.startX;
    const next = selectionDragRef.current.startTime + delta / pixelsPerSecond;
    onSelectionStart(Math.max(0, Math.min(maxSelectionStart, next)));
  };

  const handleSelectionPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (controlsDisabled || !selectionDragRef.current) return;
    selectionDragRef.current = null;
    const snapped = Math.round(selectionStart / BAR_SECONDS) * BAR_SECONDS;
    onSelectionStart(Math.max(0, Math.min(maxSelectionStart, snapped)));
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  if (loading) {
    return (
      <div className="rounded border border-neutral-800 bg-neutral-950/80 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="h-4 w-28 rounded bg-neutral-800 animate-pulse" />
          <div className="h-7 w-28 rounded bg-neutral-800 animate-pulse" />
        </div>
        <div className="h-40 w-full rounded bg-neutral-800 animate-pulse" />
      </div>
    );
  }

  if (duration <= 0) {
    return (
      <div className="rounded border border-neutral-800 bg-neutral-950/80 p-4 text-sm text-neutral-500">
        타임라인을 만들 수 없습니다.
      </div>
    );
  }

  return (
    <div className="rounded border border-neutral-800 bg-neutral-950/80 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <h3 className="text-base font-semibold text-white">메인 타임라인</h3>
          <p className="text-[11px] text-neutral-500 mt-1 uppercase tracking-[0.25em]">
            Video Keypoints + Audio Placement
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onPlayPause}
            className="bg-transparent border-neutral-700 hover:bg-white/5"
            disabled={controlsDisabled}
          >
            {isPlaying ? <Pause className="size-4" /> : <Play className="size-4 ml-0.5" />}
          </Button>
          <div className="text-[11px] text-neutral-400 uppercase tracking-widest">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
          <div className="inline-flex items-center overflow-hidden rounded border border-neutral-700 bg-transparent">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 rounded-none border-0 bg-transparent hover:bg-white/5"
              onClick={() =>
                onSelectionBarsChange(
                  BAR_OPTIONS[Math.max(0, currentBarsIndex - 1)] ?? selectionBars
                )
              }
              disabled={controlsDisabled}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <div className="h-5 w-px bg-neutral-800" />
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-3 rounded-none border-0 bg-transparent hover:bg-white/5 text-[12px] text-neutral-200"
              onClick={() => onSelectionStart(Math.min(maxSelectionStart, currentTime))}
              disabled={controlsDisabled}
            >
              {selectionBars}마디 선택
            </Button>
            <div className="h-5 w-px bg-neutral-800" />
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 rounded-none border-0 bg-transparent hover:bg-white/5"
              onClick={() =>
                onSelectionBarsChange(
                  BAR_OPTIONS[Math.min(BAR_OPTIONS.length - 1, currentBarsIndex + 1)] ??
                    selectionBars
                )
              }
              disabled={controlsDisabled}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setZoomIndex((prev) => Math.max(0, prev - 1))}
            className="bg-transparent border-neutral-700 hover:bg-white/5"
            disabled={controlsDisabled}
          >
            <ZoomOut className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setZoomIndex((prev) => Math.min(zoomLevels.length - 1, prev + 1))}
            className="bg-transparent border-neutral-700 hover:bg-white/5"
            disabled={controlsDisabled}
          >
            <ZoomIn className="size-4" />
          </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-3 text-xs text-neutral-400">
        <div className="flex items-center gap-2">
          <Clapperboard className="size-4 text-neutral-300" />
          <span>비디오 키포인트 {videoKeypoints.length}개</span>
        </div>
        <div className="flex items-center gap-2">
          <Music2 className="size-4 text-neutral-300" />
          <span>
            {audioUrl
              ? '오디오 배치 가능'
              : audioAvailable
                ? audioSourceLabel ?? '추출된 오디오 (파형 없음)'
                : '오디오 없음'}
          </span>
        </div>
        <div className="text-neutral-500">
          선택 구간 {formatTime(selectionStart)} - {formatTime(selectionEnd)} ({selectionBars}마디 · {BAR_SECONDS}s)
        </div>
      </div>

      <div className="flex gap-3 min-w-0">
        <div className="shrink-0 text-[11px] uppercase tracking-[0.22em] text-neutral-500">
          <div
            className="rounded border border-neutral-800 bg-neutral-950/80"
            style={{ width: TRACK_HEADER_WIDTH }}
          >
            <div
              className="px-3 flex items-center border-b border-neutral-800 text-neutral-400 text-[10px] leading-none"
              style={{ height: RULER_HEIGHT }}
            >
              TRACKS
            </div>
            <div className="space-y-2 px-3 py-2">
              <div
                className="rounded border border-neutral-800 bg-neutral-900/60 px-2 flex flex-col justify-center leading-none"
                style={{ height: ROW_HEIGHT }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-neutral-300 text-[10px] leading-none">VIDEO</span>
                  {hasMeshes && (
                    <span className="px-1 py-0.5 text-[8px] bg-purple-500/20 text-purple-300 rounded border border-purple-500/30">
                      3D
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-neutral-500 leading-none">
                  {hasMeshes ? 'hover for 3D mesh' : 'keypoints'}
                </div>
              </div>
              <div
                className="rounded border border-neutral-800 bg-neutral-900/60 px-2 flex flex-col justify-center leading-none"
                style={{ height: ROW_HEIGHT }}
              >
                <div className="text-neutral-300 text-[10px] leading-none mb-1">AUDIO CLIP</div>
                {drumBandUrls && (drumBandUrls.low || drumBandUrls.mid || drumBandUrls.high) ? (
                  <div className="flex gap-0.5">
                    {(['all', 'low', 'mid', 'high'] as const).map((band) => (
                      <button
                        key={band}
                        onClick={() => onDrumBandChange?.(band)}
                        className={`px-1.5 py-0.5 text-[8px] uppercase rounded transition-colors ${
                          drumBand === band
                            ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50'
                            : 'bg-neutral-800/50 text-neutral-500 border border-transparent hover:text-neutral-300'
                        }`}
                      >
                        {band === 'all' ? 'ALL' : band.toUpperCase()}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-[10px] text-neutral-500 leading-none">clip</div>
                )}
              </div>
              <div
                className="rounded border border-neutral-800 bg-neutral-900/60 px-2 flex flex-col justify-center leading-none"
                style={{ height: ROW_HEIGHT }}
              >
                <div className="text-neutral-300 text-[10px] leading-none">SELECTION</div>
                <div className="text-[10px] text-neutral-500 leading-none">{selectionBars} bars</div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div
            ref={containerRef}
            className="relative overflow-y-hidden rounded border border-neutral-800 bg-neutral-950"
            style={{
              height: RULER_HEIGHT + ROW_HEIGHT * 3 + ROW_GAP * 2 + 16,
              overflowX: zoom === 1 ? 'hidden' : 'auto',
            }}
            onClick={handleTimelineClick}
            onMouseMove={handleTimelineMove}
            onMouseLeave={handleTimelineLeave}
            onWheel={handleWheel}
          >
            <div
              className="relative h-full"
              style={{ width: isReady ? timelineWidth : '100%' }}
            >
              <div className="absolute inset-0 pointer-events-none">
                {barMarkers.map((t) => {
                  const left = (t / duration) * timelineWidth;
                  return (
                    <div
                      key={`bar-${t}`}
                      className="absolute top-0 bottom-0 w-px bg-neutral-600/70"
                      style={{ left }}
                    />
                  );
                })}
              </div>
              <canvas
                ref={videoWaveCanvasRef}
                className="absolute left-0 pointer-events-none"
                style={{
                  top: RULER_HEIGHT,
                  height: ROW_HEIGHT,
                  width: isReady ? timelineWidth : '100%',
                  opacity: videoWaveform ? 1 : 0,
                }}
              />
              <canvas
                ref={audioWaveCanvasRef}
                className="absolute left-0 pointer-events-none"
                style={{
                  top: RULER_HEIGHT + ROW_HEIGHT + ROW_GAP,
                  height: ROW_HEIGHT,
                  width: isReady ? timelineWidth : '100%',
                  opacity: audioWaveform ? 1 : 0,
                }}
              />
              <div
                className="absolute top-0 left-0 right-0 bg-neutral-950/90 border-b border-neutral-800"
                style={{ height: RULER_HEIGHT }}
              >
                {timeMarkers.map((t) => {
                  const left = (t / duration) * timelineWidth;
                  return (
                    <div key={`ruler-${t}`} className="absolute top-0 h-full" style={{ left }}>
                      <div className="absolute top-0 h-full w-px bg-neutral-800/70" />
                      <div className="absolute top-1 text-[10px] text-neutral-600">
                        {formatTime(t)}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div
                className="absolute left-0 right-0 h-px bg-neutral-800/60"
                style={{ top: RULER_HEIGHT }}
              />
              <div
                className="absolute left-0 right-0 h-px bg-neutral-800/60"
                style={{ top: RULER_HEIGHT + ROW_HEIGHT + ROW_GAP }}
              />
              <div
                className="absolute left-0 right-0 h-px bg-neutral-800/60"
                style={{ top: RULER_HEIGHT + (ROW_HEIGHT + ROW_GAP) * 2 }}
              />

              <div
                className="absolute rounded-md border border-sky-400/40 bg-sky-500/10"
                style={{
                  left: 0,
                  top: RULER_HEIGHT + (ROW_HEIGHT - VIDEO_BAR_HEIGHT) / 2,
                  width: timelineWidth,
                  height: VIDEO_BAR_HEIGHT,
                }}
              >
                <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(14,116,144,0.15),rgba(2,132,199,0.2),rgba(14,116,144,0.15))]" />
              </div>

              {videoKeypoints.map((kp, idx) => {
                const left = (kp.time / duration) * timelineWidth;
                const height = kp.type === 'hold' && kp.duration ? 30 : 20;
                const hasMesh = kp.frame != null && projectId;
                return (
                  <div
                    key={`kp-${idx}-${kp.time}`}
                    className={`absolute w-[3px] rounded-full ${hasMesh ? 'cursor-pointer hover:w-[5px] transition-all' : ''}`}
                    style={{
                      left,
                      height,
                      background: KEYPOINT_COLORS[kp.type],
                      opacity: 0.35 + kp.intensity * 0.5,
                      top: RULER_HEIGHT + (ROW_HEIGHT - height) / 2,
                    }}
                    onMouseEnter={(e) => {
                      if (!hasMesh) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      setHoveredKeypoint({ kp, x: rect.left, y: rect.top });
                    }}
                    onMouseLeave={() => setHoveredKeypoint(null)}
                  />
                );
              })}

              {audioUrl && hasAudioClip ? (
                <div
                  className="absolute rounded-md border border-emerald-400/60 bg-emerald-500/15 px-2 flex items-center gap-2 text-xs text-emerald-200 cursor-grab active:cursor-grabbing shadow-[0_0_0_1px_rgba(16,185,129,0.3)]"
                  style={{
                    height: AUDIO_BAR_HEIGHT,
                    top:
                      RULER_HEIGHT +
                      ROW_HEIGHT +
                      ROW_GAP +
                      (ROW_HEIGHT - AUDIO_BAR_HEIGHT) / 2,
                    left: audioClipStart * pixelsPerSecond,
                    width: Math.max(80, audioClipDuration * pixelsPerSecond),
                  }}
                  onPointerDown={handleClipPointerDown}
                  onPointerMove={handleClipPointerMove}
                  onPointerUp={handleClipPointerUp}
                >
                  <button
                    type="button"
                    aria-label="Trim start"
                    className="h-6 w-2 rounded bg-emerald-300/70 hover:bg-emerald-200 cursor-ew-resize"
                    onPointerDown={handleClipResizeDown('start')}
                    onPointerMove={handleClipResizeMove}
                    onPointerUp={handleClipResizeUp}
                  />
                  <div className="h-3 w-3 rounded-full bg-emerald-400" />
                  <span className="truncate">Audio Clip</span>
                  <span className="ml-auto text-[10px] text-emerald-200/70">
                    {formatTime(audioClipDuration)}
                  </span>
                  <button
                    type="button"
                    aria-label="Trim end"
                    className="h-6 w-2 rounded bg-emerald-300/70 hover:bg-emerald-200 cursor-ew-resize"
                    onPointerDown={handleClipResizeDown('end')}
                    onPointerMove={handleClipResizeMove}
                    onPointerUp={handleClipResizeUp}
                  />
                </div>
              ) : audioUrl ? (
                <div
                  className="absolute left-4 flex items-center gap-2 text-xs text-neutral-500"
                  style={{
                    top:
                      RULER_HEIGHT +
                      ROW_HEIGHT +
                      ROW_GAP +
                      (ROW_HEIGHT - AUDIO_BAR_HEIGHT) / 2,
                  }}
                >
                  클립이 비어있습니다.
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlaceAudioClip();
                    }}
                    className="rounded border border-neutral-700 px-2 py-1 text-[10px] text-neutral-300 hover:border-neutral-500"
                  >
                    클립 넣기
                  </button>
                </div>
              ) : audioAvailable ? (
                <div
                  className="absolute rounded-md border border-emerald-400/30 border-dashed bg-emerald-500/5 px-2 flex items-center gap-2 text-xs text-emerald-200/70"
                  style={{
                    height: AUDIO_BAR_HEIGHT,
                    top:
                      RULER_HEIGHT +
                      ROW_HEIGHT +
                      ROW_GAP +
                      (ROW_HEIGHT - AUDIO_BAR_HEIGHT) / 2,
                    left: 0,
                    width: timelineWidth,
                  }}
                >
                  <div className="h-2 w-2 rounded-full bg-emerald-300/70" />
                  {audioSourceLabel ?? '추출된 오디오 (파형 없음)'}
                </div>
              ) : (
                <div
                  className="absolute left-4 text-xs text-neutral-600"
                  style={{
                    top:
                      RULER_HEIGHT +
                      ROW_HEIGHT +
                      ROW_GAP +
                      (ROW_HEIGHT - AUDIO_BAR_HEIGHT) / 2,
                  }}
                >
                  오디오를 업로드하면 배치할 수 있습니다.
                </div>
              )}

              <div
                className="absolute rounded-md border border-white/20 bg-white/5 cursor-ew-resize"
                style={{
                  height: SELECTION_BAR_HEIGHT,
                  top:
                    RULER_HEIGHT +
                    (ROW_HEIGHT + ROW_GAP) * 2 +
                    (ROW_HEIGHT - SELECTION_BAR_HEIGHT) / 2,
                  left: selectionStart * pixelsPerSecond,
                  width: Math.max(40, selectionDuration * pixelsPerSecond),
                }}
                onPointerDown={handleSelectionPointerDown}
                onPointerMove={handleSelectionPointerMove}
                onPointerUp={handleSelectionPointerUp}
              >
                <div className="h-full w-full flex items-center justify-center text-[10px] text-neutral-200">
                  {selectionBars}마디
                </div>
              </div>

              <div
                ref={playheadRef}
                className="absolute left-0 top-0 h-full w-px bg-white pointer-events-none will-change-transform"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 text-xs text-neutral-500">
        스크롤로 이동, 버튼으로 줌 조절. 오디오 클립을 드래그해 비디오 타임라인에 맞춰 배치하세요.
      </div>

      {/* Mesh Preview Popup */}
      {hoveredKeypoint && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: hoveredKeypoint.x + 10,
            top: hoveredKeypoint.y - 220,
          }}
        >
          <div className="bg-neutral-900 border border-neutral-700 rounded-lg p-2 shadow-xl">
            <MeshPreview url={meshUrl} width={180} height={180} />
            <div className="mt-2 text-center">
              <div className="text-[10px] text-neutral-400 uppercase tracking-wider">
                {hoveredKeypoint.kp.type}
              </div>
              <div className="text-xs text-white">
                {hoveredKeypoint.kp.time.toFixed(2)}s
                {hoveredKeypoint.kp.frame != null && (
                  <span className="text-neutral-500 ml-1">
                    (frame {hoveredKeypoint.kp.frame})
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
