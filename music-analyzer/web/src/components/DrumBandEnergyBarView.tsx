import { useCallback, useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import type { DrumBandEnergyJsonData, DrumBandOnsetEvent } from "../types/drumBandEnergy";
import { applyBandFilter, type BandId } from "../utils/bandFilter";

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
};

type BandFilterOption = "all" | BandId;

const ROWS: { key: "low" | "mid" | "high"; label: string }[] = [
  { key: "low", label: "Low" },
  { key: "mid", label: "Mid" },
  { key: "high", label: "High" },
];

interface DrumBandEnergyBarViewProps {
  audioUrl: string | null;
  drumBandData: DrumBandEnergyJsonData | null;
}

export function DrumBandEnergyBarView({
  audioUrl,
  drumBandData,
}: DrumBandEnergyBarViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const filterAudioRef = useRef<HTMLAudioElement | null>(null);
  const filterBlobUrlsRef = useRef<Partial<Record<BandId, string>>>({});
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, 1]);
  const [minPxPerSec, setMinPxPerSec] = useState(DEFAULT_MIN_PX_PER_SEC);
  const [chartWidth, setChartWidth] = useState(0);
  const [bandFilter, setBandFilter] = useState<BandFilterOption>("all");
  const [filterLoading, setFilterLoading] = useState<BandId | null>(null);
  const [filterReady, setFilterReady] = useState<Partial<Record<BandId, boolean>>>({});

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
    if (bandFilter === "all") setIsPlaying(false);
  }, [bandFilter]);

  useEffect(() => {
    if (bandFilter === "all") return;
    const band = bandFilter as BandId;
    if (filterBlobUrlsRef.current[band]) return;
    if (!audioUrl) return;
    setFilterLoading(band);
    applyBandFilter(audioUrl, band)
      .then((blobUrl) => {
        filterBlobUrlsRef.current[band] = blobUrl;
        setFilterReady((prev) => ({ ...prev, [band]: true }));
        setFilterLoading(null);
      })
      .catch(() => setFilterLoading(null));
  }, [bandFilter, audioUrl]);

  useEffect(() => {
    setFilterReady({});
    return () => {
      Object.values(filterBlobUrlsRef.current).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
      filterBlobUrlsRef.current = {};
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
  }, [drumBandData]);

  const seekTo = useCallback(
    (t: number) => {
      const d = Math.max(0.001, duration);
      wavesurferRef.current?.seekTo(t / d);
      const el = filterAudioRef.current;
      if (el && !el.paused) {
        el.currentTime = t;
      } else if (el) {
        el.currentTime = t;
      }
      setCurrentTime(t);
    },
    [duration]
  );

  const handlePlayPause = useCallback(() => {
    if (bandFilter === "all") {
      filterAudioRef.current?.pause();
      wavesurferRef.current?.playPause();
      return;
    }
    wavesurferRef.current?.pause();
    const band = bandFilter as BandId;
    const blobUrl = filterBlobUrlsRef.current[band];
    if (!blobUrl || !filterAudioRef.current) return;
    const el = filterAudioRef.current;
    if (el.paused) {
      if (!el.src || !el.src.includes(blobUrl)) {
        el.src = blobUrl;
        el.currentTime = currentTime;
      }
      el.play();
    } else {
      el.pause();
    }
  }, [bandFilter, currentTime]);

  useEffect(() => {
    if (bandFilter === "all") return;
    setIsPlaying(false);
    const el = filterAudioRef.current;
    if (!el) return;
    let rafId: number;
    const tick = () => {
      if (el.ended) {
        setCurrentTime(0);
        wavesurferRef.current?.seekTo(0);
        return;
      }
      const t = el.currentTime;
      setCurrentTime(t);
      const d = wavesurferRef.current?.getDuration();
      if (d != null && d > 0) wavesurferRef.current?.seekTo(t / d);
      if (!el.paused) rafId = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setIsPlaying(true);
      rafId = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setIsPlaying(false);
      cancelAnimationFrame(rafId);
    };
    const onEnded = () => {
      setIsPlaying(false);
      cancelAnimationFrame(rafId);
      setCurrentTime(0);
      wavesurferRef.current?.seekTo(0);
    };
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    if (!el.paused) rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
    };
  }, [bandFilter]);

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

  const bands = drumBandData?.bands;
  const meta = drumBandData?.meta;
  const hasData =
    drumBandData != null &&
    bands != null &&
    (bands.low.length > 0 || bands.mid.length > 0 || bands.high.length > 0);
  const durationSec = meta?.duration_sec ?? 1;
  const [visibleStart, visibleEnd] = visibleRange;
  const visibleDur = Math.max(0.001, visibleEnd - visibleStart);
  const xScale = (t: number) =>
    chartWidth > 0 && visibleDur > 0
      ? ((t - visibleStart) / visibleDur) * chartWidth
      : 0;
  const xScaleByDuration = (t: number) =>
    chartWidth > 0 && durationSec > 0 ? (t / durationSec) * chartWidth : 0;

  const scaleX = duration > 0 ? xScale : xScaleByDuration;
  const displayDuration = duration > 0 ? duration : durationSec;

  const renderBandRow = (
    key: "low" | "mid" | "high",
    events: DrumBandOnsetEvent[]
  ) => {
    return (
      <div key={key} className="energy-bar-row">
        <span
          className="energy-bar-row-label"
          style={{ color: BAR_COLORS[key] }}
        >
          {ROWS.find((r) => r.key === key)?.label ?? key}
        </span>
        <div
          className="energy-bar-row-chart"
          style={{ width: chartWidth, height: ROW_HEIGHT }}
        >
          <svg
            width={chartWidth}
            height={ROW_HEIGHT}
            style={{ display: "block" }}
          >
            {events.map((e, i) => {
              const x = scaleX(e.t) - BAR_WIDTH_PX / 2;
              const h = Math.max(2, e.energy * (ROW_HEIGHT - 20));
              const y = ROW_HEIGHT - 20 - h;
              const isActive =
                duration > 0 &&
                currentTime >= e.t - 0.05 &&
                currentTime <= e.t + 0.15;
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
            {duration > 0 && (
              <line
                x1={scaleX(currentTime)}
                x2={scaleX(currentTime)}
                y1={0}
                y2={ROW_HEIGHT}
                stroke="#e74c3c"
                strokeWidth={1}
              />
            )}
          </svg>
        </div>
      </div>
    );
  };

  const rowsToShow =
    bandFilter === "all"
      ? (["low", "mid", "high"] as const)
      : ([bandFilter] as const);

  return (
    <div className="tab-energy-bar-view tab-drum-band-energy">
      {audioUrl && (
        <>
          <div className="waveform-controls">
            <span className="band-filter-label">대역 필터:</span>
            <div className="band-filter-btns">
              {(["all", "low", "mid", "high"] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={`band-filter-btn ${bandFilter === opt ? "active" : ""}`}
                  onClick={() => setBandFilter(opt)}
                  disabled={opt !== "all" && filterLoading === opt}
                  title={
                    opt === "all"
                      ? "전체 대역 재생"
                      : `${opt === "low" ? "Low" : opt === "mid" ? "Mid" : "High"} 대역만 듣기 + 해당 onset만 표시`
                  }
                >
                  {opt === "all" ? "전체" : opt === "low" ? "Low" : opt === "mid" ? "Mid" : "High"}
                </button>
              ))}
            </div>
            {filterLoading != null && (
              <span className="filter-loading">필터 적용 중…</span>
            )}
            <button
              type="button"
              onClick={handlePlayPause}
              disabled={
                duration === 0 ||
                (bandFilter !== "all" && !filterReady[bandFilter as BandId])
              }
            >
              {isPlaying ? "일시정지" : "재생"}
            </button>
            <span className="time-display">
              {formatTime(currentTime)} / {formatTime(displayDuration)}
            </span>
            <div className="zoom-controls">
              <button
                type="button"
                onClick={zoomOut}
                disabled={duration === 0}
              >
                −
              </button>
              <button
                type="button"
                onClick={zoomIn}
                disabled={duration === 0}
              >
                +
              </button>
            </div>
          </div>
          <div className="waveform-visual">
            <div className="waveform-container" ref={containerRef} />
          </div>
          <audio ref={filterAudioRef} style={{ display: "none" }} />
        </>
      )}
      {!audioUrl && (
        <p className="energy-meta">
          오디오 업로드 시 파형이 표시됩니다. 막대그래프는 JSON만으로도 표시됩니다.
        </p>
      )}

      {!hasData && (
        <p className="energy-meta">
          Drum Band Energy 탭에서 drum_band_energy.json 샘플을 로드하세요.
        </p>
      )}
      {meta && hasData && bands != null && (
        <p className="energy-meta">
          <strong>{meta.source}</strong> · {meta.duration_sec.toFixed(1)}s ·
          대역별 onset: Low {bands.low.length}개, Mid {bands.mid.length}개,
          High {bands.high.length}개
        </p>
      )}

      {hasData && chartWidth > 0 && bands != null && (
        <div className="energy-bar-chart-wrap" ref={chartWrapRef}>
          {rowsToShow.map((key) => renderBandRow(key, bands[key]))}
          <p className="energy-bar-hint">
            {bandFilter === "all"
              ? "대역별로 추출된 onset에 대한 에너지. 가로축: 시간. 막대 클릭 시 해당 위치로 이동."
              : "선택한 대역 onset만 표시. 위에서 해당 대역만 듣고 막대와 맞는지 확인하세요."}
          </p>
        </div>
      )}
    </div>
  );
}
