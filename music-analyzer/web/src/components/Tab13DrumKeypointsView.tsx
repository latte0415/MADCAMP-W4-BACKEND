import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { LayerTimelineStrip } from "./LayerTimelineStrip";
import type { StreamsSectionsData, KeypointByBandItem, TextureBlockItem } from "../types/streamsSections";
import type { EventPoint } from "../types/event";

const WAVEFORM_HEIGHT = 100;
const STRIP_HEIGHT = 44;
const DEFAULT_MIN_PX_PER_SEC = 50;
const ZOOM_FACTOR = 1.5;
const MIN_ZOOM = 10;
const MAX_ZOOM = 500;

const BAND_COLORS: Record<string, string> = {
  low: "#e74c3c",
  mid: "#f39c12",
  high: "#3498db",
};

function keypointsToEvents(items: KeypointByBandItem[] | undefined | null, band: string): EventPoint[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const color = BAND_COLORS[band] ?? "#5a9fd4";
  return items
    .filter((item) => item != null && typeof item === "object" && typeof (item as KeypointByBandItem).time === "number")
    .map((item) => ({
      t: (item as KeypointByBandItem).time,
      strength: Math.min(1, Math.max(0, Number((item as KeypointByBandItem).score ?? 0))),
      color,
      layer: band,
    }));
}

interface Tab13DrumKeypointsViewProps {
  audioUrl: string | null;
  data: StreamsSectionsData | null;
}

export function Tab13DrumKeypointsView({ audioUrl, data }: Tab13DrumKeypointsViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stripBgRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const stripBgWsRef = useRef<WaveSurfer | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [minPxPerSec, setMinPxPerSec] = useState(DEFAULT_MIN_PX_PER_SEC);
  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, 1]);
  /** low | mid | high 중 하나만 선택해 해당 대역만 표시 */
  const [selectedBand, setSelectedBand] = useState<"low" | "mid" | "high">("low");

  useEffect(() => {
    if (!audioUrl || !containerRef.current) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: WAVEFORM_HEIGHT,
      minPxPerSec: DEFAULT_MIN_PX_PER_SEC,
      waveColor: "rgba(140, 140, 140, 0.38)",
      progressColor: "rgba(26, 115, 232, 0.5)",
      cursorWidth: 2,
      barWidth: 1,
      barGap: 1,
      barRadius: 0,
      normalize: true,
    });
    wavesurferRef.current = ws;
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
    return () => {
      ws.destroy();
      wavesurferRef.current = null;
    };
  }, [audioUrl]);

  const keypointsByBand = (data?.keypoints_by_band && typeof data.keypoints_by_band === "object")
    ? data.keypoints_by_band
    : {};
  const textureBlocksByBand = (data?.texture_blocks_by_band && typeof data.texture_blocks_by_band === "object")
    ? data.texture_blocks_by_band
    : {};
  const dur = data?.duration_sec ?? (duration || 1);
  const stripVisibleRange: [number, number] =
    duration > 0 ? visibleRange : [0, Math.max(1, data?.duration_sec ?? 1)];

  const bands = ["low", "mid", "high"] as const;
  const textureBands = ["mid", "high"] as const;
  /** 선택된 대역만 표시: 키포인트 행 1개 + (mid/high면 텍스처 행 1개) */
  const keypointRowsForBand = bands
    .filter(
      (b) =>
        b === selectedBand &&
        Array.isArray(keypointsByBand[b]) &&
        (keypointsByBand[b] as KeypointByBandItem[]).length > 0
    )
    .map((band) => ({
      band,
      label: band === "low" ? "Low (키포인트)" : band === "mid" ? "Mid (키포인트)" : "High (키포인트)",
      events: keypointsToEvents(keypointsByBand[band], band),
    }));
  const textureRowsForBand =
    selectedBand === "mid" || selectedBand === "high"
      ? Array.isArray(textureBlocksByBand[selectedBand]) &&
        (textureBlocksByBand[selectedBand] as TextureBlockItem[]).length > 0
        ? [selectedBand]
        : []
      : [];

  const totalStripRows = keypointRowsForBand.length + textureRowsForBand.length;
  const totalStripBlockHeight = totalStripRows * (STRIP_HEIGHT + 24);

  useEffect(() => {
    if (!audioUrl || !data?.keypoints_by_band || !stripBgRef.current || totalStripBlockHeight <= 0)
      return;

    const el = stripBgRef.current;
    const bgWs = WaveSurfer.create({
      container: el,
      height: totalStripBlockHeight,
      minPxPerSec,
      waveColor: "rgba(140, 140, 140, 0.32)",
      progressColor: "transparent",
      cursorWidth: 0,
      barWidth: 1,
      barGap: 1,
      barRadius: 0,
      normalize: true,
    });
    stripBgWsRef.current = bgWs;
    bgWs.load(audioUrl);

    const mainWs = wavesurferRef.current;
    const syncScroll = () => {
      const mW = mainWs?.getWrapper();
      const bW = bgWs.getWrapper();
      if (mW && bW) bW.scrollLeft = mW.scrollLeft;
    };
    mainWs?.on("scroll", syncScroll);
    bgWs.on("ready", syncScroll);

    return () => {
      mainWs?.un("scroll", syncScroll);
      bgWs.destroy();
      stripBgWsRef.current = null;
    };
  }, [audioUrl, data?.keypoints_by_band, totalStripBlockHeight, selectedBand]);

  useEffect(() => {
    const bg = stripBgWsRef.current;
    if (bg) bg.zoom(minPxPerSec);
  }, [minPxPerSec]);

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

  if (!data) {
    return (
      <div className="tab13-drum-keypoints-view">
        <p className="placeholder">streams_sections_cnn.json을 로드하세요 (keypoints_by_band, texture_blocks_by_band 포함)</p>
      </div>
    );
  }

  const hasKeypoints =
    Object.keys(keypointsByBand).length > 0 &&
    Object.values(keypointsByBand).some((arr) => Array.isArray(arr) && arr.length > 0);
  const hasTexture =
    Object.keys(textureBlocksByBand).length > 0 &&
    Object.values(textureBlocksByBand).some((arr) => Array.isArray(arr) && arr.length > 0);

  if (!hasKeypoints && !hasTexture) {
    return (
      <div className="tab13-drum-keypoints-view">
        <p className="placeholder">이 JSON에는 keypoints_by_band / texture_blocks_by_band가 없습니다. 11_cnn_streams_layers로 생성한 streams_sections_cnn.json을 로드하세요.</p>
      </div>
    );
  }

  return (
    <div className="tab13-drum-keypoints-view">
      <div className="tab13-meta">
        <span>keypoints_by_band: low={(keypointsByBand.low ?? []).length}, mid={(keypointsByBand.mid ?? []).length}, high={(keypointsByBand.high ?? []).length}</span>
        <span>texture_blocks: mid={(textureBlocksByBand.mid ?? []).length}, high={(textureBlocksByBand.high ?? []).length}</span>
        {data.source && <span>소스: {data.source}</span>}
      </div>

      {(hasKeypoints || hasTexture) && (
        <div className="tab13-band-toggle">
          <span className="tab13-band-toggle-label">대역</span>
          <div className="tab13-band-toggle-btns" role="group" aria-label="대역 선택">
            {bands.map((band) => (
              <button
                key={band}
                type="button"
                className={`tab13-band-toggle-btn ${selectedBand === band ? "active" : ""}`}
                onClick={() => setSelectedBand(band)}
                style={selectedBand === band ? { borderColor: BAND_COLORS[band], color: BAND_COLORS[band] } : undefined}
              >
                {band === "low" ? "Low" : band === "mid" ? "Mid" : "High"}
              </button>
            ))}
          </div>
        </div>
      )}

      {audioUrl && (
        <>
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
          <div className="tab13-waveform-wrap">
            <div className="waveform-container" ref={containerRef} style={{ minHeight: WAVEFORM_HEIGHT, width: "100%" }} />
          </div>
        </>
      )}

      {(hasKeypoints || hasTexture) && dur > 0 && totalStripRows > 0 && (
        <div className="tab13-strips" style={{ marginTop: 12, position: "relative" }}>
          <div
            ref={stripBgRef}
            aria-hidden
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: totalStripBlockHeight,
              zIndex: 0,
            }}
          />
          <div style={{ position: "relative", zIndex: 1 }}>
            {keypointRowsForBand.map(({ band, label, events }) => (
              <LayerTimelineStrip
                key={`kp-${band}`}
                label={label}
                events={events}
                currentTime={currentTime}
                visibleRange={stripVisibleRange}
                height={STRIP_HEIGHT}
                stripColor={BAND_COLORS[band]}
                pointOpacity={0.85}
              />
            ))}
            {textureRowsForBand.map((band) => (
              <TextureBlockStrip
                key={`tex-${band}`}
                label={band === "mid" ? "Mid (텍스처 블록)" : "High (텍스처 블록)"}
                blocks={textureBlocksByBand[band] ?? []}
                durationSec={dur}
                currentTime={currentTime}
                visibleRange={stripVisibleRange}
                height={STRIP_HEIGHT}
                color={BAND_COLORS[band]}
              />
            ))}
          </div>
        </div>
      )}

      <details className="tab13-details" style={{ marginTop: 16 }}>
        <summary>keypoints_by_band / texture_blocks_by_band 목록</summary>
        <div className="detail-grid">
          {bands.map((band) => (
            <div key={band}>
              <h4>Keypoints {band}</h4>
              <ul style={{ fontSize: 12, maxHeight: 100, overflow: "auto" }}>
                {(keypointsByBand[band] ?? []).slice(0, 20).map((kp, i) => (
                  <li key={i}>
                    {kp.time.toFixed(2)}s score={kp.score.toFixed(3)}
                  </li>
                ))}
                {(keypointsByBand[band] ?? []).length > 20 && (
                  <li>… 외 {(keypointsByBand[band] ?? []).length - 20}개</li>
                )}
              </ul>
            </div>
          ))}
          {textureBands.map((band) => (
            <div key={`blk-${band}`}>
              <h4>Texture blocks {band}</h4>
              <ul style={{ fontSize: 12, maxHeight: 100, overflow: "auto" }}>
                {(textureBlocksByBand[band] ?? []).slice(0, 15).map((blk, i) => (
                  <li key={i}>
                    {blk.start.toFixed(2)}–{blk.end.toFixed(2)}s rep={blk.representative_time.toFixed(2)} n={blk.count}
                  </li>
                ))}
                {(textureBlocksByBand[band] ?? []).length > 15 && (
                  <li>… 외 {(textureBlocksByBand[band] ?? []).length - 15}개</li>
                )}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

interface TextureBlockStripProps {
  label: string;
  blocks: TextureBlockItem[];
  durationSec: number;
  currentTime: number;
  visibleRange: [number, number];
  height: number;
  color: string;
}

function TextureBlockStrip({
  label,
  blocks,
  visibleRange,
  height,
  color,
}: TextureBlockStripProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect?.width ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [visibleStart, visibleEnd] = visibleRange;
  const visibleDur = Math.max(0.001, visibleEnd - visibleStart);
  const left = (t: number) =>
    width > 0 && visibleDur > 0 ? ((t - visibleStart) / visibleDur) * width : 0;
  const w = (start: number, end: number) =>
    width > 0 && visibleDur > 0 ? ((end - start) / visibleDur) * width : 0;

  return (
    <div className="layer-timeline-strip texture-block-strip">
      <div className="layer-timeline-head">
        <span className="layer-timeline-label">{label}</span>
        <span className="layer-timeline-count">{blocks.length}개</span>
      </div>
      <div className="layer-timeline-svg-wrap" style={{ position: "relative", height }}>
        <div ref={wrapRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          <svg width={width} height={height} style={{ display: "block", pointerEvents: "none" }}>
            {blocks.map((blk, i) => {
              const x = left(blk.start);
              const blockW = Math.max(2, w(blk.start, blk.end));
              return (
                <rect
                  key={i}
                  x={x}
                  y={2}
                  width={blockW}
                  height={height - 4}
                  fill={color}
                  opacity={0.5}
                  rx={2}
                />
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}
