import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import type { EventPoint } from "../types/event";

const WAVEFORM_HEIGHT = 120;
/** 강함/중간/약함 또는 P0/P1/P2 → y 위치 (0=top, 1=middle, 2=bottom) */
const LAYER_TO_TIER: Record<string, number> = {
  강함: 0,
  중간: 1,
  약함: 2,
  P0: 0,
  P1: 1,
  P2: 2,
};
const DEFAULT_MIN_PX_PER_SEC = 50;
/** 재생 시점 기준 활성화 구간: t - BEFORE ~ t + AFTER (초) */
const ACTIVATE_BEFORE_SEC = 0.03;
const ACTIVATE_AFTER_SEC = 0.15;
const ZOOM_FACTOR = 1.5;
const MIN_ZOOM = 10;
const MAX_ZOOM = 500;

interface WaveformWithOverlayProps {
  audioUrl: string | null;
  events: EventPoint[];
  visibleLayers: Set<string>;
}

export function WaveformWithOverlay({
  audioUrl,
  events,
  visibleLayers,
}: WaveformWithOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [overlaySize, setOverlaySize] = useState({ width: 0, height: WAVEFORM_HEIGHT });
  const [isPlaying, setIsPlaying] = useState(false);
  const [minPxPerSec, setMinPxPerSec] = useState(DEFAULT_MIN_PX_PER_SEC);
  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, 1]);

  // WaveSurfer 초기화 및 오디오 로드
  useEffect(() => {
    if (!audioUrl || !containerRef.current) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: WAVEFORM_HEIGHT,
      minPxPerSec: DEFAULT_MIN_PX_PER_SEC,
      waveColor: "rgba(68, 68, 68, 0.2)",
      progressColor: "rgba(26, 115, 232, 0.25)",
      cursorWidth: 2,
      barWidth: 1,
      barGap: 1,
      barRadius: 0,
      normalize: true,
    });

    ws.load(audioUrl);

    ws.on("ready", () => {
      const d = ws.getDuration();
      setDuration(d);
      setMinPxPerSec(DEFAULT_MIN_PX_PER_SEC);
      setVisibleRange([0, d]);
    });
    ws.on("scroll", (start: number, end: number) => {
      setVisibleRange([start, end]);
    });
    ws.on("zoom", (newMinPxPerSec: number) => {
      const wrapper = ws.getWrapper();
      const width = wrapper?.clientWidth ?? 0;
      const dur = ws.getDuration();
      if (width > 0 && dur > 0 && newMinPxPerSec > 0) {
        const visibleDur = width / newMinPxPerSec;
        setVisibleRange((prev) => {
          const end = Math.min(dur, prev[0] + visibleDur);
          return [prev[0], end];
        });
      }
    });
    ws.on("audioprocess", (time: number) => {
      setCurrentTime(time);
    });
    ws.on("seeking", (time: number) => {
      setCurrentTime(time);
    });
    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));
    ws.on("finish", () => setIsPlaying(false));

    wavesurferRef.current = ws;
    return () => {
      ws.destroy();
      wavesurferRef.current = null;
    };
  }, [audioUrl]);

  // 오버레이 영역 크기 측정
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0]?.contentRect ?? { width: 0, height: WAVEFORM_HEIGHT };
      setOverlaySize((prev) => ({ width: width || prev.width, height: height || WAVEFORM_HEIGHT }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [audioUrl]);

  const [visibleStart, visibleEnd] = visibleRange;
  const visibleDur = Math.max(0.001, visibleEnd - visibleStart);
  const xScale = (t: number) =>
    visibleDur > 0
      ? ((t - visibleStart) / visibleDur) * overlaySize.width
      : 0;

  const filteredEvents = events.filter((e) => visibleLayers.has(e.layer));

  // 강함/중간/약함 → 높이 3단 (강함=상단, 중간=중앙, 약함=하단)
  const yFromLayer = (layer: string) => {
    const tier = LAYER_TO_TIER[layer] ?? 1;
    const h = overlaySize.height;
    if (tier === 0) return h * 0.2;
    if (tier === 1) return h * 0.5;
    return h * 0.8;
  };

  // strength 0~1 정규화 (데이터 범위가 좁을 때 시각적 구분 가능하도록)
  const strengthRange = (() => {
    if (filteredEvents.length === 0) return { min: 0, max: 1 };
    const vals = filteredEvents.map((e) => e.strength);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return { min, max: max > min ? max : min + 1 };
  })();
  const normStrength = (s: number) =>
    (s - strengthRange.min) / (strengthRange.max - strengthRange.min);

  // 재생 시점 근처면 밝게 (활성화)
  const getPointOpacity = (eventTime: number) => {
    const lo = eventTime - ACTIVATE_BEFORE_SEC;
    const hi = eventTime + ACTIVATE_AFTER_SEC;
    if (currentTime >= lo && currentTime <= hi) return 1;
    return 0.5;
  };

  const togglePlay = () => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    ws.playPause();
  };

  const zoomIn = () => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    const next = Math.min(MAX_ZOOM, minPxPerSec * ZOOM_FACTOR);
    setMinPxPerSec(next);
    ws.zoom(next);
  };

  const zoomOut = () => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    const next = Math.max(MIN_ZOOM, minPxPerSec / ZOOM_FACTOR);
    setMinPxPerSec(next);
    ws.zoom(next);
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  if (!audioUrl) {
    return (
      <div className="waveform-placeholder">
        오디오 파일을 업로드하면 파형이 표시됩니다.
      </div>
    );
  }

  return (
    <div className="waveform-with-overlay">
      <div className="waveform-controls">
        <button type="button" onClick={togglePlay} disabled={duration === 0}>
          {isPlaying ? "일시정지" : "재생"}
        </button>
        <span className="time-display">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <div className="zoom-controls">
          <button type="button" onClick={zoomOut} disabled={duration === 0} title="줌 아웃">
            −
          </button>
          <button type="button" onClick={zoomIn} disabled={duration === 0} title="줌 인">
            +
          </button>
        </div>
      </div>
      <div className="waveform-visual">
        <div className="waveform-container" ref={containerRef} />
        <div
          className="overlay-svg-wrap"
          style={{
            width: overlaySize.width,
            height: overlaySize.height,
          }}
        >
        <svg
          width={overlaySize.width}
          height={overlaySize.height}
          style={{ display: "block", pointerEvents: "none" }}
        >
          {filteredEvents.map((event, i) => (
            <circle
              key={`${event.t}-${event.layer}-${i}`}
              cx={xScale(event.t)}
              cy={yFromLayer(event.layer)}
              r={Math.max(2, normStrength(event.strength) * 8 + 2)}
              fill={event.color}
              opacity={getPointOpacity(event.t)}
            />
          ))}
          {duration > 0 && (
            <line
              x1={xScale(currentTime)}
              x2={xScale(currentTime)}
              y1={0}
              y2={overlaySize.height}
              stroke="#e74c3c"
              strokeWidth={2}
            />
          )}
        </svg>
        </div>
      </div>
    </div>
  );
}
