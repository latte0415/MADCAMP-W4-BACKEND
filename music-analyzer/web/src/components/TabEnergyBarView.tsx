import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import type { EnergyJsonData } from "../types/energyEvent";

const WAVEFORM_HEIGHT = 100;
const DEFAULT_MIN_PX_PER_SEC = 50;
const ZOOM_FACTOR = 1.5;
const MIN_ZOOM = 10;
const MAX_ZOOM = 500;
const ROW_HEIGHT = 56;
const BAR_WIDTH_PX = 6;
const BAR_COLORS = {
  low: "#27ae60",
  mid: "#9b59b6",
  high: "#e74c3c",
  enorm: "#5a9fd4",
};

const ROWS: { key: keyof typeof BAR_COLORS; label: string }[] = [
  { key: "low", label: "Low" },
  { key: "mid", label: "Mid" },
  { key: "high", label: "High" },
  { key: "enorm", label: "E_norm" },
];

interface TabEnergyBarViewProps {
  audioUrl: string | null;
  energyData: EnergyJsonData | null;
}

function norm01(arr: number[]): { min: number; max: number; fn: (v: number) => number } {
  if (arr.length === 0) return { min: 0, max: 1, fn: () => 0.5 };
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const span = max > min ? max - min : 1;
  return { min, max, fn: (v) => (v - min) / span };
}

export function TabEnergyBarView({ audioUrl, energyData }: TabEnergyBarViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, 1]);
  const [minPxPerSec, setMinPxPerSec] = useState(DEFAULT_MIN_PX_PER_SEC);
  const [chartWidth, setChartWidth] = useState(0);

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
    const el = chartWrapRef.current ?? containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width ?? 0;
      setChartWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [audioUrl]);

  const seekTo = (t: number) => {
    wavesurferRef.current?.seekTo(t / Math.max(0.001, duration));
  };

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

  const events = energyData?.events ?? [];
  const meta = energyData?.meta;
  const hasEnergyData = energyData != null && events.length > 0;

  const [visibleStart, visibleEnd] = visibleRange;
  const visibleDur = Math.max(0.001, visibleEnd - visibleStart);
  const xScale = (t: number) =>
    chartWidth > 0 && visibleDur > 0 ? ((t - visibleStart) / visibleDur) * chartWidth : 0;

  const lowNorm = norm01(events.map((e) => e.band_low));
  const midNorm = norm01(events.map((e) => e.band_mid));
  const highNorm = norm01(events.map((e) => e.band_high));
  const enormNorm = norm01(events.map((e) => e.e_norm));

  const getValue = (key: keyof typeof BAR_COLORS, e: (typeof events)[0]) => {
    if (key === "low") return lowNorm.fn(e.band_low);
    if (key === "mid") return midNorm.fn(e.band_mid);
    if (key === "high") return highNorm.fn(e.band_high);
    return enormNorm.fn(e.e_norm);
  };

  return (
    <div className="tab-energy-bar-view">
      <div className="waveform-controls">
        <button type="button" onClick={() => wavesurferRef.current?.playPause()} disabled={duration === 0}>
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

      {!hasEnergyData && (
        <p className="energy-meta">Energy Bar (테스트) 탭에서 04 Energy 샘플을 로드하세요.</p>
      )}
      {meta && hasEnergyData && (
        <p className="energy-meta">
          <strong>{meta.source}</strong> · {meta.duration_sec.toFixed(1)}s · {events.length}개 이벤트
        </p>
      )}

      {hasEnergyData && chartWidth > 0 && (
        <div className="energy-bar-chart-wrap" ref={chartWrapRef}>
          {ROWS.map(({ key, label }) => (
            <div key={key} className="energy-bar-row">
              <span className="energy-bar-row-label" style={{ color: BAR_COLORS[key] }}>
                {label}
              </span>
              <div
                className="energy-bar-row-chart"
                style={{ width: chartWidth, height: ROW_HEIGHT }}
              >
                <svg width={chartWidth} height={ROW_HEIGHT} style={{ display: "block" }}>
                  {events.map((e, i) => {
                    const x = xScale(e.t) - BAR_WIDTH_PX / 2;
                    const val = getValue(key, e);
                    const h = Math.max(2, val * (ROW_HEIGHT - 20));
                    const y = ROW_HEIGHT - 20 - h;
                    const isActive = currentTime >= e.t - 0.05 && currentTime <= e.t + 0.15;
                    return (
                      <rect
                        key={`${key}-${e.t}-${i}`}
                        x={Math.max(0, x)}
                        y={y}
                        width={BAR_WIDTH_PX}
                        height={h}
                        fill={BAR_COLORS[key]}
                        opacity={isActive ? 1 : 0.7}
                        rx={1}
                        onClick={() => seekTo(e.t)}
                        style={{ cursor: "pointer" }}
                      />
                    );
                  })}
                  <line
                    x1={xScale(currentTime)}
                    x2={xScale(currentTime)}
                    y1={0}
                    y2={ROW_HEIGHT}
                    stroke="#e74c3c"
                    strokeWidth={1}
                  />
                </svg>
              </div>
            </div>
          ))}
          <p className="energy-bar-hint">
            가로축: 시간 (줌 −/+ 로 구간 변경). 막대 클릭 시 해당 위치로 이동.
          </p>
        </div>
      )}
    </div>
  );
}
