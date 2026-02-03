import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { LayerTimelineStrip } from "./LayerTimelineStrip";
import type { EventPoint } from "../types/event";

const WAVEFORM_HEIGHT = 100;
const STRIP_HEIGHT = 44;
const DEFAULT_MIN_PX_PER_SEC = 50;
const ZOOM_FACTOR = 1.5;
const MIN_ZOOM = 10;
const MAX_ZOOM = 500;

const LAYER_ORDER = ["P0", "P1", "P2"] as const;
const LAYER_LABELS: Record<string, string> = {
  P0: "P0 (저정밀)",
  P1: "P1 (중정밀)",
  P2: "P2 (고정밀)",
};
const LAYER_COLORS: Record<string, string> = {
  P0: "#2ecc71",
  P1: "#f39c12",
  P2: "#3498db",
};

/** roles가 있으면 해당 역할이 있는 모든 행에 이벤트 표시(중복 허용); 없으면 layer 한 행만 */
function eventsForLayer(events: EventPoint[], layer: string): EventPoint[] {
  return events.filter((e) => {
    if (e.roles) {
      const bands = e.roles[layer as keyof typeof e.roles];
      return Array.isArray(bands) && bands.length > 0;
    }
    return e.layer === layer;
  });
}

interface Tab09LayerViewProps {
  audioUrl: string | null;
  events: EventPoint[];
}

export function Tab09LayerView({ audioUrl, events }: Tab09LayerViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [minPxPerSec, setMinPxPerSec] = useState(DEFAULT_MIN_PX_PER_SEC);
  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, 1]);

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
      setVisibleRange([0, d]);
    });
    ws.on("scroll", (start: number, end: number) => setVisibleRange([start, end]));
    ws.on("zoom", (newMinPxPerSec: number) => {
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

  const togglePlay = () => wavesurferRef.current?.playPause();
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

  const eventsByLayer = LAYER_ORDER.map((layer) => ({
    layer,
    events: eventsForLayer(events, layer),
  }));

  if (!audioUrl) {
    return (
      <div className="waveform-placeholder">
        오디오 파일을 업로드하면 파형이 표시됩니다.
      </div>
    );
  }

  return (
    <div className="tab09-layer-view">
      <div className="tab09-waveform-section">
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
        <div className="tab09-waveform-container" ref={containerRef} />
      </div>
      <div className="tab09-layer-rows">
        {eventsByLayer.map(({ layer, events: layerEvents }) => (
          <LayerTimelineStrip
            key={layer}
            label={LAYER_LABELS[layer] ?? layer}
            events={layerEvents}
            currentTime={currentTime}
            visibleRange={visibleRange}
            height={STRIP_HEIGHT}
            stripColor={LAYER_COLORS[layer]}
          />
        ))}
      </div>
    </div>
  );
}
