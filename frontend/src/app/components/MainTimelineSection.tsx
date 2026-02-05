import { useEffect, useMemo, useRef, useState } from 'react';
import { MotionKeypoint } from '../types';
import { Button } from './ui/button';
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

interface MainTimelineSectionProps {
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  videoKeypoints: MotionKeypoint[];
  audioUrl?: string | null;
  audioAvailable: boolean;
  audioSourceLabel?: string;
  hasAudioClip: boolean;
  onPlaceAudioClip: () => void;
  audioClipStart: number;
  audioClipDuration: number;
  onAudioClipChange: (start: number) => void;
  selectionStart: number;
  selectionDuration: number;
  selectionBars: number;
  onSelectionBarsChange: (bars: number) => void;
  onSelectionStart: (start: number) => void;
  onHoverTime?: (time: number | null) => void;
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
const RULER_HEIGHT = 26;
const ROW_HEIGHT = 36;
const ROW_GAP = 8;
const VIDEO_BAR_HEIGHT = 24;
const AUDIO_BAR_HEIGHT = 28;
const SELECTION_BAR_HEIGHT = 22;

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
  audioUrl,
  audioAvailable,
  audioSourceLabel,
  hasAudioClip,
  onPlaceAudioClip,
  audioClipStart,
  audioClipDuration,
  onAudioClipChange,
  selectionStart,
  selectionDuration,
  selectionBars,
  onSelectionBarsChange,
  onSelectionStart,
  onHoverTime,
}: MainTimelineSectionProps) {
  const zoomLevels = [1, 1.5, 3, 6, 12];
  const [zoomIndex, setZoomIndex] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const clipDragRef = useRef<{ startX: number; startTime: number } | null>(null);
  const selectionDragRef = useRef<{ startX: number; startTime: number } | null>(null);

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

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + e.currentTarget.scrollLeft;
    const time = (x / timelineWidth) * duration;
    onSeek(Math.max(0, Math.min(duration, time)));
  };

  const handleTimelineMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onHoverTime || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + e.currentTarget.scrollLeft;
    const time = (x / timelineWidth) * duration;
    onHoverTime(Math.max(0, Math.min(duration, time)));
  };

  const handleTimelineLeave = () => {
    onHoverTime?.(null);
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (e.deltaY > 0) {
      setZoomIndex((prev) => Math.max(0, prev - 1));
    } else {
      setZoomIndex((prev) => Math.min(zoomLevels.length - 1, prev + 1));
    }
  };

  const handleClipPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!audioUrl || !hasAudioClip) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    clipDragRef.current = { startX: e.clientX, startTime: audioClipStart };
  };

  const handleClipPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!clipDragRef.current) return;
    const delta = e.clientX - clipDragRef.current.startX;
    const next = clipDragRef.current.startTime + delta / pixelsPerSecond;
    onAudioClipChange(Math.max(0, Math.min(maxClipStart, next)));
  };

  const handleClipPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!clipDragRef.current) return;
    clipDragRef.current = null;
    const snapped = Math.round(audioClipStart / BAR_SECONDS) * BAR_SECONDS;
    onAudioClipChange(Math.max(0, Math.min(maxClipStart, snapped)));
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleSelectionPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    selectionDragRef.current = { startX: e.clientX, startTime: selectionStart };
  };

  const handleSelectionPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!selectionDragRef.current) return;
    const delta = e.clientX - selectionDragRef.current.startX;
    const next = selectionDragRef.current.startTime + delta / pixelsPerSecond;
    onSelectionStart(Math.max(0, Math.min(maxSelectionStart, next)));
  };

  const handleSelectionPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!selectionDragRef.current) return;
    selectionDragRef.current = null;
    const snapped = Math.round(selectionStart / BAR_SECONDS) * BAR_SECONDS;
    onSelectionStart(Math.max(0, Math.min(maxSelectionStart, snapped)));
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

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
            >
              <ChevronLeft className="size-4" />
            </Button>
            <div className="h-5 w-px bg-neutral-800" />
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-3 rounded-none border-0 bg-transparent hover:bg-white/5 text-[12px] text-neutral-200"
              onClick={() => onSelectionStart(Math.min(maxSelectionStart, currentTime))}
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
          >
            <ZoomOut className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setZoomIndex((prev) => Math.min(zoomLevels.length - 1, prev + 1))}
            className="bg-transparent border-neutral-700 hover:bg-white/5"
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
                ? audioSourceLabel ?? '오디오 있음 (영상 추출)'
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
                <div className="text-neutral-300 text-[10px] leading-none">VIDEO</div>
                <div className="text-[10px] text-neutral-500 leading-none">keypoints</div>
              </div>
              <div
                className="rounded border border-neutral-800 bg-neutral-900/60 px-2 flex flex-col justify-center leading-none"
                style={{ height: ROW_HEIGHT }}
              >
                <div className="text-neutral-300 text-[10px] leading-none">AUDIO 1</div>
                <div className="text-[10px] text-neutral-500 leading-none">clip</div>
              </div>
              <div
                className="rounded border border-neutral-800 bg-neutral-900/60 px-2 flex flex-col justify-center leading-none"
                style={{ height: ROW_HEIGHT }}
              >
                <div className="text-neutral-300 text-[10px] leading-none">SELECTION</div>
                <div className="text-[10px] text-neutral-500 leading-none">8 bars</div>
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
                return (
                  <div
                    key={`kp-${idx}-${kp.time}`}
                    className="absolute w-[3px] rounded-full"
                    style={{
                      left,
                      height,
                      background: KEYPOINT_COLORS[kp.type],
                      opacity: 0.35 + kp.intensity * 0.5,
                      top: RULER_HEIGHT + (ROW_HEIGHT - height) / 2,
                    }}
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
                  <div className="h-3 w-3 rounded-full bg-emerald-400" />
                  <span className="truncate">Audio Clip</span>
                  <span className="ml-auto text-[10px] text-emerald-200/70">
                    {formatTime(audioClipDuration)}
                  </span>
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
                  className="absolute rounded-md border border-emerald-400/40 bg-emerald-500/10 px-2 flex items-center gap-2 text-xs text-emerald-200/80"
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
                  <div className="h-2 w-2 rounded-full bg-emerald-300" />
                  영상 추출 오디오
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
                className="absolute top-0 h-full w-px bg-white"
                style={{ left: (currentTime / duration) * timelineWidth }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 text-xs text-neutral-500">
        스크롤로 이동, 버튼으로 줌 조절. 오디오 클립을 드래그해 비디오 타임라인에 맞춰 배치하세요.
      </div>
    </div>
  );
}
