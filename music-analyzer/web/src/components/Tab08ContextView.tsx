import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import type { ContextEvent, ContextJsonData } from "../types/contextEvent";

const WAVEFORM_HEIGHT = 100;
const TRACK_HEIGHT = 56;
const DEFAULT_MIN_PX_PER_SEC = 50;
const ACTIVATE_BEFORE_SEC = 0.03;
const ACTIVATE_AFTER_SEC = 0.15;
const ZOOM_FACTOR = 1.5;
const MIN_ZOOM = 10;
const MAX_ZOOM = 500;

interface Tab08ContextViewProps {
  audioUrl: string | null;
  contextData: ContextJsonData | null;
}

function norm01(arr: number[]): { min: number; max: number; fn: (v: number) => number } {
  if (arr.length === 0) return { min: 0, max: 1, fn: () => 0.5 };
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const span = max > min ? max - min : 1;
  return { min, max, fn: (v) => (v - min) / span };
}

export function Tab08ContextView({ audioUrl, contextData }: Tab08ContextViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [overlayWidth, setOverlayWidth] = useState(0);
  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, 1]);
  const [minPxPerSec, setMinPxPerSec] = useState(DEFAULT_MIN_PX_PER_SEC);

  useEffect(() => {
    if (!audioUrl || !containerRef.current) return;
    const el = containerRef.current;
    const ws = WaveSurfer.create({
      container: el,
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
      setVisibleRange([0, d]);
    });
    ws.on("scroll", (start: number, end: number) => setVisibleRange([start, end]));
    ws.on("zoom", (newMinPxPerSec: number) => {
      setMinPxPerSec(newMinPxPerSec);
      const wrapper = ws.getWrapper();
      const w = wrapper?.clientWidth ?? 0;
      const dur = ws.getDuration();
      if (w > 0 && dur > 0 && newMinPxPerSec > 0) {
        const visibleDur = w / newMinPxPerSec;
        setVisibleRange((prev) => [prev[0], Math.min(dur, prev[0] + visibleDur)]);
      }
    });
    ws.on("audioprocess", (t: number) => setCurrentTime(t));
    ws.on("seeking", (t: number) => setCurrentTime(t));
    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));
    ws.on("finish", () => setIsPlaying(false));
    wavesurferRef.current = ws;
    return () => {
      ws.destroy();
      wavesurferRef.current = null;
    };
  }, [audioUrl]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width ?? 0;
      setOverlayWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [audioUrl]);

  const [visibleStart, visibleEnd] = visibleRange;
  const visibleDur = Math.max(0.001, visibleEnd - visibleStart);
  const xScale = (t: number) => (visibleDur > 0 ? ((t - visibleStart) / visibleDur) * overlayWidth : 0);

  const getOpacity = (eventTime: number) => {
    const lo = eventTime - ACTIVATE_BEFORE_SEC;
    const hi = eventTime + ACTIVATE_AFTER_SEC;
    return currentTime >= lo && currentTime <= hi ? 1 : 0.5;
  };

  const togglePlay = () => wavesurferRef.current?.playPause();
  const zoomIn = () => {
    const ws = wavesurferRef.current;
    if (ws) {
      const next = Math.min(MAX_ZOOM, minPxPerSec * ZOOM_FACTOR);
      setMinPxPerSec(next);
      ws.zoom(next);
    }
  };
  const zoomOut = () => {
    const ws = wavesurferRef.current;
    if (ws) {
      const next = Math.max(MIN_ZOOM, minPxPerSec / ZOOM_FACTOR);
      setMinPxPerSec(next);
      ws.zoom(next);
    }
  };
  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;

  if (!audioUrl) {
    return (
      <div className="waveform-placeholder">
        오디오 파일을 업로드하면 파형이 표시됩니다.
      </div>
    );
  }

  const events = contextData?.events ?? [];
  const meta = contextData?.meta;
  const hasContextData = contextData != null && events.length > 0;

  const snrNorm = norm01(events.map((e: ContextEvent) => e.snr_db));
  const maskingAvg = events.map((e: ContextEvent) => (e.masking_low + e.masking_mid + e.masking_high) / 3);
  const maskingNorm = norm01(maskingAvg);
  const dependencyNorm = norm01(events.map((e: ContextEvent) => e.dependency_score));

  const TRACKS: {
    key: string;
    label: string;
    color: string;
    getR: (e: ContextEvent, i: number) => number;
  }[] = [
    {
      key: "snr",
      label: "SNR (dB) — 높을수록 독립적",
      color: "#3498db",
      getR: (e) => 2 + snrNorm.fn(e.snr_db) * 8,
    },
    {
      key: "masking",
      label: "Masking (대역 평균) — 높을수록 묻힘",
      color: "#e67e22",
      getR: (_, i) => 2 + maskingNorm.fn(maskingAvg[i]) * 8,
    },
    {
      key: "dependency",
      label: "Dependency Score — 높을수록 의존적",
      color: "#e74c3c",
      getR: (e) => 2 + dependencyNorm.fn(e.dependency_score) * 8,
    },
  ];

  return (
    <div className="tab08-context-view">
      <div className="waveform-controls">
        <button type="button" onClick={togglePlay} disabled={duration === 0}>
          {isPlaying ? "일시정지" : "재생"}
        </button>
        <span className="time-display">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <div className="zoom-controls">
          <button type="button" onClick={zoomOut} disabled={duration === 0}>−</button>
          <button type="button" onClick={zoomIn} disabled={duration === 0}>+</button>
        </div>
      </div>

      <div className="waveform-visual">
        <div className="waveform-container" ref={containerRef} />
      </div>

      {!hasContextData && (
        <p className="context-meta">08 Context 샘플 로드를 눌러 Context JSON을 불러오세요.</p>
      )}
      {meta && hasContextData && (
        <p className="context-meta">
          <strong>입력 파일:</strong> {meta.source} · BPM {meta.bpm.toFixed(1)} · {events.length}개 이벤트
        </p>
      )}

      <div className="context-tracks">
        {TRACKS.map(({ key, label, color, getR }) =>
          hasContextData ? (
            <div key={key} className="context-track">
              <span className="context-track-label">{label}</span>
              <div className="context-track-visual" style={{ width: overlayWidth, height: TRACK_HEIGHT }}>
                <svg width={overlayWidth} height={TRACK_HEIGHT} style={{ display: "block" }}>
                  {events.map((e, i) => (
                    <circle
                      key={`${key}-${e.time}-${i}`}
                      cx={xScale(e.time)}
                      cy={TRACK_HEIGHT / 2}
                      r={getR(e, i)}
                      fill={color}
                      opacity={getOpacity(e.time)}
                    />
                  ))}
                  {duration > 0 && (
                    <line
                      x1={xScale(currentTime)}
                      x2={xScale(currentTime)}
                      y1={0}
                      y2={TRACK_HEIGHT}
                      stroke="#e74c3c"
                      strokeWidth={2}
                    />
                  )}
                </svg>
              </div>
            </div>
          ) : null
        )}
      </div>
    </div>
  );
}
